-- Ràng buộc Prisma không diễn đạt được. Chạy sau `prisma migrate` (đưa vào một migration SQL).
-- Thay cho các bảo đảm mà Firestore trước đây làm bằng ID cố định / transaction trong code.

-- Mỗi học viên chỉ có một ghi danh ACTIVE trong một lớp (cho phép DROPPED rồi ghi danh lại).
CREATE UNIQUE INDEX class_enrollments_active_uniq
  ON class_enrollments ("studentId", "classId")
  WHERE status = 'ACTIVE';

-- Một phiếu học phí cho mỗi học viên × lớp (hoặc học riêng) × tháng.
CREATE UNIQUE INDEX tuition_records_period_uniq
  ON tuition_records ("studentId", COALESCE("classId", 'private'), "billingYear", "billingMonth");

-- Một bảng điểm cho mỗi học viên × lớp (hoặc học riêng) × tháng.
CREATE UNIQUE INDEX monthly_scores_period_uniq
  ON monthly_scores ("studentId", COALESCE("classId", 'private'), year, month);

ALTER TABLE tuition_records
  ADD CONSTRAINT tuition_records_month_chk  CHECK ("billingMonth" BETWEEN 1 AND 12),
  ADD CONSTRAINT tuition_records_amount_chk CHECK ("baseAmount" >= 0 AND "discountAmount" >= 0 AND "finalAmount" >= 0 AND "paidAmount" >= 0);

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_chk CHECK (amount > 0);

ALTER TABLE monthly_scores
  ADD CONSTRAINT monthly_scores_month_chk CHECK (month BETWEEN 1 AND 12);

ALTER TABLE private_sessions
  ADD CONSTRAINT private_sessions_rate_chk CHECK ("ratePerSession" >= 0);

ALTER TABLE sessions
  ADD CONSTRAINT sessions_time_chk CHECK ("startTime" ~ '^\d{2}:\d{2}$' AND "endTime" ~ '^\d{2}:\d{2}$');
