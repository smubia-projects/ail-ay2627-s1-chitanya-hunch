import { networkInterfaces } from 'node:os';
import { send } from './http.js';
import { roomRoutes } from './routes/rooms.js';
import { insightsRoutes } from './routes/insights.js';
import { CONSENT_VERSION, CONSENT_TEXT, BUYER_CATEGORIES, PROFILE_OPTIONS } from './consent.js';

// The API's one request handler (server/index.js runs it locally and on Cloud Run). API-only: the React app is on
// Vercel. `getDb` returns the shared database promise, opened once per process.
const allowedOrigins = () => (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);

// The Vercel site calls this API from another origin; only CORS_ORIGINS may read the responses.
function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins().includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
}
export function createHandler(getDb) {
  return async (req, res) => {
    try {
      cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (path === '/api/health') return send(res, 200, { status: 'ok' });
      if (path === '/api/consent' && req.method === 'GET') return send(res, 200, { version: CONSENT_VERSION, text: CONSENT_TEXT, buyerCategories: BUYER_CATEGORIES, profileOptions: PROFILE_OPTIONS });
      if (path === '/api/network') {
        // Only meaningful on a laptop hosting a Wi-Fi game; hosted deployments have nothing to share.
        if (process.env.K_SERVICE) return send(res, 200, { hosts: [] });
        const hosts = Object.entries(networkInterfaces()).sort(([a], [b]) => Number(/wi-fi|wlan/i.test(b)) - Number(/wi-fi|wlan/i.test(a)))
          .flatMap(([, addresses]) => addresses.filter(a => a.family === 'IPv4' && !a.internal).map(a => a.address));
        return send(res, 200, { hosts });
      }
      const db = await getDb();
      if (await roomRoutes(db, req, res, path)) return undefined;
      if (await insightsRoutes(db, req, res, path)) return undefined;
      return send(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (!error.status) console.error(error);
      // error.body: the rate limiter's reply (queries_used for the CTA) is passed through as is.
      return send(res, error.status || 500, { ...error.body, error: error.status ? error.message : 'The game server had a problem. Try again.' });
    }
  };
}
