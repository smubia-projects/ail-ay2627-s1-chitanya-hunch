// Companies and studies. (The company portal, its users, magic links and access log are cut from the showcase.)

const STUDY = `s.id, s.company_id AS companyId, s.title, s.starts_on AS startsOn, s.ends_on AS endsOn, s.min_responses AS minResponses, s.status,
  (SELECT COALESCE(json_agg(product_id ORDER BY product_id), '[]'::json) FROM study_products WHERE study_id = s.id) AS productIds`;
const list = v => (typeof v === 'string' ? JSON.parse(v) : v ?? []);
const parseStudy = row => (row ? { ...row, productIds: list(row.productIds) } : null);

// ── Studies ──────────────────────────────────────────────────────────────────
export const studyById = async (db, id) => parseStudy(await db.prepare(`SELECT ${STUDY} FROM studies s WHERE s.id = ?`).get(id));
export const allStudies = async db => (await db.prepare(`SELECT ${STUDY}, c.name AS companyName FROM studies s JOIN companies c ON c.id = s.company_id ORDER BY s.id DESC`).all()).map(parseStudy);

// Responses and distinct respondents inside the study's products and dates.
export async function studyCounts(db, study) {
  return db.prepare(`SELECT COUNT(*) AS responses, COUNT(DISTINCT respondent_id) AS respondents FROM responses
    WHERE product_id IN (SELECT json_array_elements_text(?::json)) AND substr(answered_at, 1, 10) BETWEEN ? AND ?`)
    .get(JSON.stringify(study.productIds), study.startsOn, study.endsOn);
}

export async function saveStudy(db, { id, companyId, title, startsOn, endsOn, minResponses = 30, status = 'draft', productIds = [] }) {
  return db.transaction(async () => {
    const studyId = id
      ? (await db.prepare('UPDATE studies SET company_id = ?, title = ?, starts_on = ?, ends_on = ?, min_responses = ?, status = ? WHERE id = ?')
        .run(companyId, title, startsOn, endsOn, minResponses, status, id), id)
      : (await db.prepare('INSERT INTO studies (company_id, title, starts_on, ends_on, min_responses, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(companyId, title, startsOn, endsOn, minResponses, status)).lastInsertRowid;
    await db.prepare('DELETE FROM study_products WHERE study_id = ?').run(studyId);
    for (const productId of new Set(productIds)) await db.prepare('INSERT INTO study_products (study_id, product_id) VALUES (?, ?)').run(studyId, productId);
    return Number(studyId);
  })();
}

// ── Companies ────────────────────────────────────────────────────────────────
export const createCompany = async (db, { name, contactEmail, isSeed = false, createdAt = new Date().toISOString() }) =>
  Number((await db.prepare('INSERT INTO companies (name, contact_email, created_at, is_seed) VALUES (?, ?, ?, ?)').run(name, contactEmail || null, createdAt, isSeed ? 1 : 0)).lastInsertRowid);
