-- Dữ liệu cho theodoi.cqt.vn (theo dõi BTVN): chỉ đọc, qua các view trong schema riêng.
-- Role theodoi_reader (tạo bằng db/vps/setup-theodoi-reader.sh) chỉ có USAGE trên schema này và SELECT trên các view;
-- không có quyền gì trên schema public → không đọc được học phí, thanh toán, hoá đơn, phụ huynh, lead, người dùng.
--
-- Quy tắc khi sửa:
--  - KHÔNG thêm cột liên quan đến tiền (tuitionRate, customTuitionRate, ratePerSession, salary…) hay thông tin liên hệ.
--  - Đổi/xoá cột ở các bảng dưới đây thì sửa view trong cùng migration.
--  - Enum ép về text để theodoi không phụ thuộc kiểu enum của qlhv.
--  - Dùng CREATE OR REPLACE để giữ quyền đã cấp; nếu buộc phải DROP thì cấp lại quyền (khối DO cuối file).

CREATE SCHEMA IF NOT EXISTS theodoi_view;
REVOKE ALL ON SCHEMA theodoi_view FROM PUBLIC;

CREATE OR REPLACE VIEW theodoi_view.v_branches AS
SELECT "id", "name", "isActive"
FROM public."branches";

CREATE OR REPLACE VIEW theodoi_view.v_school_years AS
SELECT "id", "name", "status"::text AS "status", "startDate", "endDate"
FROM public."school_years";

CREATE OR REPLACE VIEW theodoi_view.v_teachers AS
SELECT "id", "fullName", "status"::text AS "status"
FROM public."teachers";

CREATE OR REPLACE VIEW theodoi_view.v_classes AS
SELECT "id", "name", "gradeLevel", "branchId", "schoolYearId", "teacherId", "status"::text AS "status",
       "startDate", "endDate"
FROM public."classes";

CREATE OR REPLACE VIEW theodoi_view.v_students AS
SELECT "id", "fullName", "gradeLevel", "branchId", "status"::text AS "status"
FROM public."students";

CREATE OR REPLACE VIEW theodoi_view.v_enrollments AS
SELECT "id", "classId", "studentId", "status"::text AS "status", "enrollmentDate", "dropDate"
FROM public."class_enrollments";

CREATE OR REPLACE VIEW theodoi_view.v_sessions AS
SELECT "id", "classId", "teacherId", "sessionDate", "startTime", "endTime", "status"::text AS "status"
FROM public."sessions";

-- Không có ratePerSession.
CREATE OR REPLACE VIEW theodoi_view.v_private_sessions AS
SELECT "id", "studentId", "sessionDate", "startTime", "endTime", "teacherName", "status"::text AS "status"
FROM public."private_sessions";

CREATE OR REPLACE VIEW theodoi_view.v_attendances AS
SELECT "sessionId", "classId", "studentId", "status"::text AS "status"
FROM public."student_attendances";

-- Cấp quyền nếu role đã tồn tại (môi trường dev / staging có thể chưa có role này).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'theodoi_reader') THEN
    GRANT USAGE ON SCHEMA theodoi_view TO theodoi_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA theodoi_view TO theodoi_reader;
  END IF;
END $$;
