import { createRateLimiter } from './rateLimitEngine.js';

// The shared AI Lodge limiter. One bucket: questions to the AI analyst (the only route that calls a model).
// Limits come from the central sheet at request time, with these env vars as the fallback; no Upstash env = off.
const limiter = createRateLimiter({
  project: 'ail-ay2627-s1-chitanya-hunch',
  buckets: { ask: Number(process.env.RATE_LIMIT_ASK_MAX || 5) },
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN,
  defaultWindow: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 432000),
});

// The engine is Express middleware; this server is plain node:http, so collect its res.status().json() reply.
// Over the limit → 429 { message, queries_used } (the CTA); paused → 503 { message }.
export async function checkRateLimit(req, bucket) {
  let blocked = null;
  await limiter(bucket)(req, { status: code => ({ json: body => { blocked = { code, body }; } }) }, () => {});
  if (blocked) throw Object.assign(new Error(blocked.body.message), { status: blocked.code, body: blocked.body });
}
