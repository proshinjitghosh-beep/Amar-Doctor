import { findUserBySession } from '../services/auth.service.js';

export const SESSION_COOKIE = 'amar_session';

export function readSessionToken(req) {
  const header = req.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  const cookie = req.headers?.cookie;
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

/**
 * Require a valid session. Attaches `req.user` and `req.sessionToken`.
 *
 * The healthcare modules store medical records, so they must never accept an
 * unverified identity - there is no anonymous fallback here.
 */
export async function requireAuth(req, res, next) {
  try {
    const token = readSessionToken(req);
    if (!token) {
      return res.status(401).json({ error: 'লগইন করতে হবে। অনুগ্রহ করে আগে অ্যাকাউন্টে সাইন ইন করুন।' });
    }

    const user = await findUserBySession(token);
    if (!user) {
      return res.status(401).json({ error: 'সেশনটি আর সক্রিয় নেই। আবার লগইন করুন।' });
    }

    req.user = user;
    req.sessionToken = token;
    return next();
  } catch (error) {
    return next(error);
  }
}

/** Attach `req.user` when a session exists, but never reject the request. */
export async function optionalAuth(req, _res, next) {
  try {
    const token = readSessionToken(req);
    if (token) {
      const user = await findUserBySession(token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
  } catch {
    // A failed optional lookup must not block the request.
  }
  return next();
}
