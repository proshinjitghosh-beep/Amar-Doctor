import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  listSymptomsEndpoint,
  createSymptomEndpoint,
  deleteSymptomEndpoint,
} from '../controllers/health-profile.controller.js';
import { requireAuth } from '../middleware/authentication.js';
import { asyncHandler } from '../middleware/ownership-check.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(getProfile));
router.put('/', asyncHandler(updateProfile));

router.get('/symptoms', asyncHandler(listSymptomsEndpoint));
router.post('/symptoms', asyncHandler(createSymptomEndpoint));
router.delete('/symptoms/:id', asyncHandler(deleteSymptomEndpoint));

export default router;
