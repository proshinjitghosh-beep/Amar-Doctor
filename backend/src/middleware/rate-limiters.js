import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Rate limiters live here rather than in `app.js` so that individual routers
 * can pick the right one for a given endpoint.
 *
 * The distinction that matters: credential endpoints are throttled hard
 * (brute-force protection), while the session-check endpoint is throttled
 * loosely. `GET /api/auth/me` runs on every page load, so a strict limit
 * there would log a browsing user out of the interface.
 */

// The test suite issues many requests in a row, so the limits are lifted
// there. The production values are unchanged.
const limitFor = (value) => (env.isTest ? 100000 : value);

const shared = { standardHeaders: 'draft-7', legacyHeaders: false };

export const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: limitFor(env.apiRateLimit), ...shared });

export const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: limitFor(env.chatRateLimit), ...shared });

export const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: limitFor(env.uploadRateLimit), ...shared });

/** Register / login — the brute-force-sensitive endpoints. */
export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: limitFor(env.authRateLimit), ...shared });

/** `GET /api/auth/me` — called on every page load, so it gets its own budget. */
export const sessionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: limitFor(env.sessionRateLimit), ...shared });
