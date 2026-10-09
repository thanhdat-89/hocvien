SELECT collection_path, count(*) AS documents
FROM qlhv_migration.documents GROUP BY collection_path ORDER BY collection_path;
SELECT count(*) AS total_documents FROM qlhv_migration.documents;
SELECT * FROM qlhv_migration.unscheduled_private_students_current_month
ORDER BY full_name, id;
-- These relationships should be investigated, never deleted automatically.
SELECT e.path AS orphaned_enrollment FROM qlhv_migration.documents e
WHERE e.collection_path='classEnrollments' AND NOT EXISTS (
 SELECT 1 FROM qlhv_migration.students s WHERE s.id=e.data->>'studentId');
SELECT p.id AS orphaned_private_session FROM qlhv_migration.private_sessions p
WHERE NOT EXISTS (SELECT 1 FROM qlhv_migration.students s WHERE s.id=p.student_id);
