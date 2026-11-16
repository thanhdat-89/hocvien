-- Cảnh báo "đã xử lý" tách khỏi "đã đọc".
-- AlterTable
ALTER TABLE "admin_alerts" ADD COLUMN "resolvedAt" TIMESTAMPTZ(3);

-- Cảnh báo hoá đơn MISA cũ mà phiếu đã có hoá đơn thì đánh dấu đã xử lý.
UPDATE "admin_alerts" a SET "resolvedAt" = now(), "read" = true
WHERE a."type" = 'misa_invoice_failed' AND a."resolvedAt" IS NULL AND jsonb_typeof(a."data"->'recordIds') = 'array'
  AND EXISTS (
    SELECT 1 FROM "misa_invoices" m
    WHERE m."status" IN ('DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX')
      AND m."recordIds" && ARRAY(SELECT jsonb_array_elements_text(a."data"->'recordIds'))
  );
