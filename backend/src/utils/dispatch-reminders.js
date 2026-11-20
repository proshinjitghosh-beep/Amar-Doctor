import { dispatchDueReminders } from '../services/reminder-dispatcher.service.js';
import { pool } from '../config/database.js';

/**
 * Run the reminder dispatcher from the command line.
 *
 * On Vercel the same work is done by the cron endpoint; this script is for
 * local development and for manual runs.
 */
try {
  const summary = await dispatchDueReminders();
  console.log(
    `Due doses: ${summary.due} · notifications created: ${summary.created} · ` +
      `delivered: ${summary.delivered} · failed: ${summary.failed} · unavailable: ${summary.unavailable}`
  );
} catch (error) {
  console.error('Reminder dispatch failed:', error.message);
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
