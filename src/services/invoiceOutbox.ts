// Luồng hàng đợi meInvoice cũ đã ngừng: học phí và trang hóa đơn dùng misaAutoDraft.
// Cron /api/tuition/cron/process-invoices vẫn gọi hàm này và nhận { enabled: false } như trước —
// mục cũ trong bảng invoice_outbox không bao giờ được gửi lại.
export const invoiceAutomationEnabled = () => false

export async function processPendingInvoices() {
  return { enabled: false, processed: 0 }
}
