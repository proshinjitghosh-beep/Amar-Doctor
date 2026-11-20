import { requireDatabase } from '../config/database.js';

function mapMedication(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    medicineName: row.medicine_name,
    dosage: row.dosage,
    instructions: row.instructions,
    startDate: row.start_date,
    endDate: row.end_date,
    quantityOnHand: row.quantity_on_hand === null ? null : Number(row.quantity_on_hand),
    status: row.status,
    verificationStatus: row.verification_status,
    schedules: row.schedules || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSchedule(row) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    medicationId: Number(row.medication_id),
    reminderTime: row.reminder_time,
    repeatDays: row.repeat_days,
    timezone: row.timezone,
    isActive: row.is_active === true,
  };
}

export async function insertMedication(userId, data) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `INSERT INTO medications
       (user_id, medicine_name, dosage, instructions, start_date, end_date,
        quantity_on_hand, status, verification_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      userId,
      data.medicineName,
      data.dosage ?? null,
      data.instructions ?? null,
      data.startDate ?? null,
      data.endDate ?? null,
      data.quantityOnHand ?? null,
      data.status || 'active',
      data.verificationStatus || 'patient_confirmed',
    ]
  );
  return mapMedication(rows[0]);
}

export async function listMedications(userId, { status = null } = {}) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT * FROM medications
      WHERE user_id = $1 AND ($2::text IS NULL OR status = $2)
      ORDER BY status = 'active' DESC, created_at DESC`,
    [userId, status]
  );
  const medications = rows.map(mapMedication);
  if (!medications.length) return medications;

  const { rows: scheduleRows } = await db.query(
    'SELECT * FROM medicine_schedules WHERE user_id = $1 AND is_active = TRUE ORDER BY reminder_time',
    [userId]
  );
  const byMedication = new Map();
  for (const row of scheduleRows) {
    const schedule = mapSchedule(row);
    if (!byMedication.has(schedule.medicationId)) byMedication.set(schedule.medicationId, []);
    byMedication.get(schedule.medicationId).push(schedule);
  }
  for (const medication of medications) {
    medication.schedules = byMedication.get(medication.id) || [];
  }
  return medications;
}

export async function findMedicationById(medicationId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query('SELECT * FROM medications WHERE id = $1 AND user_id = $2', [
    medicationId,
    userId,
  ]);
  if (!rows[0]) return null;
  const medication = mapMedication(rows[0]);
  const schedules = await listSchedulesForMedication(medication.id, userId);
  medication.schedules = schedules;
  return medication;
}

export async function updateMedication(medicationId, userId, data) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE medications SET
        medicine_name = COALESCE($3, medicine_name),
        dosage = COALESCE($4, dosage),
        instructions = COALESCE($5, instructions),
        start_date = COALESCE($6, start_date),
        end_date = COALESCE($7, end_date),
        quantity_on_hand = COALESCE($8, quantity_on_hand),
        status = COALESCE($9, status),
        verification_status = COALESCE($10, verification_status),
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [
      medicationId,
      userId,
      data.medicineName ?? null,
      data.dosage ?? null,
      data.instructions ?? null,
      data.startDate ?? null,
      data.endDate ?? null,
      data.quantityOnHand ?? null,
      data.status ?? null,
      data.verificationStatus ?? null,
    ]
  );
  return rows[0] ? mapMedication(rows[0]) : null;
}

/** Discontinue a medication. The row is kept because the dose history is clinical data. */
export async function discontinueMedication(medicationId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE medications SET status = 'discontinued', updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [medicationId, userId]
  );
  if (!rows[0]) return null;
  await db.query('UPDATE medicine_schedules SET is_active = FALSE WHERE medication_id = $1 AND user_id = $2', [
    medicationId,
    userId,
  ]);
  return mapMedication(rows[0]);
}

export async function listSchedulesForMedication(medicationId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    'SELECT * FROM medicine_schedules WHERE medication_id = $1 AND user_id = $2 ORDER BY reminder_time',
    [medicationId, userId]
  );
  return rows.map(mapSchedule);
}

export async function insertSchedule(userId, medicationId, data) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `INSERT INTO medicine_schedules (medication_id, user_id, reminder_time, repeat_days, timezone, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      medicationId,
      userId,
      data.reminderTime,
      data.repeatDays || '0,1,2,3,4,5,6',
      data.timezone || 'Asia/Dhaka',
      data.isActive === false ? false : true,
    ]
  );
  return mapSchedule(rows[0]);
}

export async function findScheduleById(scheduleId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query('SELECT * FROM medicine_schedules WHERE id = $1 AND user_id = $2', [
    scheduleId,
    userId,
  ]);
  return rows[0] ? mapSchedule(rows[0]) : null;
}

export async function updateSchedule(scheduleId, userId, data) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE medicine_schedules SET
        reminder_time = COALESCE($3, reminder_time),
        repeat_days = COALESCE($4, repeat_days),
        timezone = COALESCE($5, timezone),
        is_active = COALESCE($6, is_active),
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [
      scheduleId,
      userId,
      data.reminderTime ?? null,
      data.repeatDays ?? null,
      data.timezone ?? null,
      data.isActive === undefined ? null : data.isActive,
    ]
  );
  return rows[0] ? mapSchedule(rows[0]) : null;
}

export async function deleteSchedule(scheduleId, userId) {
  const db = requireDatabase();
  const { rowCount } = await db.query('DELETE FROM medicine_schedules WHERE id = $1 AND user_id = $2', [
    scheduleId,
    userId,
  ]);
  return rowCount > 0;
}

export async function listActiveSchedules(userId) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT s.* FROM medicine_schedules s
       JOIN medications m ON m.id = s.medication_id
      WHERE s.user_id = $1 AND s.is_active = TRUE AND m.status = 'active'`,
    [userId]
  );
  return rows.map(mapSchedule);
}

// ------------------------------------------------------------ dose logs ----

function mapDoseLog(row) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    medicationId: Number(row.medication_id),
    scheduleId: row.schedule_id === null ? null : Number(row.schedule_id),
    scheduledAt: row.scheduled_at,
    takenAt: row.taken_at,
    status: row.status,
    note: row.note,
  };
}

export async function listDoseLogs(userId, { from = null, to = null, medicationId = null } = {}) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT d.*, m.medicine_name
       FROM dose_logs d
       JOIN medications m ON m.id = d.medication_id
      WHERE d.user_id = $1
        AND ($2::timestamptz IS NULL OR d.scheduled_at >= $2)
        AND ($3::timestamptz IS NULL OR d.scheduled_at < $3)
        AND ($4::bigint IS NULL OR d.medication_id = $4)
      ORDER BY d.scheduled_at DESC
      LIMIT 1000`,
    [userId, from, to, medicationId]
  );
  return rows.map((row) => ({
    ...mapDoseLog(row),
    medicineName: row.medicine_name,
  }));
}

/**
 * Create the dose rows for a window. The unique index on
 * (medication_id, schedule_id, scheduled_at) makes duplicate rows impossible.
 */
export async function ensureDoseLogs(userId, rows) {
  const db = requireDatabase();
  const created = [];
  for (const row of rows) {
    const { rows: inserted } = await db.query(
      `INSERT INTO dose_logs (user_id, medication_id, schedule_id, scheduled_at, status)
       VALUES ($1, $2, $3, $4, 'scheduled')
       ON CONFLICT (medication_id, COALESCE(schedule_id, 0), scheduled_at) DO NOTHING
       RETURNING *`,
      [userId, row.medicationId, row.scheduleId, row.scheduledAt]
    );
    if (inserted[0]) created.push(mapDoseLog(inserted[0]));
  }
  return created;
}

export async function recordDoseStatus(doseId, userId, { status, takenAt = null, note = null, scheduledAt = null }) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `UPDATE dose_logs SET
        status = $3,
        taken_at = COALESCE($4, taken_at),
        note = COALESCE($5, note),
        scheduled_at = COALESCE($6, scheduled_at),
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [doseId, userId, status, takenAt, note, scheduledAt]
  );
  return rows[0] ? mapDoseLog(rows[0]) : null;
}

export async function findDoseById(doseId, userId) {
  const db = requireDatabase();
  const { rows } = await db.query('SELECT * FROM dose_logs WHERE id = $1 AND user_id = $2', [doseId, userId]);
  return rows[0] ? mapDoseLog(rows[0]) : null;
}

/** Adherence computed from the recorded dose history. */
export async function adherenceSummary(userId, { from, to }) {
  const db = requireDatabase();
  const { rows } = await db.query(
    `SELECT
        COUNT(*) FILTER (WHERE status <> 'scheduled') AS recorded,
        COUNT(*) FILTER (WHERE status = 'taken')      AS taken,
        COUNT(*) FILTER (WHERE status = 'skipped')    AS skipped,
        COUNT(*) FILTER (WHERE status = 'snoozed')    AS snoozed,
        COUNT(*) FILTER (WHERE status = 'missed')     AS missed
       FROM dose_logs
      WHERE user_id = $1 AND scheduled_at >= $2 AND scheduled_at < $3`,
    [userId, from, to]
  );
  const row = rows[0] || {};
  const recorded = Number(row.recorded || 0);
  const taken = Number(row.taken || 0);
  return {
    from,
    to,
    scheduled: recorded,
    taken,
    skipped: Number(row.skipped || 0),
    snoozed: Number(row.snoozed || 0),
    missed: Number(row.missed || 0),
    // Adherence is taken over the doses the patient actually recorded an
    // action for. A dose that was never recorded is not counted as taken.
    adherencePercent: recorded ? Math.round((taken / recorded) * 100) : null,
  };
}
