import { pool, requireDatabase } from '../config/database.js';
import {
  cleanList,
  cleanMultiline,
  cleanText,
  isValidBloodGroup,
} from '../utils/medical-validation.js';
import { HttpError } from '../utils/http-error.js';

/**
 * The shared health profile.
 *
 * Every field here is entered by the patient. The AI may read and summarise
 * these values, but it never fills one in - there is no path where an inferred
 * blood group or allergy becomes a stored fact.
 */
function mapProfile(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    sex: row.sex,
    bloodGroup: row.blood_group,
    heightCm: row.height_cm === null ? null : Number(row.height_cm),
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    allergies: row.allergies ? row.allergies.split('\n').filter(Boolean) : [],
    medicalConditions: row.medical_conditions ? row.medical_conditions.split('\n').filter(Boolean) : [],
    emergencyNotes: row.emergency_notes,
    offlineEmergencyMirror: row.offline_emergency_mirror === true,
    updatedAt: row.updated_at,
  };
}

export async function getHealthProfile(userId) {
  const db = requireDatabase();
  const { rows } = await db.query('SELECT * FROM health_profiles WHERE user_id = $1', [userId]);
  return mapProfile(rows[0]);
}

/** Read the profile, creating an empty one on first use. */
export async function getOrCreateHealthProfile(userId, fullName = null) {
  const db = requireDatabase();
  const { rows } = await db.query('SELECT * FROM health_profiles WHERE user_id = $1', [userId]);
  if (rows[0]) return mapProfile(rows[0]);
  const inserted = await db.query(
    `INSERT INTO health_profiles (user_id, full_name) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET full_name = COALESCE(health_profiles.full_name, EXCLUDED.full_name)
     RETURNING *`,
    [userId, fullName ? cleanText(fullName, 160) : null]
  );
  return mapProfile(inserted.rows[0]);
}

export async function updateHealthProfile(userId, input = {}) {
  const db = requireDatabase();
  await getOrCreateHealthProfile(userId);

  const bloodGroup = input.bloodGroup === undefined ? undefined : cleanText(input.bloodGroup, 5).toUpperCase();
  if (bloodGroup !== undefined && bloodGroup && !isValidBloodGroup(bloodGroup)) {
    throw new HttpError(400, 'রক্তের গ্রুপ সঠিক নয়।');
  }

  const allergies = input.allergies === undefined ? undefined : cleanList(input.allergies).join('\n');
  const conditions = input.medicalConditions === undefined ? undefined : cleanList(input.medicalConditions).join('\n');

  const { rows } = await db.query(
    `UPDATE health_profiles SET
        full_name = COALESCE($2, full_name),
        date_of_birth = COALESCE($3, date_of_birth),
        sex = COALESCE($4, sex),
        blood_group = COALESCE($5, blood_group),
        height_cm = COALESCE($6, height_cm),
        weight_kg = COALESCE($7, weight_kg),
        allergies = COALESCE($8, allergies),
        medical_conditions = COALESCE($9, medical_conditions),
        emergency_notes = COALESCE($10, emergency_notes),
        offline_emergency_mirror = COALESCE($11, offline_emergency_mirror),
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING *`,
    [
      userId,
      input.fullName === undefined ? null : cleanText(input.fullName, 160),
      input.dateOfBirth === undefined ? null : input.dateOfBirth,
      input.sex === undefined ? null : cleanText(input.sex, 20),
      bloodGroup === undefined ? null : bloodGroup,
      input.heightCm === undefined ? null : input.heightCm,
      input.weightKg === undefined ? null : input.weightKg,
      allergies === undefined ? null : allergies,
      conditions === undefined ? null : conditions,
      input.emergencyNotes === undefined ? null : cleanMultiline(input.emergencyNotes),
      input.offlineEmergencyMirror === undefined ? null : Boolean(input.offlineEmergencyMirror),
    ]
  );

  return mapProfile(rows[0]);
}

// ------------------------------------------------------------- symptoms ----

function mapSymptom(row) {
  return {
    id: Number(row.id),
    symptomName: row.symptom_name,
    description: row.description,
    severity: row.severity,
    startedAt: row.started_at,
    frequency: row.frequency,
    recordedAt: row.recorded_at,
  };
}

export async function listSymptoms(userId, limit = 50) {
  const db = requireDatabase();
  const { rows } = await db.query(
    'SELECT * FROM symptoms WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT $2',
    [userId, Math.min(200, Math.max(1, limit))]
  );
  return rows.map(mapSymptom);
}

export async function createSymptom(userId, input = {}) {
  const db = requireDatabase();
  const name = cleanText(input.symptomName, 160);
  if (!name) {
    throw new HttpError(400, 'লক্ষণের নাম লিখুন।');
  }
  const severity = ['mild', 'moderate', 'severe'].includes(input.severity) ? input.severity : 'mild';
  const { rows } = await db.query(
    `INSERT INTO symptoms (user_id, symptom_name, description, severity, started_at, frequency)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      userId,
      name,
      cleanMultiline(input.description, 1000),
      severity,
      input.startedAt || null,
      input.frequency ? cleanText(input.frequency, 40) : null,
    ]
  );
  return mapSymptom(rows[0]);
}

export async function deleteSymptom(userId, symptomId) {
  const db = requireDatabase();
  const { rowCount } = await db.query('DELETE FROM symptoms WHERE id = $1 AND user_id = $2', [symptomId, userId]);
  if (!rowCount) {
    throw new HttpError(404, 'লক্ষণ পাওয়া যায়নি।');
  }
}

export { pool };
