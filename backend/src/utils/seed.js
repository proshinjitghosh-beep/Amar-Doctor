/**
 * Seed one demo account with clearly-labelled sample records.
 *
 * This is a demo convenience for the hackathon, not a fixture the tests
 * depend on. Every record it creates is named so that it is obvious in the
 * interface that it is sample data and not something the patient entered.
 *
 * Running it twice is safe: the demo account is looked up by email first and
 * reused, and each sample record is only created when it is missing.
 *
 *   npm run db:seed
 */

import { pool, requireDatabase } from '../config/database.js';
import { hashPassword } from '../services/auth.service.js';
import * as medsRepo from '../repositories/medications.repository.js';
import * as emergencyRepo from '../repositories/emergency.repository.js';
import { normaliseProfileInput } from '../services/emergency.service.js';
import * as healthProfile from '../services/health-profile.service.js';
import { materialiseDoses } from '../services/medication-reminder.service.js';

const DEMO_EMAIL = 'demo@amar-doctor.test';
const DEMO_PASSWORD = 'demo12345';
const DEMO_NAME = 'ডেমো রোগী';

/** Every sample record carries this marker in its name. */
const DEMO = 'ডেমো';

function log(message) {
  process.stdout.write(`${message}\n`);
}

/** Find the demo account, creating it when it is not there yet. */
async function findOrCreateDemoUser() {
  const db = requireDatabase();
  const existing = await db.query('SELECT id, full_name, email FROM users WHERE email = $1', [DEMO_EMAIL]);
  if (existing.rowCount) {
    return { id: Number(existing.rows[0].id), created: false };
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const { rows } = await db.query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, 'patient')
     RETURNING id`,
    [DEMO_NAME, DEMO_EMAIL, passwordHash]
  );
  return { id: Number(rows[0].id), created: true };
}

/**
 * Insert a medication only when the patient has no medicine with this name.
 * Returns the medication id either way.
 */
async function ensureMedication(userId, { medicineName, dosage, instructions, quantityOnHand }) {
  const db = requireDatabase();
  const existing = await db.query(
    'SELECT id FROM medications WHERE user_id = $1 AND medicine_name = $2 AND status = $3',
    [userId, medicineName, 'active']
  );
  if (existing.rowCount) return { id: Number(existing.rows[0].id), created: false };

  const medication = await medsRepo.insertMedication(userId, {
    medicineName,
    dosage,
    instructions,
    quantityOnHand,
    status: 'active',
    // The patient typed this in, so it is confirmed by the patient.
    verificationStatus: 'patient_confirmed',
  });
  return { id: medication.id, created: true };
}

/** Insert a schedule only when this medication has no schedule at that time. */
async function ensureSchedule(userId, medicationId, { reminderTime, repeatDays }) {
  const db = requireDatabase();
  const existing = await db.query(
    'SELECT id FROM medicine_schedules WHERE user_id = $1 AND medication_id = $2 AND reminder_time = $3 AND is_active = TRUE',
    [userId, medicationId, reminderTime]
  );
  if (existing.rowCount) return false;

  await medsRepo.insertSchedule(userId, medicationId, {
    reminderTime,
    repeatDays,
    timezone: 'Asia/Dhaka',
    isActive: true,
  });
  return true;
}

/** Insert an emergency contact only when this phone number is not present. */
async function ensureContact(userId, { name, relationship, phone, isPrimary }) {
  const db = requireDatabase();
  const existing = await db.query(
    'SELECT id FROM emergency_contacts WHERE user_id = $1 AND phone = $2',
    [userId, phone]
  );
  if (existing.rowCount) return false;

  await emergencyRepo.insertContact(userId, { name, relationship, phone, isPrimary });
  return true;
}

export async function seed() {
  const db = requireDatabase();

  const user = await findOrCreateDemoUser();
  log(user.created ? 'ডেমো অ্যাকাউন্ট তৈরি হয়েছে।' : 'ডেমো অ্যাকাউন্ট আগে থেকেই আছে।');

  await healthProfile.updateHealthProfile(user.id, {
    fullName: DEMO_NAME,
    bloodGroup: 'B+',
    allergies: ['পেনিসিলিন'],
    medicalConditions: ['হালকা অ্যাস্টমা'],
  });

  // Symptoms. The names are marked so they read as sample data.
  const { rows: symptomRows } = await db.query(
    'SELECT id FROM symptoms WHERE user_id = $1 AND symptom_name = $2',
    [user.id, `${DEMO} — তিন দিন ধরে মাথাব্যথা`]
  );
  if (!symptomRows.length) {
    // The symptom started three days ago, so the timeline has a real date.
    const startedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await healthProfile.createSymptom(user.id, {
      symptomName: `${DEMO} — তিন দিন ধরে মাথাব্যথা`,
      description: 'সকালে বেশি বাড়ে, দিনে একবার ওষুধ খেলে কমে।',
      severity: 'moderate',
      startedAt,
      frequency: 'দিনে ১-২ বার',
    });
  }

  const paracetamol = await ensureMedication(user.id, {
    medicineName: `${DEMO} — প্যারাসিটামল`,
    dosage: '৫০০mg',
    instructions: 'খাবারের পরে',
    quantityOnHand: 12,
  });
  await ensureSchedule(user.id, paracetamol.id, { reminderTime: '08:00', repeatDays: '0,1,2,3,4,5,6' });
  await ensureSchedule(user.id, paracetamol.id, { reminderTime: '20:00', repeatDays: '0,1,2,3,4,5,6' });

  const montelukast = await ensureMedication(user.id, {
    medicineName: `${DEMO} — মন্টেলুকাস্ট`,
    dosage: '১০mg',
    instructions: 'রাতে ঘুমানোর আগে',
    quantityOnHand: 5,
  });
  await ensureSchedule(user.id, montelukast.id, { reminderTime: '21:00', repeatDays: '0,1,2,3,4,5,6' });

  // The dose rows the timeline reads. Without this the reminders list is empty
  // until something else triggers materialisation.
  await materialiseDoses(user.id);

  // The emergency profile is written through the service's normaliser, so the
  // allergy and condition lists are stored in the same newline-separated form
  // the API writes. Passing the raw array would store it as a Postgres array
  // literal and the page would show it back as raw text.
  await emergencyRepo.upsertEmergencyProfile(user.id, normaliseProfileInput({
    bloodGroup: 'B+',
    allergies: ['পেনিসিলিন'],
    conditions: ['হালকা অ্যাস্টমা'],
    emergencyNotes: `${DEMO} — বাসায় ঔষধের তালিকা ফ্রিজে রাখা আছে।`,
  }));
  await ensureContact(user.id, {
    name: `${DEMO} — রহিমা (স্ত্রী)`,
    relationship: 'স্ত্রী',
    phone: '01700000001',
    isPrimary: true,
  });
  await ensureContact(user.id, {
    name: `${DEMO} — কামাল (ভাই)`,
    relationship: 'ভাই',
    phone: '01700000002',
    isPrimary: false,
  });

  log('');
  log('ডেমো অ্যাকাউন্টের তথ্য:');
  log(`  ইমেইল    : ${DEMO_EMAIL}`);
  log(`  পাসওয়ার্ড: ${DEMO_PASSWORD}`);
  log('');
  log('সব নমুনা রেকর্ডের নামে "ডেমো" শব্দটি আছে, যাতে বোঝা যায় সেগুলো নমুনা।');
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  seed()
    .then(() => pool?.end())
    .then(() => process.exit(0))
    .catch((error) => {
      process.stderr.write(`সিড করা যায়নি: ${error.message}\n`);
      pool?.end().finally(() => process.exit(1));
    });
}

export { DEMO_EMAIL, DEMO_PASSWORD };
