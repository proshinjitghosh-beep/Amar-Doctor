import { requireDatabase } from '../config/database.js';

function mapSummary(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    appointmentId: row.appointment_id === null ? null : Number(row.appointment_id),
    summary: row.summary_json,
    summaryText: row.summary_text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertVisitSummary(userId, { appointmentId, summary, summaryText, status = 'draft' }) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `INSERT INTO visit_summaries (user_id, appointment_id, summary_json, summary_text, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, appointmentId ?? null, JSON.stringify(summary), summaryText ?? null, status]
  );
  return mapSummary(rows[0]);
}

export async function findVisitSummary(summaryId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query('SELECT * FROM visit_summaries WHERE id = $1 AND user_id = $2', [
    summaryId,
    userId,
  ]);
  return mapSummary(rows[0]);
}

export async function updateVisitSummary(summaryId, userId, { summary, summaryText, status }) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE visit_summaries SET
        summary_json = COALESCE($3, summary_json),
        summary_text = COALESCE($4, summary_text),
        status = COALESCE($5, status),
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [
      summaryId,
      userId,
      summary ? JSON.stringify(summary) : null,
      summaryText ?? null,
      status ?? null,
    ]
  );
  return mapSummary(rows[0]);
}

export async function listVisitSummaries(userId, { limit = 20 } = {}) {
  const db = requireDatabase();
  const { rows } = await db.query(
    'SELECT * FROM visit_summaries WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, Math.min(100, Math.max(1, limit))]
  );
  return rows.map(mapSummary);
}

// ---------------------------------------------------------- appointments ----

function mapAppointment(row) {
  return {
    id: Number(row.id),
    doctorName: row.doctor_name,
    specialty: row.specialty,
    scheduledAt: row.scheduled_at,
    status: row.status,
    paymentStatus: row.payment_status,
  };
}

/** The patient's own appointments, joined with the doctor. */
export async function listPatientAppointments(userId, { limit = 20 } = {}) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT a.id, a.scheduled_at, a.status, a.payment_status,
            du.full_name AS doctor_name, dp.specialty
       FROM appointments a
       JOIN doctor_profiles dp ON dp.id = a.doctor_id
       JOIN users du ON du.id = dp.user_id
      WHERE a.patient_id = $1
      ORDER BY a.scheduled_at DESC
      LIMIT $2`,
    [userId, Math.min(100, Math.max(1, limit))]
  );
  return rows.map(mapAppointment);
}

export async function findAppointmentById(appointmentId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT a.id, a.scheduled_at, a.status, a.payment_status,
            du.full_name AS doctor_name, dp.specialty
       FROM appointments a
       JOIN doctor_profiles dp ON dp.id = a.doctor_id
       JOIN users du ON du.id = dp.user_id
      WHERE a.id = $1 AND a.patient_id = $2`,
    [appointmentId, userId]
  );
  return rows[0] ? mapAppointment(rows[0]) : null;
}

/**
 * Record a booking made in the browser so the visit-prep module has a real
 * appointment to work with. The existing prototype stores bookings in
 * localStorage; this mirrors them into the database when the patient is
 * signed in.
 */
export async function createAppointment(userId, { doctorName, scheduledAt, specialty = null, slotLabel = null }) {
  const db = requireDatabase();
  const doctor = await db.query(
    `SELECT dp.id, dp.specialty FROM doctor_profiles dp
       JOIN users u ON u.id = dp.user_id
      WHERE u.full_name = $1
      LIMIT 1`,
    [doctorName]
  );
  if (!doctor.rowCount) {
    return null;
  }

  const { rows } = await db.query(
    `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, status, payment_status)
     VALUES ($1, $2, $3, 'pending', 'unpaid')
     RETURNING id`,
    [userId, doctor.rows[0].id, scheduledAt]
  );

  return findAppointmentById(rows[0].id, userId);
}

// ------------------------------------------------------------ share links ---

export async function createShareLink(userId, visitSummaryId, { recipientName = null, expiresAt = null }) {
  const db = requireDatabase();
  const { randomBytes } = await import('node:crypto');
  const token = randomBytes(24).toString('base64url');
  const { rows } = await db.query(
    `INSERT INTO share_links (user_id, visit_summary_id, token, recipient_name, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, token, recipient_name, expires_at, created_at`,
    [userId, visitSummaryId, token, recipientName, expiresAt]
  );
  return {
    id: Number(rows[0].id),
    token: rows[0].token,
    recipientName: rows[0].recipient_name,
    expiresAt: rows[0].expires_at,
    createdAt: rows[0].created_at,
  };
}

export async function listShareLinks(userId, visitSummaryId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT id, token, recipient_name, revoked_at, expires_at, view_count, created_at
       FROM share_links
      WHERE user_id = $1 AND visit_summary_id = $2
      ORDER BY created_at DESC`,
    [userId, visitSummaryId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    token: row.token,
    recipientName: row.recipient_name,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
    viewCount: Number(row.view_count),
    createdAt: row.created_at,
  }));
}

export async function revokeShareLink(shareId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE share_links SET revoked_at = NOW()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [shareId, userId]
  );
  return rows.length > 0;
}

/**
 * Read a shared summary by token. This is the only unauthenticated read in
 * the application, and it returns nothing when the link is revoked or
 * expired.
 */
export async function findSharedSummary(token) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT sl.id AS link_id, sl.revoked_at, sl.expires_at, sl.recipient_name,
            vs.summary_json, vs.summary_text, vs.status, vs.created_at
       FROM share_links sl
       JOIN visit_summaries vs ON vs.id = sl.visit_summary_id
      WHERE sl.token = $1`,
    [token]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at) return { revoked: true };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return { expired: true };

  await db.query('UPDATE share_links SET view_count = view_count + 1 WHERE id = $1', [row.link_id]);

  return {
    id: Number(row.link_id),
    summary: row.summary_json,
    summaryText: row.summary_text,
    status: row.status,
    recipientName: row.recipient_name,
    createdAt: row.created_at,
  };
}
