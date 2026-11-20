import { Router } from 'express';
import { dispatchDueReminders } from '../services/reminder-dispatcher.service.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const router = Router();

/**
 * The cron endpoint.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically. The
 * secret is required, so this endpoint cannot be triggered by anyone who
 * finds the URL.
 */
router.post('/reminders/dispatch', async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!env.cronSecret) {
      throw new HttpError(503, 'CRON_SECRET সেট করা হয়নি।');
    }
    if (!token || token !== env.cronSecret) {
      throw new HttpError(401, 'অনুমোদন নেই।');
    }

    const summary = await dispatchDueReminders();
    return res.json({ ok: true, ...summary });
  } catch (error) {
    return next(error);
  }
});

export default router;
