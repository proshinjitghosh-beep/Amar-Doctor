-- 003: per-row provenance for report results, and the demo doctors' fees.
--
-- 002_health_modules.sql seeded the eight demo doctors with a VALUES block
-- that has five columns but only four aliases (`AS s(full_name, specialty,
-- bio, fee)`). Postgres silently kept the first four and dropped the fifth,
-- so `consultation_fee` was bound to the experience-years column: the seeded
-- fees came out as 12, 15, 9, 7, 10, 14, 8 and 11 instead of the intended
-- 600, 1000, 500, 400, 700, 1200, 800 and 900.
--
-- 002 is already applied and its checksum is recorded in schema_migrations,
-- so it cannot be edited. The fee is corrected here instead.
--
-- The second change adds `report_results.source`, so a value the patient
-- typed in by hand can be told apart from one read out of the document after
-- a reload. `verification_status` alone cannot carry that: a patient who
-- types their own value is `patient_confirmed`, exactly like a patient who
-- confirms an extracted value.

-- --------------------------------------------------- correct doctor fees ---
UPDATE doctor_profiles dp
   SET consultation_fee = s.fee
  FROM users u
  JOIN (VALUES
    ('ডা. সাবরিনা রহমান', 600), ('ডা. আরিফুল ইসলাম', 1000),
    ('ডা. নুসরাত জাহান', 500), ('ডা. তানভীর আহমেদ', 400),
    ('ডা. ফারহানা ইয়াসমিন', 700), ('ডা. মাহমুদ হাসান', 1200),
    ('ডা. রিমা সুলতানা', 800), ('ডা. কামরুল হাসান', 900)
  ) AS s(full_name, fee) ON s.full_name = u.full_name
 WHERE dp.user_id = u.id
   AND dp.consultation_fee <> s.fee;

-- ------------------------------------------- per-row result provenance ---
ALTER TABLE report_results
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'extracted'
    CHECK (source IN ('extracted', 'manual'));
