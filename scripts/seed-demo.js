// Demo data for Hunch Insights, before real responses exist.
//   node scripts/seed-demo.js          add ~300 synthetic respondents (planted personas + anchoring) and a demo study
//   node scripts/seed-demo.js --remove delete every seeded row (real data is untouched)
// Seeded rows are flagged is_seed = 1 and reports say "includes synthetic demo data" while any contribute.
// Writes to DATABASE_URL (Neon) when set, otherwise the local database. Stop `npm run dev` first when seeding locally:
// the local database (PGlite) can only be open in one process at a time.
import '../server/env.js';
import { openDb, defaultTarget } from '../server/db/index.js';
import { removeSeed, seedCount, seedDemo } from '../server/db/seed.js';

const db = await openDb(defaultTarget());
if (process.argv.includes('--remove')) {
  console.log('Removed synthetic demo data:', await removeSeed(db));
} else if (await seedCount(db)) {
  console.log('Synthetic demo data is already loaded. Run with --remove first to regenerate.');
} else {
  console.log('Added synthetic demo data:', await seedDemo(db));
  console.log('Open /insights to see the demo study.');
}
await db.close();
