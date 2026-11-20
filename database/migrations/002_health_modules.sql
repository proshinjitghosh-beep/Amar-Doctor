-- Healthcare modules: shared health profile, reports, medications, reminders,
-- emergency assistance, visit preparation, notifications and audit trail.
--
-- Every statement is guarded with IF NOT EXISTS so the file stays re-runnable.
-- New migrations must keep a zero-padded 3-digit prefix: the runner sorts
-- filenames lexicographically, so 010_ would otherwise sort before 002_.

-- ---------------------------------------------------------------- sessions --
CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ---------------------------------------------------------- health_profiles --
CREATE TABLE IF NOT EXISTS health_profiles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(160),
  date_of_birth DATE,
  sex VARCHAR(20),
  blood_group VARCHAR(10),
  height_cm NUMERIC(5,2) CHECK (height_cm IS NULL OR (height_cm > 0 AND height_cm < 300)),
  weight_kg NUMERIC(5,2) CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg < 500)),
  allergies TEXT,
  medical_conditions TEXT,
  emergency_notes TEXT,
  -- Opt-in mirror of the emergency profile into browser localStorage so the SOS
  -- screen still works when the backend is unreachable. Off by default.
  offline_emergency_mirror BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------- medical_reports --
CREATE TABLE IF NOT EXISTS medical_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  file_data BYTEA NOT NULL,
  report_type VARCHAR(60),
  -- How the text was obtained: 'pdf_text', 'ocr', or 'manual'.
  extraction_method VARCHAR(20),
  extraction_confidence NUMERIC(4,3),
  extracted_text TEXT,
  analysis_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (analysis_status IN ('pending','analyzing','analyzed','failed','unavailable')),
  analysis_json JSONB,
  analysis_language VARCHAR(10) NOT NULL DEFAULT 'bn',
  -- 'extracted' | 'needs_review' | 'patient_confirmed' | 'clinician_confirmed'
  verification_status VARCHAR(24) NOT NULL DEFAULT 'extracted'
    CHECK (verification_status IN ('extracted','needs_review','patient_confirmed','clinician_confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_user_time ON medical_reports(user_id, created_at DESC);

-- ----------------------------------------------------------- report_results --
CREATE TABLE IF NOT EXISTS report_results (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES medical_reports(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  result_value TEXT,
  unit TEXT,
  reference_range TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('normal','below_reference','above_reference','critical_high','critical_low','unknown')),
  interpretation TEXT,
  explanation TEXT,
  requires_review BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status VARCHAR(24) NOT NULL DEFAULT 'extracted'
    CHECK (verification_status IN ('extracted','needs_review','patient_confirmed','clinician_confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_results_report ON report_results(report_id);
CREATE INDEX IF NOT EXISTS idx_report_results_user ON report_results(user_id);

-- ------------------------------------------------------------- medications --
CREATE TABLE IF NOT EXISTS medications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medicine_name TEXT NOT NULL,
  dosage TEXT,
  instructions TEXT,
  start_date DATE,
  end_date DATE,
  quantity_on_hand NUMERIC(8,2),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','discontinued')),
  verification_status VARCHAR(24) NOT NULL DEFAULT 'patient_confirmed'
    CHECK (verification_status IN ('extracted','needs_review','patient_confirmed','clinician_confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medications_user_status ON medications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_medications_user_time ON medications(user_id, created_at DESC);

-- -------------------------------------------------------- medicine_schedules --
CREATE TABLE IF NOT EXISTS medicine_schedules (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  medication_id BIGINT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_time VARCHAR(5) NOT NULL,
  repeat_days VARCHAR(20) NOT NULL DEFAULT '0,1,2,3,4,5,6',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Dhaka',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_medication ON medicine_schedules(medication_id);
CREATE INDEX IF NOT EXISTS idx_schedules_user_active ON medicine_schedules(user_id, is_active);

-- ---------------------------------------------------------------- dose_logs --
CREATE TABLE IF NOT EXISTS dose_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medication_id BIGINT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  schedule_id BIGINT REFERENCES medicine_schedules(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  taken_at TIMESTAMPTZ,
  status VARCHAR(12) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','taken','skipped','snoozed','missed')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per medication + schedule + occurrence. This is what makes duplicate
-- notifications structurally impossible. COALESCE is used because plain NULLs
-- are distinct in a Postgres unique index, which would let a schedule-less
-- dose be inserted twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dose_logs_occurrence
  ON dose_logs(medication_id, COALESCE(schedule_id, 0), scheduled_at);
CREATE INDEX IF NOT EXISTS idx_dose_logs_user_time ON dose_logs(user_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_dose_logs_status ON dose_logs(user_id, status);

-- -------------------------------------------------------- emergency_profiles --
CREATE TABLE IF NOT EXISTS emergency_profiles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  blood_group VARCHAR(10),
  allergies TEXT,
  conditions TEXT,
  emergency_notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------- emergency_contacts --
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship VARCHAR(60),
  phone VARCHAR(30) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_user ON emergency_contacts(user_id);

-- ----------------------------------------------------------- emergency_events --
CREATE TABLE IF NOT EXISTS emergency_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL DEFAULT 'sos',
  location_lat DOUBLE PRECISION,
  location_lng DOUBLE PRECISION,
  location_source VARCHAR(20),
  location_shared BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','notified','resolved')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_user_time ON emergency_events(user_id, created_at DESC);

-- ------------------------------------------- emergency_event_notifications --
CREATE TABLE IF NOT EXISTS emergency_event_notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
  contact_id BIGINT NOT NULL REFERENCES emergency_contacts(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL DEFAULT 'link',
  -- 'pending' | 'sent' | 'failed' | 'unavailable'
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','unavailable')),
  detail TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_notifications_event ON emergency_event_notifications(event_id);

-- ----------------------------------------------------------------- symptoms --
CREATE TABLE IF NOT EXISTS symptoms (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symptom_name TEXT NOT NULL,
  description TEXT,
  severity VARCHAR(20) NOT NULL DEFAULT 'mild'
    CHECK (severity IN ('mild','moderate','severe')),
  started_at DATE,
  frequency VARCHAR(40),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symptoms_user_time ON symptoms(user_id, recorded_at DESC);

-- ---------------------------------------------------------- visit_summaries --
CREATE TABLE IF NOT EXISTS visit_summaries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
  summary_json JSONB NOT NULL,
  summary_text TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','patient_confirmed','clinician_confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visit_summaries_user_time ON visit_summaries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visit_summaries_appointment ON visit_summaries(appointment_id);

-- ------------------------------------------------------------ notifications --
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL DEFAULT 'reminder',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  medication_id BIGINT REFERENCES medications(id) ON DELETE CASCADE,
  schedule_id BIGINT REFERENCES medicine_schedules(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  -- 'pending' | 'sent' | 'failed' | 'unavailable'
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','unavailable')),
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One notification per scheduled dose: duplicate delivery is impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dose
  ON notifications(medication_id, schedule_id, scheduled_at)
  WHERE medication_id IS NOT NULL AND schedule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unsent ON notifications(scheduled_at) WHERE sent_at IS NULL;

-- -------------------------------------------------------- push_subscriptions --
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- --------------------------------------------------------------- share_links --
CREATE TABLE IF NOT EXISTS share_links (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visit_summary_id BIGINT NOT NULL REFERENCES visit_summaries(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  recipient_name VARCHAR(160),
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_links_summary ON share_links(visit_summary_id);

-- ---------------------------------------------------------------- audit_logs --
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  resource_type VARCHAR(40) NOT NULL,
  resource_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time ON audit_logs(user_id, created_at DESC);

-- --------------------------------------------------- demo doctor seeding ----
-- The prototype's doctor list lives in frontend/public/js/app.js. Seeding the
-- same eight doctors lets real appointments be written to the existing
-- appointments table instead of inventing a parallel booking system.
INSERT INTO users (full_name, role)
SELECT s.full_name, 'doctor'
FROM (VALUES
  ('ডা. সাবরিনা রহমান'), ('ডা. আরিফুল ইসলাম'), ('ডা. নুসরাত জাহান'),
  ('ডা. তানভীর আহমেদ'), ('ডা. ফারহানা ইয়াসমিন'), ('ডা. মাহমুদ হাসান'),
  ('ডা. রিমা সুলতানা'), ('ডা. কামরুল হাসান')
) AS s(full_name)
WHERE NOT EXISTS (SELECT 1 FROM users WHERE full_name = s.full_name AND role = 'doctor');

INSERT INTO doctor_profiles (user_id, specialty, bio, consultation_fee, is_verified)
SELECT u.id, s.specialty, s.bio, s.fee, TRUE
FROM (VALUES
  ('ডা. সাবরিনা রহমান','Gynecologist','গাইনি',12,600),
  ('ডা. আরিফুল ইসলাম','Cardiologist','হৃদরোগ',15,1000),
  ('ডা. নুসরাত জাহান','Pediatrician','শিশু',9,500),
  ('ডা. তানভীর আহমেদ','General','মেডিসিন',7,400),
  ('ডা. ফারহানা ইয়াসমিন','Dermatologist','চর্ম',10,700),
  ('ডা. মাহমুদ হাসান','Neurologist','স্নায়ু',14,1200),
  ('ডা. রিমা সুলতানা','Psychiatrist','মানসিক',8,800),
  ('ডা. কামরুল হাসান','Orthopedic','হাড়-জোড়া',11,900)
) AS s(full_name, specialty, bio, fee)
JOIN users u ON u.full_name = s.full_name AND u.role = 'doctor'
WHERE NOT EXISTS (
  SELECT 1 FROM doctor_profiles dp WHERE dp.user_id = u.id AND dp.specialty = s.specialty
);
