import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db/index.js';
import { pricedProducts } from '../server/db/catalog.js';
import { insertSeed, removeSeed } from '../server/db/seed.js';
import { createCompany, saveStudy } from '../server/db/business.js';
import { generateSynthetic } from '../server/seed/synthetic.js';
import { startServer } from './helpers.js';

// A database with the seeded demo study and a draft study that must stay hidden.
async function seededDb() {
  const dir = mkdtempSync(join(tmpdir(), 'hunch-'));
  const file = join(dir, 'pg');
  const db = await openDb(file);
  const products = await pricedProducts(db);
  const studyProducts = ['prod_1', 'prod_7', 'item_009'];
  const { studyId } = await insertSeed(db, generateSynthetic({ products, respondents: 120, seed: 4 }),
    { study: { company: 'Demo Co', title: 'Demo study', startsOn: '2000-01-01', endsOn: '2999-12-31', productIds: studyProducts } });
  const other = await createCompany(db, { name: 'Other Ltd' });
  const draft = await saveStudy(db, { companyId: other, title: 'Draft', startsOn: '2000-01-01', endsOn: '2999-12-31', status: 'draft', productIds: ['prod_2'] });
  await db.close(); // the local database can be open in one process at a time; the server opens it next
  return { dir, file, studyId, draft, studyProducts };
}

test('Public Insights tab: published studies only, aggregates only, CSV export, no sign-in', async () => {
  const { dir, file, studyId, draft, studyProducts } = await seededDb();
  const server = await startServer({ GAME_EPHEMERAL: '0', HUNCH_DB: file, API_KEY: '', GEMINI_API_KEY: '' });
  const { request } = server;
  try {
    const studies = await request('/api/insights/studies');
    assert.equal(studies.status, 200);
    assert.deepEqual(studies.data.map(s => s.title), ['Demo study']);
    assert.equal(studies.data[0].client, 'Demo Co');
    assert.ok(studies.data[0].responses > 30);

    const report = await request(`/api/insights/studies/${studyId}/report`);
    assert.equal(report.status, 200);
    assert.deepEqual(report.data.products.map(p => p.id).sort(), [...studyProducts].sort());
    assert.ok(report.data.sample.includesSyntheticData);
    assert.ok(report.data.products.every(p => p.suppressed || (p.n >= 5 && p.headline)));
    const text = JSON.stringify(report.data);
    assert.ok(!text.includes('respondentId') && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text), 'no respondent ids or rows');

    assert.equal((await request(`/api/insights/studies/${draft}/report`)).status, 404, 'draft studies stay hidden');
    const csv = await request(`/api/insights/studies/${studyId}/report.csv`);
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/);

    // Without a key the analyst is off: 501, never 503 (503 is the demo kill switch).
    assert.deepEqual((await request('/api/insights/agent')).data.enabled, false);
    assert.equal((await request(`/api/insights/studies/${studyId}/ask`, { question: 'Which product is undervalued?' })).status, 501);
    // The company sign-in routes are gone.
    assert.equal((await request('/api/insights/login', { email: 'demo@hunch.local' })).status, 405);
  } finally {
    await server.stop();
  }
  try {
    const check = await openDb(file);
    assert.ok((await removeSeed(check)).responses > 0);
    await check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Ask the analyst: OpenAI-format tool calls through API_BASE_URL, streamed as NDJSON; CORS for the Vercel site', async () => {
  const { dir, file, studyId } = await seededDb();
  // A stub gateway: first asks for the overview tool, then answers.
  const seen = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const payload = JSON.parse(body);
      seen.push({ auth: req.headers.authorization, payload });
      const toolDone = payload.messages.some(m => m.role === 'tool');
      const message = toolDone ? { role: 'assistant', content: '**Headphones are undervalued.**' }
        : { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_study_overview', arguments: '{}' } }] };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  }).listen(0);
  const server = await startServer({ GAME_EPHEMERAL: '0', HUNCH_DB: file, API_KEY: 'test-key', API_BASE_URL: `http://127.0.0.1:${stub.address().port}/v1`,
    MODEL_NAME: 'stub-model', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_URL: '', CORS_ORIGINS: 'https://hunch.example' });
  try {
    const short = await server.request(`/api/insights/studies/${studyId}/ask`, { question: '' });
    assert.equal(short.status, 400);
    assert.equal(seen.length, 0, 'invalid questions never reach the model');

    const asked = await server.request(`/api/insights/studies/${studyId}/ask`, { question: 'Which product is undervalued?' });
    assert.equal(asked.status, 200);
    const events = String(asked.data).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.map(e => e.type), ['step', 'answer']);
    assert.equal(events[1].text, '**Headphones are undervalued.**');
    assert.equal(seen[0].auth, 'Bearer test-key');
    assert.equal(seen[0].payload.model, 'stub-model');
    assert.equal(seen[0].payload.tools[0].type, 'function');

    const preflight = await fetch(`${server.base}/api/insights/studies/${studyId}/ask`, { method: 'OPTIONS', headers: { Origin: 'https://hunch.example' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://hunch.example');
    const other = await fetch(`${server.base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  } finally {
    await server.stop();
    stub.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
