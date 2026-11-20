import { Router } from 'express';
import {
  listMedications,
  createMedication,
  getMedication,
  updateMedication,
  discontinueMedication,
  listReminders,
  createReminder,
  updateReminder,
  deleteReminder,
  markDoseTaken,
  markDoseSkipped,
  snoozeDose,
  getAdherenceEndpoint,
  getRefillStatusEndpoint,
  extractPrescription,
  importPrescription,
} from '../controllers/medications.controller.js';
import { requireAuth } from '../middleware/authentication.js';
import { asyncHandler } from '../middleware/ownership-check.js';
import { upload } from '../middleware/upload-validation.js';

const router = Router();

router.use(requireAuth);

// Static segments must be declared before the ":id" parameter routes,
// otherwise "adherence" would be matched as an id.
router.get('/adherence', asyncHandler(getAdherenceEndpoint));
router.get('/refill-status', asyncHandler(getRefillStatusEndpoint));
router.post('/extract-prescription', upload.single('file'), asyncHandler(extractPrescription));
router.post('/import-prescription', asyncHandler(importPrescription));

router.get('/', asyncHandler(listMedications));
router.post('/', asyncHandler(createMedication));
router.get('/:id', asyncHandler(getMedication));
router.put('/:id', asyncHandler(updateMedication));
router.delete('/:id', asyncHandler(discontinueMedication));

export default router;

export const reminderRouter = Router();

reminderRouter.use(requireAuth);
reminderRouter.get('/', asyncHandler(listReminders));
reminderRouter.post('/', asyncHandler(createReminder));
reminderRouter.put('/:id', asyncHandler(updateReminder));
reminderRouter.delete('/:id', asyncHandler(deleteReminder));
reminderRouter.post('/:id/taken', asyncHandler(markDoseTaken));
reminderRouter.post('/:id/skipped', asyncHandler(markDoseSkipped));
reminderRouter.post('/:id/snooze', asyncHandler(snoozeDose));
