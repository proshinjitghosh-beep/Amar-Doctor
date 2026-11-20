import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;
export const pool = env.databaseUrl
  ? new Pool({ connectionString: env.databaseUrl, ssl: env.nodeEnv === 'production' ? { rejectUnauthorized: true } : false })
  : null;

if (pool) {
  pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error.message));
}
