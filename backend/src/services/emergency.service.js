import * as repo from '../repositories/emergency.repository.js';
import { getRegion } from '../config/emergency-regions.js';
import {
  cleanList,
  cleanMultiline,
  cleanPhone,
  cleanText,
  isValidBloodGroup,
  isValidPhone,
} from '../utils/medical-validation.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Emergency assistance.
 *
 * Nothing in this module is allowed to delay the actual emergency call. The
 * API records what happened and prepares the messages; the call itself is a
 * plain tel: link in the interface and never waits on the network.
 */

export function emergencyNumbers() {
  const region = getRegion();
  return {
    region: region.code,
    regionName: region.name,
    emergency: region.emergency,
    ambulance: region.ambulance,
    fire: region.fire,
    police: region.police,
  };
}

/**
 * Build the shareable location message.
 *
 * The text is returned to the interface so the patient can send it over any
 * channel they choose (WhatsApp, SMS, a call). The app never contacts anyone
 * on the patient's behalf without a channel it can actually deliver to.
 */
export function buildLocationMessage({ name, location, note }) {
  const parts = [`🚨 জরুরি সহায়তা চাই — ${name || 'আমার ডাক্তার অ্যাপ থেকে'}`];
  if (location?.lat && location?.lng) {
    parts.push(`📍 আমার অবস্থান: https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`);
  } else {
    parts.push('📍 আমার অবস্থান এখনো পাওয়া যায়নি।');
  }
  if (note) parts.push(`📝 ${note}`);
  return parts.join('\n');
}

export function buildShareUrl({ location }) {
  if (!location?.lat || !location?.lng) return null;
  return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
}

export function normaliseProfileInput(input = {}) {
  const bloodGroup = input.bloodGroup ? cleanText(input.bloodGroup, 5).toUpperCase() : null;
  if (bloodGroup && !isValidBloodGroup(bloodGroup)) {
    throw new HttpError(400, 'রক্তের গ্রুপ সঠিক নয়।');
  }
  return {
    bloodGroup,
    allergies: cleanList(input.allergies).join('\n') || null,
    conditions: cleanList(input.conditions).join('\n') || null,
    emergencyNotes: input.emergencyNotes ? cleanMultiline(input.emergencyNotes, 1000) : null,
  };
}

export function normaliseContactInput(input = {}) {
  const name = cleanText(input.name, 120);
  if (!name) {
    throw new HttpError(400, 'যোগাযোগের নাম লিখুন।');
  }
  const phone = cleanPhone(input.phone);
  if (!isValidPhone(phone)) {
    throw new HttpError(400, 'সঠিক ফোন নম্বর দিন।');
  }
  return {
    name,
    relationship: input.relationship ? cleanText(input.relationship, 60) : null,
    phone,
    isPrimary: Boolean(input.isPrimary),
  };
}

/**
 * Record an emergency activation.
 *
 * The event is stored so the patient has a history, and each contacted
 * contact gets a notification row with an honest delivery state.
 */
export async function activateEmergency(userId, { location = null, locationSource = null, notes = null, eventType = 'sos' }) {
  const event = await repo.insertEvent(userId, {
    eventType,
    location: location && Number.isFinite(location.lat) && Number.isFinite(location.lng) ? location : null,
    locationSource: location ? locationSource : null,
    locationShared: Boolean(location),
    notes: notes ? cleanMultiline(notes, 500) : null,
  });
  return event;
}

/**
 * Notify the patient's emergency contacts.
 *
 * The app cannot deliver an SMS on its own without a configured provider, so
 * the delivery state reflects reality: 'unavailable' when no channel is
 * configured, 'pending' when the interface has to open the user's messaging
 * app. It is never reported as 'sent' unless it actually was.
 */
export async function notifyContacts(userId, eventId, { channelAvailable = false } = {}) {
  const event = await repo.findEventById(eventId, userId);
  if (!event) {
    throw new HttpError(404, 'জরুরি ইভেন্ট পাওয়া যায়নি।');
  }

  const contacts = await repo.listContacts(userId);
  if (!contacts.length) {
    return { event, notifications: [], note: 'কোনো জরুরি যোগাযোগ যোগ করা হয়নি।' };
  }

  const notifications = [];
  for (const contact of contacts) {
    const status = channelAvailable ? 'pending' : 'unavailable';
    const detail = channelAvailable
      ? 'বার্তাটি প্রস্তুত — আপনার মেসেজিং অ্যাপ থেকে পাঠাতে হবে।'
      : 'স্বয়ংক্রিয় বার্তা পাঠানোর সেবা কনফিগার করা নেই। নিচের লিংক ব্যবহার করুন।';

    const notification = await repo.insertEventNotification(event.id, contact.id, {
      channel: channelAvailable ? 'sms' : 'link',
      status,
      detail,
    });
    notifications.push({ ...notification, contactName: contact.name, phone: contact.phone });
  }

  await repo.updateEvent(event.id, userId, { status: 'notified' });

  return {
    event: { ...event, status: 'notified' },
    notifications,
    note: channelAvailable
      ? undefined
      : 'স্বয়ংক্রিয় বার্তা পাঠানোর সেবা কনফিগার করা নেই — ফোন বা মেসেজিং অ্যাপ থেকে নিজে পাঠান।',
  };
}

/** Mark an emergency event as resolved. */
export async function resolveEvent(userId, eventId, notes = null) {
  const event = await repo.findEventById(eventId, userId);
  if (!event) {
    throw new HttpError(404, 'জরুরি ইভেন্ট পাওয়া যায়নি।');
  }
  const updated = await repo.updateEvent(event.id, userId, {
    status: 'resolved',
    notes: notes ? cleanMultiline(notes, 500) : event.notes,
  });
  return updated;
}
