import { Router } from 'express';
import {
  uploadReport,
  listReports,
  getReport,
  analyzeReportEndpoint,
  askAboutReport,
  downloadReport,
  deleteReport,
  confirmResults,
  createManualResult,
} from '../controllers/reports.controller.js';
import { requireAuth } from '../middleware/authentication.js';
import { asyncHandler } from '../middleware/ownership-check.js';
import { upload } from '../middleware/upload-validation.js';
import { uploadLimiter } from '../middleware/rate-limiters.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listReports));
router.post('/upload', uploadLimiter, upload.single('file'), asyncHandler(uploadReport));
router.get('/:id', asyncHandler(getReport));
router.post('/:id/analyze', asyncHandler(analyzeReportEndpoint));
router.post('/:id/ask', asyncHandler(askAboutReport));
// A value the patient typed in by hand, for a report the server could not read.
router.post('/:id/results', asyncHandler(createManualResult));
router.patch('/:id/results', asyncHandler(confirmResults));
router.get('/:id/download', asyncHandler(downloadReport));
router.delete('/:id', asyncHandler(deleteReport));

export default router;
