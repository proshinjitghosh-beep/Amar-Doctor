import { z } from 'zod';
import {
  authenticateUser,
  createSession,
  registerUser,
  revokeAllSessions,
  revokeSession,
} from '../services/auth.service.js';
import { SESSION_COOKIE } from '../middleware/authentication.js';
import { requireAuth } from '../middleware/authentication.js';
import { recordAudit } from '../services/audit.service.js';
import { HttpError } from '../utils/http-error.js';

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

/**
 * Express 4 has no cookie parser, so the cookie is written by hand. This
 * avoids adding a dependency for a single value.
 */
function writeSessionCookie(res, token, expiresAt) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/**
 * Expire the session cookie.
 *
 * The attributes must match the ones `writeSessionCookie` used, otherwise a
 * browser can keep a copy of the old cookie - the `Secure` flag in
 * particular has to line up with what was set.
 */
function clearSessionCookie(res) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export async function register(req, res, next) {
  try {
    const parsed = registerSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'নাম, সঠিক ইমেইল ও কমপক্ষে ৮ অক্ষরের পাসওয়ার্ড দিন।');
    }

    const user = await registerUser(parsed.data);
    const session = await createSession({
      userId: user.id,
      userAgent: req.headers['user-agent'] || null,
      ipAddress: req.ip || null,
    });

    writeSessionCookie(res, session.token, session.expiresAt);
    await recordAudit({ userId: user.id, action: 'auth.register', resourceType: 'user', resourceId: user.id });

    return res.status(201).json({ user, expiresAt: session.expiresAt });
  } catch (error) {
    return next(error);
  }
}

export async function login(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'ইমেইল ও পাসওয়ার্ড দিন।');
    }

    const user = await authenticateUser(parsed.data);
    if (!user) {
      throw new HttpError(401, 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।');
    }

    const session = await createSession({
      userId: user.id,
      userAgent: req.headers['user-agent'] || null,
      ipAddress: req.ip || null,
    });

    writeSessionCookie(res, session.token, session.expiresAt);
    await recordAudit({ userId: user.id, action: 'auth.login', resourceType: 'user', resourceId: user.id });

    return res.json({ user, expiresAt: session.expiresAt });
  } catch (error) {
    return next(error);
  }
}

export async function logout(req, res, next) {
  try {
    // The session row is revoked as well as the cookie being cleared, so the
    // token cannot be replayed until its TTL runs out.
    if (req.sessionToken) {
      await revokeSession(req.sessionToken);
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

export async function me(req, res, next) {
  try {
    return res.json({ user: req.user });
  } catch (error) {
    return next(error);
  }
}

/** Remove every session for the signed-in user. */
export async function logoutAll(req, res, next) {
  try {
    await revokeAllSessions(req.user.id);
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

export { requireAuth };
