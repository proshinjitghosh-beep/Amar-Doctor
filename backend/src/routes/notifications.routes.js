import { Router } from 'express';
import {
  listNotifications,
  markNotificationsRead,
  savePushSubscription,
  isPushConfigured,
} from '../services/notification.service.js';
import { requireAuth } from '../middleware/authentication.js';
import { asyncHandler } from '../middleware/ownership-check.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const notifications = await listNotifications(req.user.id, {
    limit: req.query?.limit,
    unreadOnly: req.query?.unread === 'true',
  });
  res.json({ notifications, pushConfigured: isPushConfigured() });
}));

router.post('/read', asyncHandler(async (req, res) => {
  const count = await markNotificationsRead(req.user.id);
  res.json({ ok: true, count });
}));

router.post('/push-subscription', asyncHandler(async (req, res) => {
  await savePushSubscription(req.user.id, req.body || {});
  res.json({ ok: true });
}));

export default router;
