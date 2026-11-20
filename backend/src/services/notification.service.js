import { createRequire } from 'node:module';
import { requireDatabase, pool } from '../config/database.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const require = createRequire(import.meta.url);

/**
 * Reminder notifications.
 *
 * Two delivery channels are supported:
 *  - Web push (VAP) when VAP_PUBLIC_KEY / VAP_PRIVATE_KEY are configured.
 *  - In-app notifications, always available.
 *
 * The delivery status is always recorded honestly. When push is not
 * configured the notification stays 'pending' in the app and the API reports
 * 'unavailable' for push - it is never reported as sent.
 */

let webPush = null;

function getWebPush() {
  if (!env.vapPublicKey || !env.vapPrivateKey) return null;
  if (webPush === null) {
    // Imported lazily so the dependency is only needed when push is enabled.
    webPush = require('web-push');
    webPush.setVapidDetails(env.vapSubject, env.vapPublicKey, env.vapPrivateKey);
  }
  return webPush;
}

export function isPushConfigured() {
  return Boolean(env.vapPublicKey && env.vapPrivateKey);
}

/**
 * Create a notification for a scheduled dose.
 *
 * The unique index on (medication_id, schedule_id, scheduled_at) means a dose
 * can never produce two notifications, no matter how often the dispatcher runs.
 */
export async function createDoseNotification({ userId, medicationId, scheduleId, scheduledAt, title, message }) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `INSERT INTO notifications
       (user_id, type, title, message, medication_id, schedule_id, scheduled_at, status)
     VALUES ($1, 'reminder', $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (medication_id, schedule_id, scheduled_at)
       WHERE medication_id IS NOT NULL AND schedule_id IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [userId, title, message, medicationId, scheduleId, scheduledAt]
  );

  // A conflict returns no rows: the dose was already notified. That is the
  // normal, expected path on a repeated dispatch.
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    userId,
    title,
    message,
    scheduledAt,
    status: 'pending',
  };
}

/** Attempt to deliver a notification through web push. */
export async function deliverNotification(notificationId) {
  const db = requireDatabase();
  const { rows } = await db.query('SELECT * FROM notifications WHERE id = $1', [notificationId]);
  const notification = rows[0];
  if (!notification) return null;

  const push = getWebPush();
  if (!push) {
    await db.query(
      `UPDATE notifications SET status = 'pending', detail = $2 WHERE id = $1`,
      [notificationId, 'ওয়েব পুশ কনফিগার করা নেই — অ্যাপে দেখা যাবে।']
    );
    return { id: notificationId, status: 'pending', channel: 'in_app' };
  }

  const subscriptions = await db.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [notification.user_id]
  );

  if (!subscriptions.rowCount) {
    await db.query(
      `UPDATE notifications SET status = 'unavailable', detail = $2 WHERE id = $1`,
      [notificationId, 'এই ডিভাইসে পুশ নোটিফিকেশন চালু নেই।']
    );
    return { id: notificationId, status: 'unavailable', channel: 'push' };
  }

  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions.rows) {
    try {
      await push.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify({ title: notification.title, body: notification.message })
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      // A 404/410 means the subscription is gone and should be removed.
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await db.query('DELETE FROM push_subscriptions WHERE id = $1', [subscription.id]);
      }
    }
  }

  const status = sent > 0 ? 'sent' : 'failed';
  const detail =
    sent > 0
      ? `${sent}টি ডিভাইসে পাঠানো হয়েছে।`
      : failed > 0
        ? 'কোনো ডিভাইসে পাঠানো যায়নি।'
        : 'পাঠানোর ফলাফল পাওয়া যায়নি।';

  await db.query(
    `UPDATE notifications SET status = $2, detail = $3, sent_at = $4 WHERE id = $1`,
    [notificationId, status, detail, sent > 0 ? new Date() : null]
  );

  return { id: notificationId, status, channel: 'push', sent, failed };
}

/** List a user's notifications, newest first. */
export async function listNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT id, type, title, message, scheduled_at, sent_at, read_at, status, detail, created_at
       FROM notifications
      WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
      ORDER BY created_at DESC
      LIMIT $3`,
    [userId, unreadOnly, Math.min(200, Math.max(1, limit))]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    type: row.type,
    title: row.title,
    message: row.message,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    readAt: row.read_at,
    status: row.status,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

export async function markNotificationsRead(userId) {
  const db = requireDatabase();
  const { rowCount } = await db.query(
    'UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL',
    [userId]
  );
  return rowCount;
}

/** Register a browser push subscription. */
export async function savePushSubscription(userId, { endpoint, keys }) {
  const db = requireDatabase();
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new HttpError(400, 'পুশ সাবস্ক্রিপশনের তথ্য সঠিক নয়।');
  }
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [userId, endpoint, keys.p256dh, keys.auth]
  );
  return { ok: true };
}

export { pool };
