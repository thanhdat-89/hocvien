import { useEffect, useRef } from 'react'

export interface InvoiceWorkflowResult {
  key: string; studentName: string; className: string; month: number; year: number
  phase: 'processing' | 'complete' | 'request_failed'; recordId?: string; error?: string
  workflow?: { enabled?: boolean; status?: string; message?: string; refId?: string; transactionId?: string }
}
export function invoiceWorkflowLabel(result: InvoiceWorkflowResult) {
  if (result.phase === 'processing') return 'Đang lưu phiếu và chờ kết quả xử lý hóa đơn từ backend…'
  if (result.phase === 'request_failed') return result.error || 'Không nhận được kết quả. Kiểm tra phiếu đã lưu trước khi thử lại.'
  const workflow = result.workflow
  if (!workflow) return 'Backend chưa trả trạng thái hóa đơn. Chưa xác nhận đã tạo hóa đơn chưa phát hành trên MISA.'
  if (workflow.enabled === false) return 'Phiếu đã lưu. Backend đang tắt tự động xử lý MISA.'
  const labels: Record<string, string> = {
    MISA_XML_PREPARED: 'MISA đã trả kết quả chuẩn bị XML chưa ký. Chưa xác nhận hóa đơn đã được lưu trong danh sách Chưa phát hành.',
    MISA_DRAFT_CREATED: 'MISA đã tạo hóa đơn ở trạng thái Chưa phát hành.',
    DRAFT_CREATED: 'MISA đã trả xác nhận tạo hóa đơn chưa phát hành.',
    CREATING: 'Phiếu đã lưu. Đang xác minh yêu cầu MISA; dùng Cập nhật trạng thái để đối chiếu.',
    ISSUED: 'Phiếu này đã có hóa đơn được phát hành trên MISA.',
    SENT_TO_TAX: 'Phiếu này đã có hóa đơn gửi CQT.',
    REMOVED_FROM_MISA: 'Hóa đơn liên kết đã bị xóa trên MISA.',
    CREATING_MISA: 'Phiếu đã lưu. MISA đang được xử lý; chưa có kết quả cuối cùng.',
    PENDING_MISA: 'Phiếu đã lưu. Hóa đơn đang chờ xử lý.',
    LOCAL_DRAFT: 'Phiếu và bản nháp đã lưu trên website; chưa có kết quả MISA.',
    SYNC_FAILED: 'Phiếu đã lưu. Xử lý MISA thất bại; đang chờ thử lại theo lịch.',
    OUTCOME_UNKNOWN: 'Phiếu đã lưu. Kết quả MISA chưa rõ; cần đối chiếu RefID trước khi gửi lại.',
    NEEDS_REVIEW: 'Phiếu đã lưu. Cần kiểm tra dữ liệu hoặc cấu hình MISA.',
    FAILED: 'Phiếu đã lưu. Backend báo tạo hóa đơn thất bại.',
    SKIPPED_EXISTING_RECORD: 'Phiếu đã tồn tại và đã được xử lý trước đó. Chỉ cập nhật dữ liệu phiếu, không tạo lại hóa đơn nháp MISA.',
  }
  return [labels[workflow.status || ''] || `Phiếu đã lưu. Trạng thái hóa đơn: ${workflow.status || 'chưa xác định'}.`, workflow.message].filter(Boolean).join(' ')
}
export default function InvoiceWorkflowResultDialog({ results, onClose }: { results: InvoiceWorkflowResult[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const running = results.some(result => result.phase === 'processing')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; closeRef.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onKeyDown={event => {
    if (event.key === 'Escape' && !running) onClose()
    if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus() }
  }}>
    <div role="dialog" aria-modal="true" aria-labelledby="invoice-workflow-title" className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
      <h2 id="invoice-workflow-title" className="text-xl font-bold text-on-surface">{running ? 'Đang xử lý hóa đơn MISA meInvoice' : 'Kết quả xử lý hóa đơn MISA meInvoice'}</h2>
      <p className="text-sm text-outline">{results.filter(result => result.phase !== 'processing').length}/{results.length} phiếu đã nhận phản hồi.</p>
      <div aria-live="polite" className="space-y-3">{results.map(result => <div key={result.key} className="border border-outline-variant rounded-xl p-4 text-sm space-y-2">
        <p className="font-semibold">{result.studentName} · {result.className} · học phí tháng {result.month}/{result.year}</p>
        <p>{invoiceWorkflowLabel(result)}</p>
        {result.recordId && <p className="text-xs text-outline break-all">Mã phiếu: {result.recordId}</p>}
        {result.workflow?.refId && <p className="text-xs text-outline break-all">RefID: {result.workflow.refId}</p>}
        {result.workflow?.transactionId && <p className="text-xs text-outline break-all">Mã xử lý MISA: {result.workflow.transactionId}</p>}
      </div>)}</div>
      <button ref={closeRef} type="button" aria-disabled={running} onClick={() => { if (!running) onClose() }} className="bg-primary text-on-primary rounded-lg px-5 py-2 font-semibold aria-disabled:opacity-50">{running ? 'Đang chờ kết quả…' : 'Đóng'}</button>
    </div>
  </div>
}
