-- Hoá đơn MISA theo cơ sở: mỗi dòng có khoá chính = mã phiếu học phí, cơ sở lấy theo học viên của phiếu đó
-- (dòng không còn phiếu thì thử các phiếu khác trong recordIds, rồi studentId trong source).
-- AlterTable
ALTER TABLE "misa_invoices" ADD COLUMN "branchId" TEXT;

UPDATE "misa_invoices" m SET "branchId" = s."branchId"
FROM "tuition_records" t JOIN "students" s ON s."id" = t."studentId"
WHERE t."id" = m."id";

UPDATE "misa_invoices" m SET "branchId" = (
  SELECT s."branchId" FROM "tuition_records" t JOIN "students" s ON s."id" = t."studentId"
  WHERE t."id" = ANY (m."recordIds") LIMIT 1)
WHERE m."branchId" IS NULL;

UPDATE "misa_invoices" m SET "branchId" = s."branchId"
FROM "students" s
WHERE m."branchId" IS NULL AND s."id" = m."source"->>'studentId';

-- CreateIndex
CREATE INDEX "misa_invoices_branchId_idx" ON "misa_invoices"("branchId");
