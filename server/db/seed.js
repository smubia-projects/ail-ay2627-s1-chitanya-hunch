import { randomUUID } from 'node:crypto';
import { insertResponses, bulkInsert } from './research.js';
import { createCompany, saveStudy } from './business.js';
import { pricedProducts, today } from './catalog.js';
import { generateSynthetic } from '../seed/synthetic.js';
import { CONSENT_VERSION, CONSENT_TEXT_HASH } from '../consent.js';

// Every seeded row has is_seed = 1 (respondents, responses, companies; studies and users cascade from the company),
// so removeSeed() takes the demo out in one go without touching real data.
export const DEMO_EMAIL = 'demo@hunch.local'; // the demo company's contact address (no sign-in)

export async function insertSeed(db, { respondents, responses }, { study } = {}) {
  return db.transaction(async () => {
    const ids = new Map(respondents.map(r => [r.id, randomUUID()]));
    const first = new Map();
    for (const r of responses) if (!first.has(r.respondentId) || r.answeredAt < first.get(r.respondentId)) first.set(r.respondentId, r.answeredAt);
    const joined = r => first.get(r.id) ?? new Date().toISOString();
    await bulkInsert(db, 'respondents', ['id', 'created_at', 'age_band', 'gender', 'region', 'shops_online_freq', 'profile_asked_at', 'is_seed'],
      respondents.map(r => ({ id: ids.get(r.id), created_at: joined(r), age_band: r.ageBand, gender: r.gender, region: r.region,
        shops_online_freq: r.shopsOnlineFreq, profile_asked_at: joined(r), is_seed: 1 })));
    await bulkInsert(db, 'consents', ['respondent_id', 'consent_version', 'consent_text_hash', 'granted_at'],
      respondents.map(r => ({ respondent_id: ids.get(r.id), consent_version: CONSENT_VERSION, consent_text_hash: CONSENT_TEXT_HASH, granted_at: joined(r) })));
    await insertResponses(db, responses.map(r => ({ ...r, respondentId: ids.get(r.respondentId), isSeed: true })));
    let studyId = null;
    if (study) {
      const companyId = await createCompany(db, { name: study.company, contactEmail: DEMO_EMAIL, isSeed: true });
      studyId = await saveStudy(db, { companyId, title: study.title, startsOn: study.startsOn, endsOn: study.endsOn, minResponses: 1500, status: 'active', productIds: study.productIds });
    }
    return { respondents: respondents.length, responses: responses.length, studyId };
  })();
}

export async function removeSeed(db) {
  return db.transaction(async () => {
    const responses = (await db.prepare('DELETE FROM responses WHERE is_seed = 1').run()).changes;
    await db.prepare('DELETE FROM consents WHERE respondent_id IN (SELECT id FROM respondents WHERE is_seed = 1)').run();
    await db.prepare('DELETE FROM player_respondent_link WHERE respondent_id IN (SELECT id FROM respondents WHERE is_seed = 1)').run();
    const respondents = (await db.prepare('DELETE FROM respondents WHERE is_seed = 1').run()).changes;
    const companies = (await db.prepare('DELETE FROM companies WHERE is_seed = 1').run()).changes;
    return { responses, respondents, companies };
  })();
}

export const seedCount = db => db.prepare('SELECT COUNT(*) FROM respondents WHERE is_seed = 1').pluck().get();

// The demo study shown on the public Insights tab: ~300 synthetic respondents over 60 days (planted personas and
// anchoring) on five study products. Used by `npm run seed` and, with HUNCH_SEED_DEMO=on, by the server at startup.
export async function seedDemo(db) {
  const catalog = await pricedProducts(db);
  const wanted = ['prod_1', 'prod_7', 'item_009', 'item_028', 'prod_6'].filter(id => catalog.some(p => p.id === id));
  // Games draw from a 24-item pool that includes the study's items, as real games give study items priority.
  const others = catalog.filter(p => !wanted.includes(p.id)).sort((a, b) => (a.id < b.id ? -1 : 1)).filter((_, i) => i % 7 === 0).slice(0, 24 - wanted.length);
  const products = [...catalog.filter(p => wanted.includes(p.id)), ...others];
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 86400000).toISOString().slice(0, 10);
  const data = generateSynthetic({ products, respondents: 300, seed: 17, days: 60, endDate: end });
  return insertSeed(db, data, { study: { company: 'Demo Audio & Coffee Co. (synthetic)', title: 'Q4 price perception: audio and coffee', startsOn: start, endsOn: today(), productIds: wanted } });
}
