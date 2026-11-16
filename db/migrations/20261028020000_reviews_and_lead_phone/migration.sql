-- DropForeignKey
ALTER TABLE "student_reviews" DROP CONSTRAINT "student_reviews_teacherId_fkey";

-- DropIndex
DROP INDEX "student_reviews_studentId_month_idx";

-- AlterTable
ALTER TABLE "student_reviews" ADD COLUMN     "teacherName" TEXT;

-- AlterTable
-- Đổi tên (không xoá/tạo lại) để giữ số điện thoại đã có
ALTER TABLE "leads" RENAME COLUMN "parentPhone" TO "phone";

-- CreateIndex
CREATE UNIQUE INDEX "student_reviews_studentId_month_key" ON "student_reviews"("studentId", "month");

