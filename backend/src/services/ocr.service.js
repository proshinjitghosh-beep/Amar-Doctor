import { PDFParse } from 'pdf-parse';
import { completeVisionJson } from './groq.service.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Text extraction from medical documents.
 *
 * PDFs with a text layer are read directly - no OCR, no cost, and the exact
 * characters the laboratory printed. Images and scanned PDFs go through the
 * vision model. When no vision model is configured the caller is told
 * explicitly, so the patient can type the values in instead.
 */

const OCR_SYSTEM_PROMPT = `You transcribe medical laboratory reports and prescriptions.

Rules:
- Transcribe only what is printed. Never infer, complete, or correct a value.
- Preserve the original language of the document.
- Keep the printed reference ranges exactly as they appear.
- If a field is illegible, write null for it rather than guessing.
- Return only a JSON object with the keys: text, report_type, results, medicines.`;

const OCR_SCHEMA_HINT = `Return ONLY a valid JSON object shaped like:
{
  "text": "the full transcribed text of the document",
  "report_type": "CBC | LFT | KFT | Lipid | Blood Sugar | Thyroid | Urine | Blood Group | Other",
  "results": [
    { "test_name": "", "result_value": "", "unit": "", "reference_range": "" }
  ],
  "medicines": [
    { "medicine_name": "", "dosage": "", "instructions": "", "frequency": "" }
  ]
}`;

/** Extract the embedded text layer of a PDF. Returns '' for scanned PDFs. */
export async function extractPdfText(buffer) {
  let parser;
  try {
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    return { text: (result?.text || '').trim(), pageCount: result?.total || 0 };
  } catch (error) {
    throw new HttpError(422, 'PDF ফাইলটি পড়া যায়নি। ফাইলটি ক্ষতিগ্রস্ত হতে পারে।');
  } finally {
    await parser?.destroy?.();
  }
}

/** Render the first page of a PDF to PNG so it can be sent to the vision model. */
export async function renderPdfFirstPage(buffer, { scale = 1.5 } = {}) {
  let parser;
  try {
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getScreenshot({ scale, first: 1, last: 1 });
    const page = result?.pages?.[0];
    if (!page?.data) return null;
    return { base64: Buffer.from(page.data).toString('base64'), mimeType: 'image/png' };
  } catch {
    return null;
  } finally {
    await parser?.destroy?.();
  }
}

function normaliseOcrResult(raw) {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  const medicines = Array.isArray(raw?.medicines) ? raw.medicines : [];
  return {
    text: String(raw?.text || ''),
    reportType: raw?.report_type ? String(raw.report_type) : null,
    results: results
      .filter((item) => item && item.test_name)
      .map((item) => ({
        testName: String(item.test_name).trim(),
        resultValue: item.result_value === null || item.result_value === undefined ? null : String(item.result_value).trim(),
        unit: item.unit ? String(item.unit).trim() : null,
        referenceRange: item.reference_range ? String(item.reference_range).trim() : null,
      })),
    medicines: medicines
      .filter((item) => item && item.medicine_name)
      .map((item) => ({
        medicineName: String(item.medicine_name).trim(),
        dosage: item.dosage ? String(item.dosage).trim() : null,
        instructions: item.instructions ? String(item.instructions).trim() : null,
        frequency: item.frequency ? String(item.frequency).trim() : null,
      })),
  };
}

/**
 * Transcribe an image (or a rendered PDF page) using the vision model.
 * Throws an HttpError when no vision model is configured.
 */
export async function transcribeImage({ base64, mimeType = 'image/png' }) {
  const raw = await completeVisionJson({
    system: OCR_SYSTEM_PROMPT,
    prompt: `${OCR_SCHEMA_HINT}\n\nTranscribe this document.`,
    imageDataUrl: base64,
    mimeType,
    maxTokens: 4000,
  });
  return normaliseOcrResult(raw);
}

/**
 * Extract text and structure from any supported document.
 *
 * Returns { text, results, medicines, reportType, method, confidence }.
 * `confidence` is a coarse signal: a PDF text layer is high confidence, OCR
 * output is medium, and an unreadable document is low.
 */
export async function extractDocument({ buffer, mimeType }) {
  if (mimeType === 'application/pdf') {
    const { text, pageCount } = await extractPdfText(buffer);
    if (text.length >= 40) {
      return { text, results: [], medicines: [], reportType: null, method: 'pdf_text', confidence: 0.95, pageCount };
    }

    // Scanned PDF: render a page and read it with the vision model.
    const rendered = await renderPdfFirstPage(buffer);
    if (!rendered) {
      return { text, results: [], medicines: [], reportType: null, method: 'pdf_text', confidence: 0.2, pageCount };
    }
    const ocr = await transcribeImage({ base64: rendered.base64, mimeType: rendered.mimeType });
    return { ...ocr, method: 'ocr', confidence: 0.6 };
  }

  const base64 = Buffer.from(buffer).toString('base64');
  const ocr = await transcribeImage({ base64, mimeType });
  return { ...ocr, method: 'ocr', confidence: 0.6 };
}
