-- theodoi cần biết lịch cố định trong tuần của học viên (học một phần số buổi của lớp)
-- để không tính các buổi em không học vào BTVN / thống kê. Quy tắc giữ như migration theodoi_read_views:
-- chỉ đọc, enum ép về text, không có cột tiền.
CREATE OR REPLACE VIEW theodoi_view.v_enrollment_weekday_plans AS
SELECT "id", "enrollmentId", "effectiveFrom", COALESCE("days"::text[], '{}'::text[]) AS "days"
FROM public."enrollment_weekday_plans";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'theodoi_reader') THEN
    GRANT USAGE ON SCHEMA theodoi_view TO theodoi_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA theodoi_view TO theodoi_reader;
  END IF;
END $$;
