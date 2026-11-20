import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  activate,
  notify,
  resolve,
  history,
  hospitals,
} from '../controllers/emergency.controller.js';
import { requireAuth } from '../middleware/authentication.js';
import { asyncHandler } from '../middleware/ownership-check.js';

const router = Router();

router.use(requireAuth);

router.get('/profile', asyncHandler(getProfile));
router.put('/profile', asyncHandler(updateProfile));

router.get('/contacts', asyncHandler(listContacts));
router.post('/contacts', asyncHandler(createContact));
router.put('/contacts/:id', asyncHandler(updateContact));
router.delete('/contacts/:id', asyncHandler(deleteContact));

router.post('/activate', asyncHandler(activate));
router.post('/:id/notify', asyncHandler(notify));
router.post('/:id/resolve', asyncHandler(resolve));
router.get('/history', asyncHandler(history));
router.get('/hospitals', asyncHandler(hospitals));

export default router;
