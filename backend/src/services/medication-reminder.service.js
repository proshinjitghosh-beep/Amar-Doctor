import * as repo from '../repositories/medications.repository.js';
import { HttpError } from '../utils/http-error.js';
import {
  occurrencesBetween,
  parseReminderTime,
  formatRepeatDays,
  parseRepeatDays,
} from '../utils/date-time.js';
import { cleanMultiline, cleanText, MEDICATION_STATUSES } from '../utils/medical-validation.js';

const DEFAULT_TIMEZONE = 'Asia/Dhaka';

/** How far ahead dose rows are materialised so the timeline can be shown. */
const HORIZON_DAYS = 14;

/**
 * Expand a schedule into concrete occurrences for the horizon window.
 * Times are computed in the schedule's own timezone.
 */
export async function materialiseDoses(userId, { medicationId = null } = {}) {
  const schedules = await repo.listActiveSchedules(userId);
  const rows = [];

  const now = new Date();
  const from = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  for (const schedule of schedules) {
    if (medicationId && schedule.medicationId !== Number(medicationId)) continue;
    const occurrences = occurrencesBetween({
      startAt: from,
      endAt: to,
      days: schedule.repeatDays,
      time: schedule.reminderTime,
      timeZone: schedule.timezone || DEFAULT_TIMEZONE,
    });
    for (const occurrence of occurrences) {
      rows.push({
        medicationId: schedule.medicationId,
        scheduleId: schedule.id,
        scheduledAt: occurrence,
      });
    }
  }

  if (!rows.length) return [];
  await repo.ensureDoseLogs(userId, rows);
  return repo.listDoseLogs(userId, { from, to });
}

/**
 * Adherence for a window. The window defaults to the last 7 days.
 */
export async function getAdherence(userId, { days = 7 } = {}) {
  const span = Math.min(90, Math.max(1, Number(days) || 7));
  const to = new Date();
  const from = new Date(to.getTime() - span * 24 * 60 * 60 * 1000);
  return repo.adherenceSummary(userId, { from, to });
}

/**
 * Estimate how many days of supply are left.
 *
 * This is explicitly an estimate: it divides the quantity the patient says
 * they have by the number of doses the schedule implies per day.
 */
export async function getRefillStatus(userId) {
  const medications = await repo.listMedications(userId, { status: 'active' });
  const items = [];

  for (const medication of medications) {
    if (medication.quantityOnHand === null || medication.quantityOnHand <= 0) continue;

    const dosesPerDay = medication.schedules.reduce((total, schedule) => {
      const days = parseRepeatDays(schedule.repeatDays).length;
      return total + days / 7;
    }, 0);

    if (!dosesPerDay) continue;

    const daysOfSupply = medication.quantityOnHand / dosesPerDay;
    items.push({
      medicationId: medication.id,
      medicineName: medication.medicineName,
      quantityOnHand: medication.quantityOnHand,
      dosesPerDay: Math.round(dosesPerDay * 100) / 100,
      estimatedDaysRemaining: Math.floor(daysOfSupply),
      needsRefill: daysOfSupply <= 7,
    });
  }

  return {
    estimate: true,
    note: 'সাপ্লাই প্রত্যাশা একটি আনুমানিক হিসাব — ডোজ ও প্রকৃত ব্যবহারের ওপর নির্ভর করে।',
    items: items.sort((a, b) => a.estimatedDaysRemaining - b.estimatedDaysRemaining),
  };
}

/** Validate and normalise the medicine form of a medication. */
export function normaliseMedicationInput(input = {}) {
  const medicineName = cleanText(input.medicineName, 160);
  if (!medicineName) {
    throw new HttpError(400, 'ওষুধের নাম লিখুন।');
  }
  const status = MEDICATION_STATUSES.includes(input.status) ? input.status : 'active';
  return {
    medicineName,
    dosage: input.dosage ? cleanText(input.dosage, 120) : null,
    instructions: input.instructions ? cleanMultiline(input.instructions, 500) : null,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    quantityOnHand:
      input.quantityOnHand === undefined || input.quantityOnHand === null || input.quantityOnHand === ''
        ? null
        : Number(input.quantityOnHand),
    status,
    verificationStatus: ['extracted', 'needs_review', 'patient_confirmed', 'clinician_confirmed'].includes(
      input.verificationStatus
    )
      ? input.verificationStatus
      : 'patient_confirmed',
  };
}

/** Validate and normalise a schedule. */
export function normaliseScheduleInput(input = {}) {
  const time = parseReminderTime(input.reminderTime);
  if (!time) {
    throw new HttpError(400, 'সময়টি ঠিক ভাবে দিন (যেমন 08:30)।');
  }
  return {
    reminderTime: `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
    repeatDays: formatRepeatDays(input.repeatDays ?? '0,1,2,3,4,5,6'),
    timezone: cleanText(input.timezone || DEFAULT_TIMEZONE, 64),
    isActive: input.isActive === false ? false : true,
  };
}
