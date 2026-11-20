import { z } from 'zod';
import * as repo from '../repositories/doctor-prep.repository.js';
import { requireAuth } from '../middleware/authentication.js';
import { recordAudit } from '../services/audit.service.js';
import { HttpError } from '../utils/http-error.js';

const createSchema = z.object({
  doctorName: z.string().trim().min(1).max(160),
  scheduledAt: z.string().min(4).max(40),
  slotLabel: z.string().trim().max(80).optional(),
});

/**
 * Record a booking that was made in the browser.
 *
 * The prototype stores appointments in localStorage. This mirrors them into
 * the database so the visit-prep module has real appointments to work with.
 * The existing booking flow is unchanged - this is an addition, not a
 * replacement.
 */
export async function createAppointment(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'অ্যাপয়েন্টমেন্টের তথ্য সঠিক নয়।');
    }

    const appointment = await repo.createAppointment(req.user.id, {
      doctorName: parsed.data.doctorName,
      scheduledAt: parsed.data.scheduledAt,
      slotLabel: parsed.data.slotLabel,
    });

    if (!appointment) {
      // The app never creates a doctor from free text - that would fabricate
      // a clinician identity, and a specialty nobody entered.
      throw new HttpError(404, 'ডাক্তারটির প্রোফাইল পাওয়া যায়নি — ডাক্তারের তালিকা থেকে বুকিং করুন।');
    }

    await recordAudit({ userId: req.user.id, action: 'appointment.create', resourceType: 'appointment', resourceId: appointment.id });

    return res.status(201).json({ appointment });
  } catch (error) {
    return next(error);
  }
}

export async function listAppointments(req, res, next) {
  try {
    const appointments = await repo.listPatientAppointments(req.user.id);
    return res.json({ appointments });
  } catch (error) {
    return next(error);
  }
}

export { requireAuth };
