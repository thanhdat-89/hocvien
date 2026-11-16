-- Lịch sử hoạt động theo cơ sở. Log cũ có từ khi chỉ có một cơ sở: gán cơ sở đầu tiên, trừ thao tác cấp hệ thống.
-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "branchId" TEXT;

-- CreateIndex
CREATE INDEX "activity_logs_branchId_createdAt_idx" ON "activity_logs"("branchId", "createdAt");


UPDATE "activity_logs" SET "branchId" = (SELECT "id" FROM "branches" ORDER BY "createdAt" LIMIT 1)
WHERE "resourceType" NOT IN ('users', 'branches', 'school-years');
