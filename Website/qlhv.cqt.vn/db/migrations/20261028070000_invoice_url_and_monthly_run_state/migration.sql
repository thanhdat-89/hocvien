-- monthly_invoice_runs / _items trống khi viết migration này (Firestore chưa có lượt đối soát nào): đổi sang cột trạng thái + JSONB data.
-- AlterTable
ALTER TABLE "misa_invoices" ADD COLUMN     "invoiceUrl" TEXT;

-- AlterTable
ALTER TABLE "monthly_invoice_runs" DROP COLUMN "cutoff",
DROP COLUMN "excludedAfterCutoff",
DROP COLUMN "extra",
DROP COLUMN "month",
DROP COLUMN "reconciledAt",
DROP COLUMN "startedAt",
DROP COLUMN "total",
DROP COLUMN "year",
ADD COLUMN     "data" JSONB NOT NULL,
ALTER COLUMN "leaseToken" SET NOT NULL,
ALTER COLUMN "leaseToken" SET DEFAULT '',
ALTER COLUMN "leaseUntil" SET NOT NULL,
ALTER COLUMN "leaseUntil" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "monthly_invoice_run_items" DROP COLUMN "amount",
DROP COLUMN "className",
DROP COLUMN "linkedInvoiceId",
DROP COLUMN "reason",
DROP COLUMN "studentName",
ADD COLUMN     "data" JSONB NOT NULL;

-- CreateIndex
CREATE INDEX "monthly_invoice_runs_status_idx" ON "monthly_invoice_runs"("status");

