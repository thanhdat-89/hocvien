-- Cảnh báo cho quản trị (chuông thông báo) theo cơ sở của học viên liên quan.
-- AlterTable
ALTER TABLE "admin_alerts" ADD COLUMN     "branchId" TEXT;

-- CreateIndex
CREATE INDEX "admin_alerts_branchId_read_createdAt_idx" ON "admin_alerts"("branchId", "read", "createdAt");


UPDATE "admin_alerts" a SET "branchId" = s."branchId" FROM "students" s WHERE s."id" = a."data"->>'studentId';
