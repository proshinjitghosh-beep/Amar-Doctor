import { z } from 'zod';
import * as reportsRepo from '../repositories/reports.repository.js';
import { extractDocument } from '../services/ocr.service.js';
import { detectReportType, mergeExtractionResults, parseLabResults } from '../services/report-parser.service.js';
import { analyzeReport, answerQuestionAboutReport } from '../services/report-analysis.service.js';
import { validateUpload } from '../middleware/upload-validation.js';
import { assertOwner } from '../middleware/ownership-check.js';
import { recordAudit } from '../services/audit.service.js';
import { HttpError } from '../utils/http-error.js';
import {
  cleanText,
  compareToRange,
  parseNumericValue,
  parseReferenceRange,
} from '../utils/medical-validation.js';

const askSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  language: z.enum(['bn', 'en']).optional(),
});

const confirmSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(['normal', 'below_reference', 'above_reference', 'critical_high', 'critical_low', 'unknown']),
      })
    )
    .min(1)
    .max(200),
});

/**
 * A value the patient typed in by hand.
 *
 * There is deliberately no `status` field: the app must never accept a
 * normal/abnormal judgement from the client. The status is the server's own
 * comparison of the value against the reference range, and stays `unknown`
 * when no range was typed.
 */
const manualResultSchema = z.object({
  testName: z.string().trim().min(1).max(160),
  resultValue: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(40).optional(),
  referenceRange: z.string().trim().max(60).optional(),
});

/**
 * Store an uploaded report and extract its contents.
 *
 * The upload itself succeeds even when the AI is unavailable - the file is
 * kept and the report is marked "pending" so the patient can retry.
 */
export async function uploadReport(req, res, next) {
  try {
    const { detectedType } = validateUpload(req.file);
    const userId = req.user.id;

    const fileName = cleanText(req.file.originalname || 'report', 180);
    const report = await reportsRepo.insertReport({
      userId,
      fileName,
      mimeType: detectedType,
      buffer: req.file.buffer,
    });

    await recordAudit({ userId, action: 'report.upload', resourceType: 'medical_report', resourceId: report.id });

    let extraction = null;
    try {
      extraction = await extractDocument({ buffer: req.file.buffer, mimeType: detectedType });
    } catch (error) {
      // An unreadable document is not an upload failure: the file is kept and
      // the patient is told the text could not be read.
      extraction = { text: '', results: [], medicines: [], reportType: null, method: 'failed', confidence: 0 };
    }

    const parsedRows = parseLabResults(extraction.text || '');
    const merged = mergeExtractionResults({
      parsedRows,
      ocrRows: extraction.results || [],
      text: extraction.text || '',
    });

    const reportType = detectReportType(extraction.text || '') || extraction.reportType || null;

    await reportsRepo.updateReportExtraction(report.id, userId, {
      extractedText: extraction.text || null,
      extractionMethod: extraction.method,
      extractionConfidence: extraction.confidence,
      reportType,
    });

    if (merged.length) {
      await reportsRepo.replaceReportResults(
        report.id,
        userId,
        merged.map((row) => ({
          testName: row.testName,
          resultValue: row.resultValue,
          unit: row.unit,
          referenceRange: row.referenceRange,
          status: row.status,
          interpretation: null,
          explanation: null,
          requiresReview: row.requiresReview,
          verificationStatus: row.requiresReview ? 'needs_review' : 'extracted',
        }))
      );
    }

    const [updated, results] = await Promise.all([
      reportsRepo.findReportById(report.id, userId),
      reportsRepo.listReportResults(report.id, userId),
    ]);

    return res.status(201).json({
      report: updated,
      results,
      extraction: {
        method: extraction.method,
        confidence: extraction.confidence,
        textLength: (extraction.text || '').length,
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function listReports(req, res, next) {
  try {
    const reports = await reportsRepo.listReports(req.user.id);
    return res.json({ reports });
  } catch (error) {
    return next(error);
  }
}

export async function getReport(req, res, next) {
  try {
    const userId = req.user.id;
    const report = await reportsRepo.findReportById(req.params.id, userId);
    assertOwner(report, userId, 'রিপোর্ট');
    const results = await reportsRepo.listReportResults(report.id, userId);
    return res.json({ report, results });
  } catch (error) {
    return next(error);
  }
}

/**
 * Run (or re-run) the AI explanation of a report.
 *
 * When the AI is unavailable the report is marked "unavailable" and the
 * extracted rows are still returned. No placeholder analysis is produced.
 */
export async function analyzeReportEndpoint(req, res, next) {
  try {
    const userId = req.user.id;
    const report = await reportsRepo.findReportById(req.params.id, userId);
    assertOwner(report, userId, 'রিপোর্ট');

    const language = req.body?.language === 'en' ? 'en' : 'bn';

    if (!report.extractedText || report.extractedText.trim().length < 10) {
      await reportsRepo.updateReportAnalysis(report.id, userId, {
        analysis: null,
        reportType: report.reportType,
        language,
        status: 'unavailable',
      });
      const results = await reportsRepo.listReportResults(report.id, userId);
      const updated = await reportsRepo.findReportById(report.id, userId);
      return res.status(422).json({
        error: 'এই রিপোর্টের লেখা পড়া যায়নি। ফাইলটি আবার আপলোড করুন অথবা মানগুলো নিজে লিখুন।',
        report: updated,
        results,
      });
    }

    await reportsRepo.updateReportAnalysis(report.id, userId, {
      analysis: null,
      reportType: report.reportType,
      language,
      status: 'analyzing',
    });

    let rows = await reportsRepo.listReportResults(report.id, userId);
    if (!rows.length) {
      const parsed = parseLabResults(report.extractedText);
      if (parsed.length) {
        rows = await reportsRepo.replaceReportResults(
          report.id,
          userId,
          parsed.map((row) => ({
            testName: row.testName,
            resultValue: row.resultValue,
            unit: row.unit,
            referenceRange: row.referenceRange,
            status: row.status,
            interpretation: null,
            explanation: null,
            requiresReview: row.requiresReview,
            verificationStatus: row.requiresReview ? 'needs_review' : 'extracted',
          }))
        );
      }
    }

    let analysis;
    try {
      analysis = await analyzeReport({
        rows: rows.map((row) => ({
          testName: row.testName,
          resultValue: row.resultValue,
          unit: row.unit,
          referenceRange: row.referenceRange,
          status: row.status,
          requiresReview: row.requiresReview,
          source: row.source,
        })),
        language,
        reportType: report.reportType,
      });
    } catch (error) {
      await reportsRepo.updateReportAnalysis(report.id, userId, {
        analysis: null,
        reportType: report.reportType,
        language,
        status: 'unavailable',
      });
      const updated = await reportsRepo.findReportById(report.id, userId);
      return res.status(503).json({
        error: 'AI বিশ্লেষণ এখন উপলব্ধ নেই। রিপোর্টটি সংরক্ষিত আছে, পরে আবার চেষ্টা করুন।',
        report: updated,
        results: rows,
      });
    }

    // Store the AI explanations against the rows we extracted.
    const explanationByName = new Map(
      (analysis.results || []).map((entry) => [String(entry.testName || '').toLowerCase(), entry])
    );
    await reportsRepo.replaceReportResults(
      report.id,
      userId,
      rows.map((row) => {
        const match = explanationByName.get(row.testName.toLowerCase());
        return {
          testName: row.testName,
          resultValue: row.resultValue,
          unit: row.unit,
          referenceRange: row.referenceRange,
          // The status always comes from our own comparison against the
          // printed reference range - the AI cannot change it.
          status: row.status,
          interpretation: match?.interpretation || null,
          explanation: match?.explanation || null,
          requiresReview: match?.requiresReview ?? row.requiresReview,
          verificationStatus: row.verificationStatus,
          // A value the patient typed in by hand keeps its label.
          source: row.source,
        };
      })
    );

    await reportsRepo.updateReportAnalysis(report.id, userId, {
      analysis,
      reportType: analysis.report_type || report.reportType,
      language,
      status: 'analyzed',
    });

    await recordAudit({ userId, action: 'report.analyze', resourceType: 'medical_report', resourceId: report.id });

    const updated = await reportsRepo.findReportById(report.id, userId);
    const results = await reportsRepo.listReportResults(report.id, userId);
    return res.json({ report: updated, results, analysis });
  } catch (error) {
    return next(error);
  }
}

export async function askAboutReport(req, res, next) {
  try {
    const userId = req.user.id;
    const report = await reportsRepo.findReportById(req.params.id, userId);
    assertOwner(report, userId, 'রিপোর্ট');

    const parsed = askSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'আপনার প্রশ্নটি লিখুন।');
    }

    const rows = await reportsRepo.listReportResults(report.id, userId);
    let answer;
    try {
      answer = await answerQuestionAboutReport({
        rows: rows.map((row) => ({
          testName: row.testName,
          resultValue: row.resultValue,
          unit: row.unit,
          referenceRange: row.referenceRange,
          source: row.source,
        })),
        question: parsed.data.question,
        language: parsed.data.language || 'bn',
      });
    } catch (error) {
      // The provider's own error is English and names the provider. The
      // patient gets a plain Bangla explanation instead.
      throw new HttpError(503, 'AI সেবাটি এখন উপলব্ধ নেই। রিপোর্টটি সংরক্ষিত আছে — পরে আবার চেষ্টা করুন।');
    }

    return res.json({ answer: answer.answer, grounded: answer.grounded });
  } catch (error) {
    return next(error);
  }
}

export async function downloadReport(req, res, next) {
  try {
    const userId = req.user.id;
    const file = await reportsRepo.findReportFile(req.params.id, userId);
    if (!file) {
      throw new HttpError(404, 'রিপোর্ট পাওয়া যায়নি।');
    }
    await recordAudit({ userId, action: 'report.download', resourceType: 'medical_report', resourceId: file.id });
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`);
    res.setHeader('Content-Length', String(file.buffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(file.buffer);
  } catch (error) {
    return next(error);
  }
}

export async function deleteReport(req, res, next) {
  try {
    const userId = req.user.id;
    const deleted = await reportsRepo.deleteReport(req.params.id, userId);
    if (!deleted) {
      throw new HttpError(404, 'রিপোর্ট পাওয়া যায়নি।');
    }
    await recordAudit({ userId, action: 'report.delete', resourceType: 'medical_report', resourceId: req.params.id });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

/**
 * Record a value the patient typed in by hand.
 *
 * This is the path for a report the server could not read - a scanned PDF
 * with no vision model configured, or an unreadable file. The patient
 * supplies the value and, optionally, the reference range printed on their
 * report; the status is computed by the server from that range and stays
 * `unknown` when there is none. Nothing about the value is invented.
 */
export async function createManualResult(req, res, next) {
  try {
    const userId = req.user.id;
    const report = await reportsRepo.findReportById(req.params.id, userId);
    assertOwner(report, userId, 'রিপোর্ট');

    const parsed = manualResultSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'ফলাফলের তথ্য সঠিক নয়। পরীক্ষার নাম ও ফলাফল লিখুন।');
    }

    const referenceRange = parsed.data.referenceRange ? cleanText(parsed.data.referenceRange, 60) : null;
    // The same deterministic comparison the extractor uses for values it
    // read. No AI is involved, and an unreadable range yields `unknown`
    // rather than a guess.
    const status = compareToRange(
      parseNumericValue(parsed.data.resultValue),
      parseReferenceRange(referenceRange)
    );

    const created = await reportsRepo.insertManualReportResult(report.id, userId, {
      testName: cleanText(parsed.data.testName, 160),
      resultValue: cleanText(parsed.data.resultValue, 120),
      unit: parsed.data.unit ? cleanText(parsed.data.unit, 40) : null,
      referenceRange,
      status,
    });

    await recordAudit({
      userId,
      action: 'report.result.manual',
      resourceType: 'medical_report',
      resourceId: report.id,
    });

    const results = await reportsRepo.listReportResults(report.id, userId);
    return res.status(201).json({
      result: created,
      results,
      notice:
        status === 'unknown'
          ? 'ফলাফলটি সংরক্ষণ করা হয়েছে। রিপোর্টে রেঞ্জ দেওয়া না থাকলে স্বাভাবিক-অস্বাভাবিক বিচার করা যায় না।'
          : 'ফলাফলটি সংরক্ষণ করা হয়েছে। স্ট্যাটাসটি রিপোর্টে দেওয়া রেঞ্জের সাথে তুলনা করে নির্ণয় করা হয়েছে।',
    });
  } catch (error) {
    return next(error);
  }
}

/** The patient confirms (or corrects) the values read from the report. */
export async function confirmResults(req, res, next) {
  try {
    const userId = req.user.id;
    const report = await reportsRepo.findReportById(req.params.id, userId);
    assertOwner(report, userId, 'রিপোর্ট');

    const parsed = confirmSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'ফলাফলের তথ্য সঠিক নয়।');
    }

    const updated = [];
    for (const entry of parsed.data.results) {
      const result = await reportsRepo.confirmReportResult(entry.id, userId, 'patient_confirmed');
      if (result) updated.push(result);
    }

    await recordAudit({ userId, action: 'report.confirm', resourceType: 'medical_report', resourceId: report.id });
    const results = await reportsRepo.listReportResults(report.id, userId);
    return res.json({ results: updated.length ? updated : results });
  } catch (error) {
    return next(error);
  }
}
