// The API runs on its own service (Cloud Run) in production; VITE_API_BASE is its URL, set in Vercel.
// Locally it is empty and Vite proxies /api to the game server.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
export const apiUrl = path => `${API_BASE}${path}`;
