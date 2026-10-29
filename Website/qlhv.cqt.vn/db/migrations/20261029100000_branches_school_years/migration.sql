-- Cơ sở và năm học. Dữ liệu đang có vào cơ sở "CQT 263" và năm học đầu tiên (bắt đầu từ tháng sớm nhất có dữ liệu,
-- muộn nhất 01/07/2026; ADMIN chỉnh ngày sau). Cột bắt buộc được thêm dạng cho phép NULL, gán giá trị rồi mới đặt NOT NULL.

-- CreateEnum
CREATE TYPE "SchoolYearStatus" AS ENUM ('UPCOMING', 'CURRENT', 'CLOSED');

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_years" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "SchoolYearStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "school_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branches" (
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateTable
CREATE TABLE "teacher_branches" (
    "teacherId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "teacher_branches_pkey" PRIMARY KEY ("teacherId","branchId")
);

-- CreateTable
CREATE TABLE "holiday_branches" (
    "holidayId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "holiday_branches_pkey" PRIMARY KEY ("holidayId","branchId")
);

-- Dữ liệu ban đầu
INSERT INTO "branches" ("id", "name", "updatedAt") VALUES ('cqt263branch00000001', 'CQT 263', CURRENT_TIMESTAMP);

INSERT INTO "school_years" ("id", "name", "startDate", "endDate", "status", "updatedAt")
SELECT 'schoolyear2026202700', '2026–2027',
  date_trunc('month', LEAST(DATE '2026-07-01',
    COALESCE((SELECT min("enrollmentDate") FROM "class_enrollments"), DATE '2026-07-01'),
    COALESCE((SELECT min("sessionDate") FROM "sessions"), DATE '2026-07-01'),
    COALESCE((SELECT min("sessionDate") FROM "private_sessions"), DATE '2026-07-01'),
    COALESCE((SELECT min("startDate") FROM "classes"), DATE '2026-07-01'),
    COALESCE((SELECT min(make_date("billingYear", "billingMonth", 1)) FROM "tuition_records"), DATE '2026-07-01')))::date,
  DATE '2027-06-30', 'CURRENT', CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "students" ADD COLUMN "branchId" TEXT;
ALTER TABLE "classes" ADD COLUMN "branchId" TEXT, ADD COLUMN "schoolYearId" TEXT;
ALTER TABLE "leads" ADD COLUMN "branchId" TEXT;

UPDATE "students" SET "branchId" = 'cqt263branch00000001';
UPDATE "classes" SET "branchId" = 'cqt263branch00000001', "schoolYearId" = 'schoolyear2026202700';
UPDATE "leads" SET "branchId" = 'cqt263branch00000001';
INSERT INTO "user_branches" ("userId", "branchId") SELECT "id", 'cqt263branch00000001' FROM "users";
INSERT INTO "teacher_branches" ("teacherId", "branchId") SELECT "id", 'cqt263branch00000001' FROM "teachers";
INSERT INTO "holiday_branches" ("holidayId", "branchId") SELECT "id", 'cqt263branch00000001' FROM "holidays";

ALTER TABLE "students" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "classes" ALTER COLUMN "branchId" SET NOT NULL, ALTER COLUMN "schoolYearId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "branches_name_key" ON "branches"("name");

-- CreateIndex
CREATE UNIQUE INDEX "school_years_name_key" ON "school_years"("name");

-- CreateIndex
CREATE INDEX "students_branchId_status_idx" ON "students"("branchId", "status");

-- CreateIndex
CREATE INDEX "classes_branchId_schoolYearId_status_idx" ON "classes"("branchId", "schoolYearId", "status");

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_branches" ADD CONSTRAINT "teacher_branches_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_branches" ADD CONSTRAINT "teacher_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_branches" ADD CONSTRAINT "holiday_branches_holidayId_fkey" FOREIGN KEY ("holidayId") REFERENCES "holidays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_branches" ADD CONSTRAINT "holiday_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "school_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ràng buộc Prisma không diễn đạt được: tối đa một năm học đang chạy; ngày kết thúc không trước ngày bắt đầu
CREATE UNIQUE INDEX "school_years_one_current" ON "school_years" ((true)) WHERE "status" = 'CURRENT';
ALTER TABLE "school_years" ADD CONSTRAINT "school_years_dates_check" CHECK ("endDate" >= "startDate");
