import { requireDatabase } from '../config/database.js';

function mapReport(row, { includeText = false } = {}) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    reportType: row.report_type,
    extractionMethod: row.extraction_method,
    extractionConfidence: row.extraction_confidence === null ? null : Number(row.extraction_confidence),
    extractedText: includeText ? row.extracted_text : undefined,
    analysisStatus: row.analysis_status,
    analysis: row.analysis_json,
    analysisLanguage: row.analysis_language,
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapResult(row) {
  return {
    id: Number(row.id),
    reportId: Number(row.report_id),
    testName: row.test_name,
    resultValue: row.result_value,
    unit: row.unit,
    referenceRange: row.reference_range,
    status: row.status,
    interpretation: row.interpretation,
    explanation: row.explanation,
    requiresReview: row.requires_review === true,
    verificationStatus: row.verification_status,
  };
}

export async function insertReport({
  userId,
  fileName,
  mimeType,
  buffer,
  reportType = null,
  extractionMethod = null,
  extractionConfidence = null,
  extractedText = null,
}) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `INSERT INTO medical_reports
       (user_id, file_name, mime_type, byte_size, file_data, report_type,
        extraction_method, extraction_confidence, extracted_text, analysis_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
     RETURNING *`,
    [
      userId,
      fileName,
      mimeType,
      buffer.length,
      buffer,
      reportType,
      extractionMethod,
      extractionConfidence,
      extractedText,
    ]
  );
  return mapReport(rows[0]);
}

export async function listReports(userId, limit = 50) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT id, user_id, file_name, mime_type, byte_size, report_type, extraction_method,
            extraction_confidence, analysis_status, analysis_json, analysis_language,
            verification_status, created_at, updated_at
       FROM medical_reports
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(200, Math.max(1, limit))]
  );
  return rows.map((row) => mapReport(row));
}

export async function findReportById(reportId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT id, user_id, file_name, mime_type, byte_size, report_type, extraction_method,
            extraction_confidence, extracted_text, analysis_status, analysis_json,
            analysis_language, verification_status, created_at, updated_at
       FROM medical_reports
      WHERE id = $1 AND user_id = $2`,
    [reportId, userId]
  );
  return mapReport(rows[0], { includeText: true });
}

/** Fetch the stored bytes. Only ever called after an ownership check. */
export async function findReportFile(reportId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    'SELECT id, user_id, file_name, mime_type, file_data FROM medical_reports WHERE id = $1 AND user_id = $2',
    [reportId, userId]
  );
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    fileName: rows[0].file_name,
    mimeType: rows[0].mime_type,
    buffer: rows[0].file_data,
  };
}

export async function updateReportAnalysis(reportId, userId, { analysis, reportType, language, status }) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE medical_reports
        SET analysis_json = $3,
            report_type = COALESCE($4, report_type),
            analysis_language = COALESCE($5, analysis_language),
            analysis_status = $6,
            updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [reportId, userId, analysis ? JSON.stringify(analysis) : null, reportType, language, status]
  );
  return mapReport(rows[0]);
}

export async function updateReportExtraction(reportId, userId, { extractedText, extractionMethod, extractionConfidence, reportType }) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE medical_reports
        SET extracted_text = $3,
            extraction_method = $4,
            extraction_confidence = $5,
            report_type = COALESCE($6, report_type),
            updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [reportId, userId, extractedText, extractionMethod, extractionConfidence, reportType]
  );
  return mapReport(rows[0]);
}

export async function deleteReport(reportId, userId) {
  const db = requireDatabase();
  const { rowCount } = await db.query('DELETE FROM medical_reports WHERE id = $1 AND user_id = $2', [
    reportId,
    userId,
  ]);
  return rowCount > 0;
}

// ------------------------------------------------------- report results ----

export async function replaceReportResults(reportId, userId, results) {
  const db = requireDatabase();
  await db.query('DELETE FROM report_results WHERE report_id = $1 AND user_id = $2', [reportId, userId]);

  const created = [];
  for (const result of results) {
    const { rows } = await db.query(
      `INSERT INTO report_results
         (report_id, user_id, test_name, result_value, unit, reference_range, status,
          interpretation, explanation, requires_review, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        reportId,
        userId,
        result.testName,
        result.resultValue,
        result.unit,
        result.referenceRange,
        result.status,
        result.interpretation,
        result.explanation,
        result.requiresReview,
        result.verificationStatus,
      ]
    );
    created.push(mapResult(rows[0]));
  }
  return created;
}

export async function listReportResults(reportId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    'SELECT * FROM report_results WHERE report_id = $1 AND user_id = $2 ORDER BY id',
    [reportId, userId]
  );
  return rows.map(mapResult);
}

export async function confirmReportResult(resultId, userId, verificationStatus) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE report_results
        SET verification_status = $3
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [resultId, userId, verificationStatus]
  );
  if (!rows[0]) return null;
  await db.query(
    `UPDATE medical_reports
        SET verification_status = $3, updated_at = NOW()
      WHERE id = $1 AND user_id = $2`,
    [rows[0].report_id, userId, verificationStatus]
  );
  return mapResult(rows[0]);
}
