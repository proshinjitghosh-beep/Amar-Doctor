import { Router } from 'express';
import { register, login, logout, me, logoutAll } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/authentication.js';
import { asyncHandler } from '../middleware/ownership-check.js';

const router = Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.post('/logout-all', requireAuth, asyncHandler(logoutAll));
router.get('/me', requireAuth, asyncHandler(me));

export default router;
