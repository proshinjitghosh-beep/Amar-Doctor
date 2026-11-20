import { Client } from 'pg';

/**
 * Per-file isolated PostgreSQL schema for the tests.
 *
 * Each test file gets its own schema and points the application's connection
 * pool at it via the `search_path` connection option, so the files can run in
 * parallel without seeing each other's rows.
 *
 * The tests are skipped - not silently passed - when no database is
 * configured, so `npm test` still works without one.
 */

const ADMIN_DB = 'postgres';

export function databaseAvailable() {
  return Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
}

/**
 * Create an isolated schema and return the DATABASE_URL the application
 * should use. The schema is dropped again by `cleanupTestDatabase`.
 */
export async function setupTestDatabase(label) {
  const baseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!baseUrl) return null;

  const schema = `test_${label}_${process.pid.toString(36)}`;

  const admin = new Client({ connectionString: baseUrl, database: ADMIN_DB });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  } finally {
    await admin.end();
  }

  const separator = baseUrl.includes('?') ? '&' : '?';
  const scoped = `${baseUrl}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
  return { schema, databaseUrl: scoped };
}

export async function cleanupTestDatabase({ schema, databaseUrl }) {
  if (!schema) return;
  const baseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const admin = new Client({ connectionString: baseUrl, database: ADMIN_DB });
  await admin.connect();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
}

/**
 * Apply the migrations into the isolated schema.
 *
 * The caller must already have pointed `process.env.DATABASE_URL` at the
 * scoped URL, because `config/database.js` reads it at import time.
 */
export async function migrateTestDatabase() {
  const { runMigrations } = await import('../../src/utils/migrate.js');
  await runMigrations({ log: () => {} });
}

/** Remove every row from the tables the tests use, keeping the schema. */
export async function truncateAll(databaseUrl) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      TRUNCATE TABLE
        emergency_event_notifications, emergency_events, emergency_contacts, emergency_profiles,
        dose_logs, medicine_schedules, medications,
        report_results, medical_reports,
        notifications, push_subscriptions, visit_summaries, share_links,
        symptoms, health_profiles, sessions, audit_logs, appointments
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await pool.end();
  }
}
