-- Lịch cố định trong tuần của học viên trong một lớp (học một phần số buổi của lớp).
-- Không có dòng nào cho ghi danh = học mọi buổi như trước đây, nên dữ liệu hiện có không đổi.
CREATE TABLE "enrollment_weekday_plans" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "days" "DayOfWeek"[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_weekday_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "enrollment_weekday_plans_enrollmentId_effectiveFrom_key" ON "enrollment_weekday_plans"("enrollmentId", "effectiveFrom");

ALTER TABLE "enrollment_weekday_plans" ADD CONSTRAINT "enrollment_weekday_plans_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "class_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
