-- Thông tin xuất hoá đơn cá nhân của học viên (đều tuỳ chọn).
-- AlterTable
ALTER TABLE "students"
  ADD COLUMN "invoiceFullName" TEXT,
  ADD COLUMN "invoiceCitizenId" TEXT,
  ADD COLUMN "invoiceAddress" TEXT,
  ADD COLUMN "invoiceEmail" TEXT,
  ADD COLUMN "invoicePhone" TEXT;
