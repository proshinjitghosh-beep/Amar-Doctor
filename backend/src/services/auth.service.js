import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool, requireDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const scrypt = promisify(crypto.scrypt);

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Hash a password with scrypt. The salt is stored alongside the derived key
 * so a hash can be verified later without storing the password itself.
 *
 * scrypt is used instead of bcrypt/argon2 to avoid a native build dependency.
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(String(password), salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Constant-time verification of a password against a stored hash. */
export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  try {
    const derived = await scrypt(String(password), Buffer.from(saltHex, 'hex'), KEY_LENGTH, SCRYPT_PARAMS);
    const expected = Buffer.from(keyHex, 'hex');
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a session for a user and return the opaque token. The token itself
 * is never stored - only its SHA-256 hash.
 */
export async function createSession({ userId, userAgent = null, ipAddress = null }) {
  const db = requireDatabase();
  const token = newToken();
  const expiresAt = new Date(Date.now() + env.sessionTtlDays * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), userAgent ? String(userAgent).slice(0, 200) : null, ipAddress || null, expiresAt]
  );

  return { token, expiresAt };
}

/** Resolve a session token to its user, or null when invalid or expired. */
export async function findUserBySession(token) {
  if (!token || !pool) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.role, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [hashToken(token)]
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    return null;
  }
  return {
    id: Number(row.id),
    fullName: row.full_name,
    email: row.email,
    role: row.role,
  };
}

export async function revokeSession(token) {
  if (!token || !pool) return;
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function revokeAllSessions(userId) {
  if (!pool) return;
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

/** Register a new patient account. Returns the created user. */
export async function registerUser({ fullName, email, password }) {
  const db = requireDatabase();
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.rowCount) {
    throw new HttpError(409, 'এই ইমেইল দিয়ে আগেই একটি অ্যাকাউন্ট আছে।');
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await db.query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, 'patient')
     RETURNING id, full_name, email, role`,
    [String(fullName || '').trim(), normalizedEmail, passwordHash]
  );

  const row = rows[0];
  return { id: Number(row.id), fullName: row.full_name, email: row.email, role: row.role };
}

/** Verify credentials and return the user, or null. */
export async function authenticateUser({ email, password }) {
  if (!pool) return null;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const { rows } = await pool.query(
    'SELECT id, full_name, email, role, password_hash FROM users WHERE email = $1 AND role = $2',
    [normalizedEmail, 'patient']
  );
  const row = rows[0];
  if (!row) return null;
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return null;
  return { id: Number(row.id), fullName: row.full_name, email: row.email, role: row.role };
}
