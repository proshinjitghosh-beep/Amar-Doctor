CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) UNIQUE,
  phone VARCHAR(30) UNIQUE,
  password_hash TEXT,
  role VARCHAR(20) NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'doctor', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_profiles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  specialty VARCHAR(100) NOT NULL,
  registration_number VARCHAR(100),
  bio TEXT,
  consultation_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (consultation_fee >= 0),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES users(id),
  doctor_id BIGINT NOT NULL REFERENCES doctor_profiles(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES users(id),
  doctor_id BIGINT REFERENCES doctor_profiles(id),
  consultation_type VARCHAR(20) NOT NULL CHECK (consultation_type IN ('ai', 'human')),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'escalated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medical_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES users(id),
  record_type VARCHAR(30) NOT NULL CHECK (record_type IN ('prescription', 'lab_report', 'diagnosis', 'other')),
  title VARCHAR(180) NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_doctor_time ON appointments(doctor_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_time ON appointments(patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_medical_records_patient_time ON medical_records(patient_id, created_at DESC);
