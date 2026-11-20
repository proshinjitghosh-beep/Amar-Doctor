import { z } from 'zod';
import * as repo from '../repositories/emergency.repository.js';
import {
  activateEmergency,
  buildLocationMessage,
  buildShareUrl,
  emergencyNumbers,
  normaliseContactInput,
  normaliseProfileInput,
  notifyContacts,
  resolveEvent,
} from '../services/emergency.service.js';
import { findNearbyHospitals, mapSearchUrl } from '../services/hospitals.service.js';
import { assertOwner } from '../middleware/ownership-check.js';
import { recordAudit } from '../services/audit.service.js';
import { HttpError } from '../utils/http-error.js';

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function getProfile(req, res, next) {
  try {
    const profile = await repo.getEmergencyProfile(req.user.id);
    return res.json({ profile, numbers: emergencyNumbers() });
  } catch (error) {
    return next(error);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const userId = req.user.id;
    const input = normaliseProfileInput(req.body || {});
    const profile = await repo.upsertEmergencyProfile(userId, input);
    await recordAudit({ userId, action: 'emergency.profile_update', resourceType: 'emergency_profile', resourceId: profile.id });
    return res.json({ profile });
  } catch (error) {
    return next(error);
  }
}

export async function listContacts(req, res, next) {
  try {
    const contacts = await repo.listContacts(req.user.id);
    return res.json({ contacts });
  } catch (error) {
    return next(error);
  }
}

export async function createContact(req, res, next) {
  try {
    const userId = req.user.id;
    const input = normaliseContactInput(req.body || {});
    if (input.isPrimary) {
      await repo.clearPrimaryContacts(userId);
    }
    const contact = await repo.insertContact(userId, input);
    await recordAudit({ userId, action: 'emergency.contact_create', resourceType: 'emergency_contact', resourceId: contact.id });
    return res.status(201).json({ contact });
  } catch (error) {
    return next(error);
  }
}

export async function updateContact(req, res, next) {
  try {
    const userId = req.user.id;
    const existing = await repo.findContactById(req.params.id, userId);
    assertOwner(existing, userId, 'যোগাযোগ');
    const input = normaliseContactInput({ ...existing, ...(req.body || {}) });
    if (input.isPrimary) {
      await repo.clearPrimaryContacts(userId);
    }
    const contact = await repo.updateContact(existing.id, userId, input);
    return res.json({ contact });
  } catch (error) {
    return next(error);
  }
}

export async function deleteContact(req, res, next) {
  try {
    const userId = req.user.id;
    const existing = await repo.findContactById(req.params.id, userId);
    assertOwner(existing, userId, 'যোগাযোগ');
    await repo.deleteContact(existing.id, userId);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

/**
 * Record an SOS activation.
 *
 * The response already contains the numbers, the contacts and the share
 * message, so the interface can render the call action without waiting for
 * anything else.
 */
export async function activate(req, res, next) {
  try {
    const userId = req.user.id;
    const body = req.body || {};

    let location = null;
    if (body.location) {
      const parsed = locationSchema.safeParse(body.location);
      if (parsed.success) location = parsed.data;
    }

    const event = await activateEmergency(userId, {
      location,
      locationSource: location ? body.locationSource || 'device' : null,
      notes: body.notes || null,
      eventType: body.eventType || 'sos',
    });

    const contacts = await repo.listContacts(userId);
    const profile = await repo.getEmergencyProfile(userId);

    await recordAudit({ userId, action: 'emergency.activate', resourceType: 'emergency_event', resourceId: event.id });

    return res.status(201).json({
      event,
      numbers: emergencyNumbers(),
      contacts,
      profile,
      shareUrl: buildShareUrl({ location }),
      message: buildLocationMessage({ name: req.user.fullName, location, note: body.notes }),
      disclaimer: 'এই অ্যাপ অ্যাম্বুলেন্স পাঠায়নি — এটি শুধু আপনাকে দ্রুত কল ও অন্যদের জানাতে সাহায্য করে।',
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Notify the patient's contacts about an event.
 *
 * The delivery state is recorded honestly. Without a configured messaging
 * provider the contacts are returned with 'unavailable' and the interface
 * offers a WhatsApp link instead.
 */
export async function notify(req, res, next) {
  try {
    const userId = req.user.id;
    const event = await repo.findEventById(req.params.id, userId);
    assertOwner(event, userId, 'জরুরি ইভেন্ট');

    // `channelAvailable` says the interface has prepared a message for the
    // patient's messaging app. It never means a message was delivered - see
    // `notifyContacts`.
    const result = await notifyContacts(userId, event.id, {
      channelAvailable: Boolean(req.body?.channelAvailable),
    });

    await recordAudit({ userId, action: 'emergency.notify', resourceType: 'emergency_event', resourceId: event.id });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
}

export async function resolve(req, res, next) {
  try {
    const userId = req.user.id;
    const event = await repo.findEventById(req.params.id, userId);
    assertOwner(event, userId, 'জরুরি ইভেন্ট');
    const updated = await resolveEvent(userId, event.id, req.body?.notes || null);
    await recordAudit({ userId, action: 'emergency.resolve', resourceType: 'emergency_event', resourceId: event.id });
    return res.json({ event: updated });
  } catch (error) {
    return next(error);
  }
}

export async function history(req, res, next) {
  try {
    const events = await repo.listEvents(req.user.id, { limit: req.query?.limit });
    return res.json({ events });
  } catch (error) {
    return next(error);
  }
}

/**
 * Nearby hospitals from OpenStreetMap.
 * On failure the response includes a map search link as the fallback.
 */
export async function hospitals(req, res, next) {
  try {
    const lat = req.query?.lat;
    const lng = req.query?.lng;

    if (lat === undefined || lng === undefined) {
      return res.json({
        hospitals: [],
        fallbackUrl: mapSearchUrl('nearest hospital emergency'),
        note: 'অবস্থান জানা নেই। মানচিত্রে খুঁজে নিন।',
      });
    }

    try {
      const result = await findNearbyHospitals({ lat, lng, radius: req.query?.radius });
      return res.json({ ...result, fallbackUrl: mapSearchUrl('nearest hospital emergency') });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.json({
          hospitals: [],
          fallbackUrl: mapSearchUrl('nearest hospital emergency'),
          note: error.message,
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
}
