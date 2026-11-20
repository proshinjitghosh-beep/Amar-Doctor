import { requireDatabase } from '../config/database.js';

function mapProfile(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    bloodGroup: row.blood_group,
    allergies: row.allergies ? row.allergies.split('\n').filter(Boolean) : [],
    conditions: row.conditions ? row.conditions.split('\n').filter(Boolean) : [],
    emergencyNotes: row.emergency_notes,
    updatedAt: row.updated_at,
  };
}

function mapContact(row) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: row.name,
    relationship: row.relationship,
    phone: row.phone,
    isPrimary: row.is_primary === true,
  };
}

function mapEvent(row) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    eventType: row.event_type,
    location: row.location_lat === null ? null : { lat: Number(row.location_lat), lng: Number(row.location_lng) },
    locationSource: row.location_source,
    locationShared: row.location_shared === true,
    notes: row.notes,
    status: row.status,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    notifications: row.notifications || [],
  };
}

export async function getEmergencyProfile(userId) {
  const db = requireDatabase();
  const { rows } = await db.query('SELECT * FROM emergency_profiles WHERE user_id = $1', [userId]);
  return mapProfile(rows[0]);
}

export async function upsertEmergencyProfile(userId, data) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `INSERT INTO emergency_profiles (user_id, blood_group, allergies, conditions, emergency_notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
        blood_group = EXCLUDED.blood_group,
        allergies = EXCLUDED.allergies,
        conditions = EXCLUDED.conditions,
        emergency_notes = EXCLUDED.emergency_notes,
        updated_at = NOW()
     RETURNING *`,
    [userId, data.bloodGroup ?? null, data.allergies ?? null, data.conditions ?? null, data.emergencyNotes ?? null]
  );
  return mapProfile(rows[0]);
}

export async function listContacts(userId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    'SELECT * FROM emergency_contacts WHERE user_id = $1 ORDER BY is_primary DESC, id',
    [userId]
  );
  return rows.map(mapContact);
}

export async function insertContact(userId, data) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `INSERT INTO emergency_contacts (user_id, name, relationship, phone, is_primary)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, data.name, data.relationship ?? null, data.phone, Boolean(data.isPrimary)]
  );
  return mapContact(rows[0]);
}

export async function findContactById(contactId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query('SELECT * FROM emergency_contacts WHERE id = $1 AND user_id = $2', [
    contactId,
    userId,
  ]);
  return rows[0] ? mapContact(rows[0]) : null;
}

export async function updateContact(contactId, userId, data) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE emergency_contacts SET
        name = COALESCE($3, name),
        relationship = COALESCE($4, relationship),
        phone = COALESCE($5, phone),
        is_primary = COALESCE($6, is_primary)
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [contactId, userId, data.name ?? null, data.relationship ?? null, data.phone ?? null,
     data.isPrimary === undefined ? null : Boolean(data.isPrimary)]
  );
  return rows[0] ? mapContact(rows[0]) : null;
}

export async function deleteContact(contactId, userId) {
  const db = requireDatabase();
  const { rowCount } = await db.query('DELETE FROM emergency_contacts WHERE id = $1 AND user_id = $2', [
    contactId,
    userId,
  ]);
  return rowCount > 0;
}

/** Only one contact may be the primary one. */
export async function clearPrimaryContacts(userId) {
  const db = requireDatabase();
  await db.query('UPDATE emergency_contacts SET is_primary = FALSE WHERE user_id = $1 AND is_primary = TRUE', [userId]);
}

export async function insertEvent(userId, data) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `INSERT INTO emergency_events
       (user_id, event_type, location_lat, location_lng, location_source, location_shared, notes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
     RETURNING *`,
    [
      userId,
      data.eventType || 'sos',
      data.location?.lat ?? null,
      data.location?.lng ?? null,
      data.locationSource ?? null,
      Boolean(data.locationShared),
      data.notes ?? null,
    ]
  );
  return mapEvent(rows[0]);
}

export async function findEventById(eventId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query('SELECT * FROM emergency_events WHERE id = $1 AND user_id = $2', [
    eventId,
    userId,
  ]);
  if (!rows[0]) return null;
  const event = mapEvent(rows[0]);
  event.notifications = await listEventNotifications(event.id);
  return event;
}

export async function listEvents(userId, { limit = 50 } = {}) {
  const db = requireDatabase();
  const { rows } = await db.query(
    'SELECT * FROM emergency_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, Math.min(200, Math.max(1, limit))]
  );
  const events = rows.map(mapEvent);
  for (const event of events) {
    event.notifications = await listEventNotifications(event.id);
  }
  return events;
}

export async function updateEvent(eventId, userId, data) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE emergency_events SET
        status = COALESCE($3::varchar, status),
        notes = COALESCE($4, notes),
        resolved_at = CASE WHEN $3::varchar = 'resolved' THEN NOW() ELSE resolved_at END
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [eventId, userId, data.status ?? null, data.notes ?? null]
  );
  return rows[0] ? mapEvent(rows[0]) : null;
}

export async function insertEventNotification(eventId, contactId, { channel = 'link', status = 'pending', detail = null } = {}) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `INSERT INTO emergency_event_notifications (event_id, contact_id, channel, status, detail, sent_at)
     VALUES ($1, $2, $3, $4::varchar, $5, CASE WHEN $4::varchar = 'sent' THEN NOW() ELSE NULL END)
     RETURNING *`,
    [eventId, contactId, channel, status, detail]
  );
  return {
    id: Number(rows[0].id),
    contactId: Number(rows[0].contact_id),
    channel: rows[0].channel,
    status: rows[0].status,
    detail: rows[0].detail,
    sentAt: rows[0].sent_at,
  };
}

export async function listEventNotifications(eventId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT n.*, c.name AS contact_name FROM emergency_event_notifications n
       JOIN emergency_contacts c ON c.id = n.contact_id
      WHERE n.event_id = $1
      ORDER BY n.id`,
    [eventId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    contactId: Number(row.contact_id),
    contactName: row.contact_name,
    channel: row.channel,
    status: row.status,
    detail: row.detail,
    sentAt: row.sent_at,
  }));
}

export async function updateEventNotification(notificationId, { status, detail }) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE emergency_event_notifications
        SET status = $2,
            detail = COALESCE($3, detail),
            sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
      WHERE id = $1
      RETURNING *`,
    [notificationId, status, detail ?? null]
  );
  return rows[0] ? { id: Number(rows[0].id), status: rows[0].status, detail: rows[0].detail } : null;
}
