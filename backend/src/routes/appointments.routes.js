import { Router } from 'express';
import { createAppointment, listAppointments } from '../controllers/appointments.controller.js';
import { requireAuth } from '../middleware/authentication.js';
import { asyncHandler } from '../middleware/ownership-check.js';

const router = Router();

router.use(requireAuth);
router.get('/', asyncHandler(listAppointments));
router.post('/', asyncHandler(createAppointment));

export default router;
