import { Router } from 'express';
import { register, login, logout, me, logoutAll } from '../controllers/auth.controller.js';
import { requireAuth, optionalAuth } from '../middleware/authentication.js';
import { asyncHandler } from '../middleware/ownership-check.js';
import { authLimiter, sessionLimiter } from '../middleware/rate-limiters.js';

const router = Router();

// The credential endpoints carry the strict brute-force limit. The session
// check has its own, much looser budget because the frontend calls it on
// every page load.
router.post('/register', authLimiter, asyncHandler(register));
router.post('/login', authLimiter, asyncHandler(login));
// Logout stays public so a stale cookie can always be cleared, but
// `optionalAuth` still resolves the token so the server-side session row is
// actually revoked - otherwise the token stays valid for its whole TTL.
router.post('/logout', optionalAuth, asyncHandler(logout));
router.post('/logout-all', requireAuth, asyncHandler(logoutAll));
router.get('/me', sessionLimiter, requireAuth, asyncHandler(me));

export default router;
