import {
  compareToRange,
  extractUnit,
  parseNumericValue,
  parseReferenceRange,
} from '../utils/medical-validation.js';

/**
 * Deterministic extraction of lab rows from a report's printed text.
 *
 * This is deliberately not done by the AI. The model is only allowed to
 * explain rows that were read here, so a value, a unit or a reference range
 * always comes from the document itself. When a line cannot be read with
 * confidence the row is marked "needs review" instead of being guessed.
 */

const TEST_NAME_CHARS = /[A-Za-zঀ-৿][A-Za-z0-9ঀ-৿ ()%.-]{1,60}/;

const KNOWN_TEST_NAMES = [
  'hemoglobin', 'hgb', 'haemoglobin',
  'total leukocyte', 'wbc', 'tlc', 'white blood cell',
  'platelet', 'plt', 'platelets',
  'neutrophil', 'lymphocyte', 'monocyte', 'eosinophil', 'basophil',
  'rbc', 'red blood cell', 'pcv', 'packed cell', 'esr', 'erythrocyte sedimentation',
  'fasting blood sugar', 'fbs', 'blood sugar', 'glucose', 'hba1c',
  'total cholesterol', 'cholesterol', 'triglyceride', 'tg', 'hdl', 'ldl',
  'sgpt', 'alt', 'sgot', 'ast', 'bilirubin', 'albumin', 'creatinine', 'urea',
  'uric acid', 'tsh', 't3', 't4', 'vitamin d', 'vitamin b12', 'ferritin', 'iron',
  'urine', 'protein', 'pH'.toLowerCase(),
];

const REPORT_TYPE_SIGNALS = [
  { type: 'CBC', terms: ['cbc', 'complete blood count', 'hemogram', 'haematology', 'রক্ত পরীক্ষা', 'সিবিসি',
    'hemoglobin', 'haemoglobin', 'hgb', 'platelet', 'wbc count', 'total leukocyte'] },
  { type: 'LFT', terms: ['lft', 'liver function', 'liver profile', 'কলেজা ফাংশন'] },
  { type: 'KFT', terms: ['kft', 'kidney function', 'renal function', 'কিডনি'] },
  { type: 'Lipid Profile', terms: ['lipid', 'cholesterol profile', 'লিপিড'] },
  { type: 'Blood Sugar', terms: ['blood sugar', 'glucose', 'hba1c', 'ডায়াবেটিস'] },
  { type: 'Thyroid', terms: ['thyroid', 'tsh', 'থাইরয়েড'] },
  { type: 'Urine', terms: ['urine', 'urinalysis', 'প্রস্রাব'] },
  { type: 'Blood Group', terms: ['blood group', 'abo', 'রক্তের গ্রুপ'] },
  { type: 'Electrolytes', terms: ['electrolyte', 'sodium', 'potassium', 'এলেকট্রোলাইট'] },
];

/** Detect the report category from the document text, never from the filename. */
export function detectReportType(text) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack.trim()) return null;
  for (const signal of REPORT_TYPE_SIGNALS) {
    if (signal.terms.some((term) => haystack.includes(term))) {
      return signal.type;
    }
  }
  return 'Other';
}

function normaliseName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[:*]/g, '')
    .trim();
}

function looksLikeTestName(line) {
  const normalized = normaliseName(line);
  if (!normalized || normalized.length < 3) return false;
  if (KNOWN_TEST_NAMES.some((known) => normalized.includes(known))) return true;
  // A test name is words, optionally with a parenthesised abbreviation, and
  // does not start with a number.
  return /^[a-zঀ-৿][a-zঀ-৿ ()%.-]{2,59}$/.test(normalized) && /[a-zঀ-৿]{3}/.test(normalized);
}

/**
 * Split a line into [name, value, unit, range].
 *
 * Handles the common lab layouts:
 *   "Hemoglobin              11.2 g/dL      12.0 - 16.0"
 *   "Total Cholesterol       180 mg/dL       < 200"
 *   "WBC 7,500 /uL 4,000 - 11,000"
 */
function splitLabRow(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // The value is the first token that is a number, optionally with a comma
  // thousands separator, a decimal point, a comparison prefix, or a +/- sign.
  const valueMatch = /(^|\s)([<>≤≥]?\s?-?\d[\d,]*\.?\d*)\s*/.exec(trimmed);
  if (!valueMatch) return null;

  const valueIndex = valueMatch.index + valueMatch[1].length;
  const value = valueMatch[2].trim();
  if (!value) return null;

  const name = trimmed.slice(0, valueIndex).trim().replace(/[:.]$/, '');
  if (!name || name.length > 80) return null;

  const rest = trimmed.slice(valueIndex + valueMatch[2].length).trim();

  // A reference range is usually the last group of numbers on the line.
  const rangeMatch = /(?:^|\s)([<>≤≥]?\s?-?\d[\d,]*\.?\d*\s*(?:-|–|—|to|থেকে)\s*-?\d[\d,]*\.?\d*|[<>≤≥]\s*-?\d[\d,]*\.?\d*)(?=\s|$)/i.exec(rest);
  let range = null;
  let remainder = rest;

  if (rangeMatch) {
    range = rangeMatch[1].trim();
    remainder = rest.replace(rangeMatch[1], ' ');
  }

  const unit = extractUnit(remainder.trim()) || null;

  return { name, value, unit, range };
}

/**
 * Many lab reports print the reference range on its own line underneath the
 * result, e.g.
 *
 *   Hemoglobin: 11.2 g/dL
 *   Reference: 12.0 - 16.0 g/dL
 *
 * Such a line carries no test name, so it is attached to the row above it.
 * The range still comes from the document — it is never supplied from a
 * generic table.
 */
const REFERENCE_LINE = /^\s*(?:reference|ref|norm(?:al)?\s*value|স্বাভাবিক\s*মান|রেফারেন্স)\s*[:\-–]?\s*(.+)$/i;

function parseReferenceLine(line) {
  const match = REFERENCE_LINE.exec(line);
  if (!match) return null;
  const body = match[1].trim();
  if (!body) return null;
  // A reference line must actually contain a range or an inequality.
  if (!/\d/.test(body)) return null;
  if (!(/[-–—]|\bto\b|থেকে|[<>≤≥]/i.test(body))) return null;
  const parsed = parseReferenceRange(body);
  if (!parsed) return null;
  return { raw: body, range: parsed };
}

/**
 * Parse the printed text of a report into structured rows.
 *
 * Each row carries `confidence`: 'high' when the value and range were both
 * read cleanly, 'low' when the line was only partly understood.
 */
export function parseLabResults(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  const seen = new Set();

  for (const line of lines) {
    if (line.length > 200) continue;

    // A standalone reference line belongs to the row printed above it.
    if (rows.length > 0) {
      const reference = parseReferenceLine(line);
      if (reference) {
        const previous = rows[rows.length - 1];
        if (!previous.referenceRange && reference.range) {
          previous.referenceRange = reference.raw;
          previous.unit = previous.unit || reference.range.unit || null;
          previous.status = compareToRange(previous.numericValue, reference.range);
          previous.requiresReview = false;
          previous.confidence = 'high';
        }
        continue;
      }
    }

    if (!looksLikeTestName(line)) continue;

    const parsed = splitLabRow(line);
    if (!parsed) continue;

    const numeric = parseNumericValue(parsed.value);
    if (numeric === null) continue;

    const key = normaliseName(parsed.name);
    if (seen.has(key)) continue;
    seen.add(key);

    const range = parseReferenceRange(parsed.range);
    const status = compareToRange(numeric, range);

    rows.push({
      testName: parsed.name,
      resultValue: parsed.value,
      unit: parsed.unit || (range ? range.unit : null),
      referenceRange: parsed.range || null,
      status,
      numericValue: numeric,
      // Without a printed range there is nothing to compare against, so the
      // row must be reviewed by a human rather than called "normal".
      requiresReview: !range,
      confidence: range ? 'high' : 'low',
    });
  }

  return rows;
}

/**
 * Parse the printed text of a prescription into medicine candidates.
 *
 * A dosage is only read when it is printed next to the medicine name; the
 * parser never infers one, and a medicine with no readable dosage is flagged
 * so the patient confirms it before anything is scheduled.
 */
export function parsePrescriptionMedicines(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = [];
  const seen = new Set();

  const DOSE_PATTERN = /(\d+(?:\.\d+)?\s*(?:mg|ml|g|mcg|µg|ug|iu|units?)\b|[\d/]+\s*(?:tablet|tab|capsule|cap|drop|spoonful)|1\/2|1\/4|half|quarter)/i;
  const FREQUENCY_PATTERN = /(once|twice|three times|daily|bd|tds|od|qid|hs|before food|after food|empty stomach|রোজ|দিনে|বার|খাবারের|খাবারের পর|খাবারের আগে)/i;

  for (const line of lines) {
    if (line.length > 180) continue;

    // A medicine line usually starts with a name, optionally with a dose.
    const match = /^([A-Za-zঀ-৿][A-Za-z0-৿ ()'-]{1,60}?)\s*[:,-]?\s*(.*)$/.exec(line);
    if (!match) continue;

    const name = match[1].trim();
    const rest = match[2].trim();

    if (name.length < 3 || /^\d+$/.test(name)) continue;
    if (!/[A-Za-zঀ-৿]{3}/.test(name)) continue;

    const key = normaliseName(name);
    if (seen.has(key)) continue;
    seen.add(key);

    const doseMatch = DOSE_PATTERN.exec(rest);
    const frequencyMatch = FREQUENCY_PATTERN.exec(rest);

    candidates.push({
      medicineName: name,
      dosage: doseMatch ? doseMatch[1].trim() : null,
      instructions: rest ? rest.slice(0, 200) : null,
      frequency: frequencyMatch ? frequencyMatch[1].trim() : null,
      // The patient must confirm a medicine before it becomes a schedule.
      requiresReview: true,
    });
  }

  return candidates;
}

/**
 * Combine OCR-provided rows with rows parsed from the text, preferring the
 * deterministic parse and keeping only values that actually appear in the
 * document.
 */
export function mergeExtractionResults({ parsedRows, ocrRows = [], text = '' }) {
  const haystack = normaliseName(text);
  const merged = [];
  const seen = new Set();

  for (const row of parsedRows) {
    const key = normaliseName(row.testName);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...row, source: 'text' });
  }

  for (const row of ocrRows) {
    const key = normaliseName(row.testName);
    if (seen.has(key)) continue;

    // Only accept an OCR value when the test name is printed in the document.
    // A name the OCR invented is discarded rather than shown as a result.
    if (haystack && !haystack.includes(key)) continue;

    const numeric = parseNumericValue(row.resultValue);
    const range = parseReferenceRange(row.referenceRange);
    merged.push({
      testName: row.testName,
      resultValue: row.resultValue,
      unit: row.unit || (range ? range.unit : null),
      referenceRange: row.referenceRange || null,
      status: compareToRange(numeric, range),
      numericValue: numeric,
      requiresReview: !range,
      confidence: range ? 'high' : 'low',
      source: 'ocr',
    });
    seen.add(key);
  }

  return merged;
}
