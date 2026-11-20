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
} from '../controllers/reports.controller.js';
import { requireAuth } from '../middleware/authentication.js';
import { asyncHandler } from '../middleware/ownership-check.js';
import { upload } from '../middleware/upload-validation.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listReports));
router.post('/upload', upload.single('file'), asyncHandler(uploadReport));
router.get('/:id', asyncHandler(getReport));
router.post('/:id/analyze', asyncHandler(analyzeReportEndpoint));
router.post('/:id/ask', asyncHandler(askAboutReport));
router.patch('/:id/results', asyncHandler(confirmResults));
router.get('/:id/download', asyncHandler(downloadReport));
router.delete('/:id', asyncHandler(deleteReport));

export default router;
