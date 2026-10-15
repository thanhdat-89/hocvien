-- Staging database: preserve every document and nested subcollection.
-- Deliberately private: backend access only; no browser grants.
BEGIN;
CREATE SCHEMA IF NOT EXISTS qlhv_migration;
REVOKE ALL ON SCHEMA qlhv_migration FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS qlhv_migration.documents (
  path text PRIMARY KEY,
  collection_path text NOT NULL,
  document_id text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(collection_path, document_id)
);
ALTER TABLE qlhv_migration.documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qlhv_migration.documents FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS documents_collection_idx ON qlhv_migration.documents(collection_path);
CREATE INDEX IF NOT EXISTS documents_student_idx ON qlhv_migration.documents((data->>'studentId'));
CREATE INDEX IF NOT EXISTS documents_class_idx ON qlhv_migration.documents((data->>'classId'));
CREATE INDEX IF NOT EXISTS documents_date_idx ON qlhv_migration.documents((data->>'sessionDate'));
CREATE TABLE IF NOT EXISTS qlhv_migration.sync_operations (
  operation_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE qlhv_migration.sync_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qlhv_migration.sync_operations FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE VIEW qlhv_migration.students AS
 SELECT document_id AS id, data->>'fullName' AS full_name,
 data->>'gradeLevel' AS grade_level, data->>'status' AS status, data
 FROM qlhv_migration.documents WHERE collection_path = 'students';
CREATE OR REPLACE VIEW qlhv_migration.private_sessions AS
 SELECT document_id AS id, data->>'studentId' AS student_id,
 data->>'sessionDate' AS session_date, data->>'status' AS status, data
 FROM qlhv_migration.documents WHERE collection_path = 'privateSchedules';
CREATE OR REPLACE VIEW qlhv_migration.unscheduled_private_students_current_month AS
 SELECT s.id, s.full_name, s.grade_level, 'Học riêng'::text AS class_name
 FROM qlhv_migration.students s
 WHERE NOT EXISTS (
   SELECT 1 FROM qlhv_migration.documents e
   WHERE e.collection_path = 'classEnrollments'
   AND e.data->>'studentId' = s.id AND e.data->>'status' = 'ACTIVE'
 ) AND NOT EXISTS (
   SELECT 1 FROM qlhv_migration.private_sessions p
   WHERE p.student_id = s.id
   AND p.session_date >= to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD')
   AND p.session_date < to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '1 month', 'YYYY-MM-DD')
 );
COMMIT;
