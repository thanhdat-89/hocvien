-- Đếm số lần tự tạo lại hoá đơn MISA sau lỗi tạm thời (cron mỗi 15 phút, tối đa 5 lần).
ALTER TABLE "misa_invoices" ADD COLUMN "autoRetryCount" INTEGER NOT NULL DEFAULT 0;
