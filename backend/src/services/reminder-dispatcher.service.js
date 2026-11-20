import { pool, requireDatabase } from '../config/database.js';
import { createDoseNotification, deliverNotification } from './notification.service.js';
import { occurrencesBetween } from '../utils/date-time.js';
import { formatZoned } from '../utils/date-time.js';

/**
 * Reminder dispatch.
 *
 * The deployment target is Vercel, where there is no long-lived process, so
 * there is no setInterval here. Instead:
 *  - the doses are materialised as database rows ahead of time;
 *  - this dispatcher finds the doses that are due and creates a notification
 *    for each one;
 *  - the unique index on notifications makes a repeated dispatch harmless.
 *
 * The dispatcher is triggered by a Vercel Cron, by the local
 * `npm run reminders:dispatch` script, and opportunistically by any
 * authenticated API request.
 */

/** How far ahead doses are created. */
const LOOKAHEAD_DAYS = 7;

async function listDueDoses(now = new Date()) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT d.id, d.user_id, d.medication_id, d.schedule_id, d.scheduled_at,
            m.medicine_name, m.dosage, s.reminder_time, s.timezone
       FROM dose_logs d
       JOIN medications m ON m.id = d.medication_id
       LEFT JOIN medicine_schedules s ON s.id = d.schedule_id
      WHERE d.status = 'scheduled'
        AND d.scheduled_at <= $1
        AND d.scheduled_at > $2
      ORDER BY d.scheduled_at
      LIMIT 500`,
    [now, new Date(now.getTime() - 24 * 60 * 60 * 1000)]
  );
  return rows;
}

/** Create the dose rows for the coming week for every active schedule. */
export async function materialiseUpcomingDoses() {
  const db = requireDatabase();
  const { rows: schedules } = await db.query(
    `SELECT s.id AS schedule_id, s.user_id, s.medication_id, s.reminder_time,
            s.repeat_days, s.timezone, m.medicine_name
       FROM medicine_schedules s
       JOIN medications m ON m.id = s.medication_id
      WHERE s.is_active = TRUE AND m.status = 'active'`
  );

  const now = new Date();
  const from = now;
  const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  let created = 0;
  for (const schedule of schedules) {
    const occurrences = occurrencesBetween({
      startAt: from,
      endAt: to,
      days: schedule.repeat_days,
      time: schedule.reminder_time,
      timeZone: schedule.timezone || 'Asia/Dhaka',
    });
    for (const occurrence of occurrences) {
      const { rowCount } = await db.query(
        `INSERT INTO dose_logs (user_id, medication_id, schedule_id, scheduled_at, status)
         VALUES ($1, $2, $3, $4, 'scheduled')
         ON CONFLICT (medication_id, COALESCE(schedule_id, 0), scheduled_at) DO NOTHING`,
        [schedule.user_id, schedule.medication_id, schedule.schedule_id, occurrence]
      );
      created += rowCount;
    }
  }

  return created;
}

/**
 * Notify every due dose.
 *
 * Returns a summary of what happened, including how many notifications could
 * not be delivered - those are never counted as sent.
 */
export async function dispatchDueReminders({ now = new Date(), deliver = true } = {}) {
  await materialiseUpcomingDoses();

  const doses = await listDueDoses(now);
  const summary = { due: doses.length, created: 0, delivered: 0, failed: 0, unavailable: 0 };

  for (const dose of doses) {
    const time = formatZoned(dose.scheduled_at, dose.timezone || 'Asia/Dhaka');
    const title = `ওষুধের সময় — ${dose.medicine_name}`;
    const message = dose.dosage
      ? `${dose.medicine_name} (${dose.dosage}) — নির্ধারিত সময় ${time}`
      : `${dose.medicine_name} — নির্ধারিত সময় ${time}`;

    const notification = await createDoseNotification({
      userId: dose.user_id,
      medicationId: dose.medication_id,
      scheduleId: dose.schedule_id,
      scheduledAt: dose.scheduled_at,
      title,
      message,
    });

    if (!notification) {
      // Already notified for this occurrence - nothing more to do.
      continue;
    }
    summary.created += 1;

    if (!deliver) continue;

    const result = await deliverNotification(notification.id);
    if (result?.status === 'sent') summary.delivered += 1;
    else if (result?.status === 'failed') summary.failed += 1;
    else if (result?.status === 'unavailable') summary.unavailable += 1;
  }

  return summary;
}

export { pool };
