import { send, sendCsv, readBody, fail } from '../http.js';
import * as biz from '../db/business.js';
import { studyReport, reportCsv } from '../insightsReport.js';
import { runAnalyst } from '../agent/analyst.js';
import { aiEnabled, aiModel } from '../agent/openai.js';
import { checkRateLimit } from '../limit.js';

// Hunch Insights, showcase version: a public tab over the published studies (the seeded demo study), with no
// company sign-in. Reports only ever contain aggregates that passed the minimum-group thresholds.
async function publishedStudy(db, id) {
  const study = await biz.studyById(db, id);
  if (!study || study.status === 'draft') fail('Study not found.', 404);
  return study;
}

export async function insightsRoutes(db, req, res, path) {
  if (!path.startsWith('/api/insights/')) return false;
  const ask = path.match(/^\/api\/insights\/studies\/(\d+)\/ask$/);
  if (ask && req.method === 'POST') {
    if (!aiEnabled()) fail('The AI analyst is not set up on this server.', 501);
    const { question, history } = await readBody(req, 16384);
    const text = typeof question === 'string' ? question.trim() : '';
    if (!text || text.length > 500) fail('Ask a question of up to 500 characters.');
    const turns = (Array.isArray(history) ? history : []).slice(-6)
      .filter(t => (t?.role === 'user' || t?.role === 'model') && typeof t.text === 'string').map(t => ({ role: t.role, text: t.text.slice(0, 2000) }));
    const report = await studyReport(db, await publishedStudy(db, Number(ask[1])));
    // Counted only once the question is valid, right before the model runs: 429 shows the CTA, 503 the paused notice.
    await checkRateLimit(req, 'ask');
    // Stream each step as a line of JSON so the page can show the agent working.
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const emit = event => res.write(`${JSON.stringify(event)}\n`);
    try { await runAnalyst({ report, question: text, history: turns, onEvent: emit }); }
    catch (error) {
      if (!error.status) console.error(error);
      emit({ type: 'error', error: error.status ? error.message : 'The AI analyst had a problem. Try again.' });
    }
    res.end();
    return true;
  }
  if (req.method !== 'GET') { send(res, 405, { error: 'Method not allowed.' }); return true; }
  if (path === '/api/insights/agent') { send(res, 200, { enabled: aiEnabled(), model: aiModel() }); return true; }
  if (path === '/api/insights/studies') {
    const studies = (await biz.allStudies(db)).filter(s => s.status !== 'draft');
    send(res, 200, await Promise.all(studies.map(async ({ productIds, companyName, ...s }) => ({ ...s, client: companyName, products: productIds.length, ...(await biz.studyCounts(db, { ...s, productIds })) }))));
    return true;
  }
  const match = path.match(/^\/api\/insights\/studies\/(\d+)\/report(\.csv)?$/);
  if (!match) return false;
  const report = await studyReport(db, await publishedStudy(db, Number(match[1])));
  if (match[2]) sendCsv(res, `hunch-insights-study-${match[1]}.csv`, reportCsv(report));
  else send(res, 200, report);
  return true;
}
