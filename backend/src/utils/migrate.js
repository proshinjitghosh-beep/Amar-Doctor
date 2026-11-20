import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/database.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../../database/migrations');

const LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

// A migration that changed after it was applied is a mistake, not something to
// silently re-run. Flag it so the developer writes a new numbered file instead.
function assertUnchanged(filename, sql, applied) {
  const current = checksum(sql);
  if (applied.checksum !== current) {
    throw new Error(
      `Migration ${filename} changed after it was applied (recorded ${applied.checksum}, now ${current}).\n` +
        'Add a new numbered migration file instead of editing an applied one.'
    );
  }
}

/**
 * Apply every migration that has not been applied yet.
 *
 * The `schema_migrations` ledger records the checksum of each applied file, so
 * running this twice is a no-op and an edited migration is refused rather than
 * silently re-applied.
 */
export async function runMigrations({ log = console.log } = {}) {
  if (!pool) {
    throw new Error('DATABASE_URL is missing. Set it in .env before running migrations.');
  }

  await pool.query(LEDGER);

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query('SELECT filename, checksum FROM schema_migrations');
  const applied = new Map(rows.map((row) => [row.filename, row]));

  let count = 0;

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const previous = applied.get(file);

    if (previous) {
      assertUnchanged(file, sql, previous);
      log(`Skipped ${file} (already applied)`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [file, checksum(sql)]
      );
      await client.query('COMMIT');
      log(`Applied ${file}`);
      count += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  log(count ? `${count} migration(s) applied.` : 'Database is up to date.');
  return { applied: count, files };
}

// Only run when invoked directly (`npm run db:migrate`), not when imported.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  if (!pool) {
    console.error('DATABASE_URL is missing. Set it in .env before running migrations.');
    process.exit(1);
  }
  try {
    await runMigrations();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
