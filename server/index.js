import './env.js';
import { createServer } from 'node:http';
import { openDb, defaultTarget } from './db/index.js';
import { createHandler } from './app.js';
import { seedCount, seedDemo } from './db/seed.js';

// Rooms and guesses are shared by every player, so production needs Postgres (Neon); PGlite is for local play only.
if (process.env.K_SERVICE && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required on Cloud Run (a Neon Postgres URL).');
// HUNCH_SEED_DEMO=on loads the synthetic demo study once, so the public Insights tab has data on a fresh database.
const ready = openDb(defaultTarget()).then(async db => {
  if (process.env.HUNCH_SEED_DEMO === 'on' && !(await seedCount(db))) console.log('Seeded the demo study:', await seedDemo(db));
  return db;
});
const server = createServer(createHandler(() => ready));
// Cloud Run sets PORT and needs 0.0.0.0; locally the API stays on 127.0.0.1 behind the Vite proxy.
const port = Number(process.env.PORT || process.env.GAME_PORT || 3001);
ready.then(() => server.listen(port, process.env.PORT ? '0.0.0.0' : '127.0.0.1',
  () => console.log(`Game server ready on http://127.0.0.1:${server.address().port}${process.env.DATABASE_URL ? ' (Postgres)' : ' (local PGlite, development only)'}`)));
