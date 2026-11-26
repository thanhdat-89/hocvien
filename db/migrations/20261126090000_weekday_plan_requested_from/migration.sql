-- Đổi buổi học: khi học phí tháng hiện tại đã thu / xuất hoá đơn, ngày áp dụng (effectiveFrom, dùng tính học phí)
-- bị dời sang đầu tháng sau. requestedFrom lưu ngày học viên THỰC TẾ bắt đầu học lịch mới (ngày người dùng chọn ban đầu)
-- để theodoi xếp buổi BTVN theo lịch thật. NULL = trùng effectiveFrom. Học phí vẫn chỉ dùng effectiveFrom.
ALTER TABLE "enrollment_weekday_plans" ADD COLUMN "requestedFrom" DATE;

-- View cho theodoi: thêm cột ở cuối (CREATE OR REPLACE VIEW chỉ cho thêm cột cuối).
CREATE OR REPLACE VIEW theodoi_view.v_enrollment_weekday_plans AS
SELECT "id", "enrollmentId", "effectiveFrom", COALESCE("days"::text[], '{}'::text[]) AS "days", "requestedFrom"
FROM public."enrollment_weekday_plans";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'theodoi_reader') THEN
    GRANT USAGE ON SCHEMA theodoi_view TO theodoi_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA theodoi_view TO theodoi_reader;
  END IF;
END $$;
