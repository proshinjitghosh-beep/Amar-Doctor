import pg from 'pg';
import { env } from './env.js';
import { HttpError } from '../utils/http-error.js';

const { Pool } = pg;
export const pool = env.databaseUrl
  ? new Pool({
      connectionString: env.databaseUrl,
      ssl: env.nodeEnv === 'production' ? { rejectUnauthorized: true } : false,
      max: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    })
  : null;

if (pool) {
  pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error.message));
}

/**
 * Database-backed features must fail loudly when PostgreSQL is not configured
 * rather than silently returning fabricated records. Call this at the top of
 * any repository operation that a request depends on.
 */
export function requireDatabase() {
  if (!pool) {
    throw new HttpError(
      503,
      'ডেটাবেস কনফিগার করা হয়নি। এই ফিচারটি ব্যবহার করতে DATABASE_URL সেট করুন।'
    );
  }
  return pool;
}
