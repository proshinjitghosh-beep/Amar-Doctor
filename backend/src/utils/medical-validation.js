/**
 * Validation helpers for health data.
 *
 * These exist so that untrusted input is rejected before it reaches the
 * database or the AI provider, and so that the AI's structured output is
 * checked against a fixed set of allowed values before it is stored.
 */

export const REPORT_RESULT_STATUSES = [
  'normal',
  'below_reference',
  'above_reference',
  'critical_high',
  'critical_low',
  'unknown',
];

export const VERIFICATION_STATUSES = [
  'extracted',
  'needs_review',
  'patient_confirmed',
  'clinician_confirmed',
];

export const MEDICATION_STATUSES = ['active', 'paused', 'discontinued'];

export const DOSE_STATUSES = ['scheduled', 'taken', 'skipped', 'snoozed', 'missed'];

export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed', 'unavailable'];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** Trim, collapse runs of whitespace, and cap the length. */
export function cleanText(value, maxLength = 2000) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Preserve line breaks (used for notes and free-text clinical context). */
export function cleanMultiline(value, maxLength = 4000) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

/**
 * Split a free-text list (allergies, conditions) into clean entries.
 * Accepts an array or a newline / comma separated string.
 */
export function cleanList(value, maxItems = 50) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[\n,;]/);
  return source
    .map((item) => cleanText(item, 200))
    .filter(Boolean)
    .slice(0, maxItems);
}

/** A blood group must be one of the known groups, or blank. */
export function isValidBloodGroup(value) {
  const group = cleanText(value, 5).toUpperCase();
  return group === '' || BLOOD_GROUPS.includes(group);
}

/** Phone numbers are stored as digits with an optional leading +. */
export function cleanPhone(value) {
  return cleanText(value, 30).replace(/[^\d+]/g, '');
}

export function isValidPhone(value) {
  const digits = cleanPhone(value).replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15;
}

/**
 * A numeric result value that may legitimately be absent. Returns null when
 * the string is not a plain number so callers can mark it "needs review"
 * rather than guessing.
 */
export function parseNumericValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/,/g, '');
  if (!text) return null;
  const match = /^-?\d+(?:\.\d+)?$/.exec(text);
  if (!match) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse a reference range printed on a report. Accepts "12-16", "12 - 16",
 * "12.0 - 16.0 g/dL", and single-sided forms like "<5" or ">200".
 *
 * Returns null when the range cannot be read - the caller must then treat the
 * status as unknown rather than substituting a generic range.
 */
export function parseReferenceRange(rangeText) {
  const raw = cleanText(rangeText, 60);
  if (!raw) return null;

  const numeric = /(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to|থেকে)\s*(-?\d+(?:\.\d+)?)/i.exec(raw);
  if (numeric) {
    const low = Number(numeric[1]);
    const high = Number(numeric[2]);
    if (Number.isFinite(low) && Number.isFinite(high)) {
      return { low: Math.min(low, high), high: Math.max(low, high), unit: extractUnit(raw), raw };
    }
  }

  const lessThan = /^<\s*(-?\d+(?:\.\d+)?)/.exec(raw);
  if (lessThan) {
    return { low: null, high: Number(lessThan[1]), unit: extractUnit(raw), raw };
  }

  const greaterThan = /^>\s*(-?\d+(?:\.\d+)?)/.exec(raw);
  if (greaterThan) {
    return { low: Number(greaterThan[1]), high: null, unit: extractUnit(raw), raw };
  }

  return null;
}

const UNIT_PATTERN =
  /([a-zA-Zµμ%/°]+(?:\/[a-zA-Zµμ%/°]+)*)\s*$/;

/** Pull a trailing unit token off a range string ("12-16 g/dL" -> "g/dL"). */
export function extractUnit(text) {
  const raw = cleanText(text, 60);
  const match = UNIT_PATTERN.exec(raw);
  if (!match) return '';
  // A bare number is not a unit.
  if (/^[\d.]+$/.test(match[1])) return '';
  return match[1];
}

/**
 * Compare a measured value against a parsed reference range.
 *
 * `critical` thresholds are deliberately conservative: they flag a value that
 * sits far outside the printed range, and the result still requires a clinician
 * to interpret. They never imply a diagnosis.
 */
export function compareToRange(value, range) {
  if (value === null || !range) return 'unknown';
  if (range.low !== null && value < range.low) {
    const span = range.high !== null ? range.high - range.low : null;
    const critical = span !== null && range.low - value > span;
    return critical ? 'critical_low' : 'below_reference';
  }
  if (range.high !== null && value > range.high) {
    const span = range.high !== null && range.low !== null ? range.high - range.low : null;
    const critical = span !== null && value - range.high > span;
    return critical ? 'critical_high' : 'above_reference';
  }
  return 'normal';
}
