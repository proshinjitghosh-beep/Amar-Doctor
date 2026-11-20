import { z } from 'zod';
import * as repo from '../repositories/medications.repository.js';
import {
  getAdherence,
  getRefillStatus,
  materialiseDoses,
  normaliseMedicationInput,
  normaliseScheduleInput,
} from '../services/medication-reminder.service.js';
import { extractDocument } from '../services/ocr.service.js';
import { parsePrescriptionMedicines } from '../services/report-parser.service.js';
import { validateUpload } from '../middleware/upload-validation.js';
import { assertOwner } from '../middleware/ownership-check.js';
import { recordAudit } from '../services/audit.service.js';
import { HttpError } from '../utils/http-error.js';

const medicationSchema = z.object({
  medicineName: z.string().trim().min(1).max(160),
  dosage: z.string().trim().max(120).optional(),
  instructions: z.string().trim().max(500).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')).optional(),
  quantityOnHand: z.number().nonnegative().optional().nullable(),
  status: z.enum(['active', 'paused', 'discontinued']).optional(),
});

const scheduleSchema = z.object({
  medicationId: z.coerce.number().int().positive(),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  repeatDays: z.union([z.string(), z.array(z.number().int().min(0).max(6))]).optional(),
  timezone: z.string().trim().max(64).optional(),
});

export async function listMedications(req, res, next) {
  try {
    const medications = await repo.listMedications(req.user.id);
    await materialiseDoses(req.user.id);
    return res.json({ medications });
  } catch (error) {
    return next(error);
  }
}

export async function createMedication(req, res, next) {
  try {
    const userId = req.user.id;
    const parsed = medicationSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'ওষুধের তথ্য সঠিক নয়। ওষুধের নাম লিখুন।');
    }

    const input = normaliseMedicationInput(parsed.data);
    const medication = await repo.insertMedication(userId, input);

    await recordAudit({ userId, action: 'medication.create', resourceType: 'medication', resourceId: medication.id });
    return res.status(201).json({ medication });
  } catch (error) {
    return next(error);
  }
}

export async function getMedication(req, res, next) {
  try {
    const medication = await repo.findMedicationById(req.params.id, req.user.id);
    assertOwner(medication, req.user.id, 'ওষুধ');
    return res.json({ medication });
  } catch (error) {
    return next(error);
  }
}

export async function updateMedication(req, res, next) {
  try {
    const userId = req.user.id;
    const parsed = medicationSchema.partial().safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'ওষুধের তথ্য সঠিক নয়।');
    }
    const existing = await repo.findMedicationById(req.params.id, userId);
    assertOwner(existing, userId, 'ওষুধ');

    const input = normaliseMedicationInput({ ...existing, ...parsed.data });
    const medication = await repo.updateMedication(existing.id, userId, input);
    await recordAudit({ userId, action: 'medication.update', resourceType: 'medication', resourceId: medication.id });
    return res.json({ medication });
  } catch (error) {
    return next(error);
  }
}

/** Discontinue (not delete) so the dose history is preserved. */
export async function discontinueMedication(req, res, next) {
  try {
    const userId = req.user.id;
    const existing = await repo.findMedicationById(req.params.id, userId);
    assertOwner(existing, userId, 'ওষুধ');
    const medication = await repo.discontinueMedication(existing.id, userId);
    await recordAudit({ userId, action: 'medication.discontinue', resourceType: 'medication', resourceId: medication.id });
    return res.json({ medication });
  } catch (error) {
    return next(error);
  }
}

// ------------------------------------------------------------- schedules ----

export async function listReminders(req, res, next) {
  try {
    const doses = await materialiseDoses(req.user.id);
    return res.json({ reminders: doses });
  } catch (error) {
    return next(error);
  }
}

export async function createReminder(req, res, next) {
  try {
    const userId = req.user.id;
    const parsed = scheduleSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'রিমাইন্ডারের তথ্য সঠিক নয়। সময় দিন, যেমন 08:30।');
    }
    const medication = await repo.findMedicationById(parsed.data.medicationId, userId);
    assertOwner(medication, userId, 'ওষুধ');

    const input = normaliseScheduleInput(parsed.data);
    const schedule = await repo.insertSchedule(userId, medication.id, input);
    await materialiseDoses(userId);
    await recordAudit({ userId, action: 'reminder.create', resourceType: 'medicine_schedule', resourceId: schedule.id });
    return res.status(201).json({ schedule });
  } catch (error) {
    return next(error);
  }
}

export async function updateReminder(req, res, next) {
  try {
    const userId = req.user.id;
    const existing = await repo.findScheduleById(req.params.id, userId);
    assertOwner(existing, userId, 'রিমাইন্ডার');
    const parsed = scheduleSchema.partial().safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'রিমাইন্ডারের তথ্য সঠিক নয়।');
    }
    const schedule = await repo.updateSchedule(existing.id, userId, normaliseScheduleInput(parsed.data));
    return res.json({ schedule });
  } catch (error) {
    return next(error);
  }
}

export async function deleteReminder(req, res, next) {
  try {
    const userId = req.user.id;
    const existing = await repo.findScheduleById(req.params.id, userId);
    assertOwner(existing, userId, 'রিমাইন্ডার');
    await repo.deleteSchedule(existing.id, userId);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

// ------------------------------------------------------------ dose record ----

async function recordDose(req, res, next, status, { takenAt = null, note = null } = {}) {
  try {
    const userId = req.user.id;
    const dose = await repo.findDoseById(req.params.id, userId);
    assertOwner(dose, userId, 'ডোজ');

    const updated = await repo.recordDoseStatus(dose.id, userId, { status, takenAt, note });
    await recordAudit({ userId, action: `dose.${status}`, resourceType: 'dose_log', resourceId: dose.id });
    return res.json({ reminder: updated });
  } catch (error) {
    return next(error);
  }
}

export async function markDoseTaken(req, res, next) {
  // The time the dose was actually taken is recorded by the server.
  return recordDose(req, res, next, 'taken', { takenAt: new Date() });
}

export async function markDoseSkipped(req, res, next) {
  return recordDose(req, res, next, 'skipped', { takenAt: new Date() });
}

/**
 * Snooze a dose. The original slot is kept and the dose moves to a new time.
 * A snoozed dose is never marked as taken.
 */
export async function snoozeDose(req, res, next) {
  try {
    const userId = req.user.id;
    const dose = await repo.findDoseById(req.params.id, userId);
    assertOwner(dose, userId, 'ডোজ');

    const minutes = Math.min(24 * 60, Math.max(5, Number(req.body?.minutes) || 15));
    const newTime = new Date(new Date(dose.scheduledAt).getTime() + minutes * 60 * 1000);

    const updated = await repo.recordDoseStatus(dose.id, userId, {
      status: 'snoozed',
      note: `${minutes} মিনিট পরে স্নুজ করা হয়েছে।`,
      scheduledAt: newTime,
    });

    await recordAudit({ userId, action: 'dose.snooze', resourceType: 'dose_log', resourceId: dose.id });
    return res.json({ reminder: updated, snoozedMinutes: minutes });
  } catch (error) {
    return next(error);
  }
}

// ------------------------------------------------------------- analytics ----

export async function getAdherenceEndpoint(req, res, next) {
  try {
    const adherence = await getAdherence(req.user.id, { days: req.query?.days });
    return res.json({ adherence });
  } catch (error) {
    return next(error);
  }
}

export async function getRefillStatusEndpoint(req, res, next) {
  try {
    const refill = await getRefillStatus(req.user.id);
    return res.json({ refill });
  } catch (error) {
    return next(error);
  }
}

// ---------------------------------------------------- prescription import ---

/**
 * Extract medicine candidates from a prescription image or PDF.
 *
 * Nothing is saved: the patient reviews the candidates and confirms them.
 * The parser never invents a dosage, and every candidate is marked as needing
 * confirmation.
 */
export async function extractPrescription(req, res, next) {
  try {
    const { detectedType } = validateUpload(req.file);

    let extraction;
    try {
      extraction = await extractDocument({ buffer: req.file.buffer, mimeType: detectedType });
    } catch (error) {
      throw new HttpError(
        503,
        'প্রেসক্রিপশন পড়া যায়নি। AI সেবা এখন উপলব্ধ নেই, অথবা ছবির মান খুব খারাপ।'
      );
    }

    const medicines = parsePrescriptionMedicines(extraction.text || '');
    const candidates = medicines.length
      ? medicines
      : (extraction.medicines || []).map((item) => ({
          medicineName: item.medicineName,
          dosage: item.dosage,
          instructions: item.instructions,
          frequency: item.frequency,
          requiresReview: true,
        }));

    return res.json({
      candidates,
      extractionMethod: extraction.method,
      confidence: extraction.confidence,
      note: 'এগুলো প্রস্তাবিত ওষুধ। যাচাই না করে কোনো সিডিউল তৈরি হবে না — প্রথমে নিজে দেখে নিন।',
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Import a prescription that a clinician wrote (from the doctor panel).
 * Stored as clinician_confirmed, but only when the patient already has an
 * account. Nothing becomes an active schedule automatically.
 */
export async function importPrescription(req, res, next) {
  try {
    const userId = req.user.id;
    const parsed = z
      .object({
        medicineName: z.string().trim().min(1).max(160),
        dosage: z.string().trim().max(120).optional(),
        instructions: z.string().trim().max(500).optional(),
        doctorName: z.string().trim().max(160).optional(),
      })
      .safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'ওষুধের তথ্য সঠিক নয়।');
    }

    const medication = await repo.insertMedication(userId, {
      medicineName: parsed.data.medicineName,
      dosage: parsed.data.dosage ?? null,
      instructions: parsed.data.instructions ?? null,
      status: 'active',
      verificationStatus: 'clinician_confirmed',
    });

    await recordAudit({ userId, action: 'medication.import_prescription', resourceType: 'medication', resourceId: medication.id });
    return res.status(201).json({ medication });
  } catch (error) {
    return next(error);
  }
}
