import { Router } from 'express';
import {
  createSummary,
  getSummary,
  listSummaries,
  updateSummary,
  approveSummary,
  regenerateSummary,
  exportSummary,
  shareSummary,
  revokeShare,
  viewShared,
} from '../controllers/doctor-prep.controller.js';
import { requireAuth } from '../middleware/authentication.js';
import { asyncHandler } from '../middleware/ownership-check.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listSummaries));
router.post('/create', asyncHandler(createSummary));
router.get('/:id', asyncHandler(getSummary));
router.put('/:id', asyncHandler(updateSummary));
router.post('/:id/approve', asyncHandler(approveSummary));
router.post('/:id/regenerate', asyncHandler(regenerateSummary));
router.get('/:id/export', asyncHandler(exportSummary));
router.post('/:id/share', asyncHandler(shareSummary));
router.post('/:id/revoke-share/:shareId', asyncHandler(revokeShare));

export default router;

// Public read of a shared summary, guarded by the revocable token.
export const sharedRouter = Router();
sharedRouter.get('/', asyncHandler(viewShared));
