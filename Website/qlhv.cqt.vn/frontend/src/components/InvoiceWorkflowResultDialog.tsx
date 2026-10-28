import { useEffect, useRef } from 'react'

export interface InvoiceWorkflowResult {
  key: string; studentName: string; className: string; month: number; year: number
  phase: 'queued' | 'processing' | 'complete' | 'request_failed'; recordId?: string; error?: string
  workflow?: { enabled?: boolean; status?: string; message?: string; refId?: string; transactionId?: string }
}
export function invoiceWorkflowLabel(result: InvoiceWorkflowResult) {
  if (result.phase === 'queued') return 'Phiếu đang chờ đến lượt xử lý.'
  if (result.phase === 'processing') return 'Đang lưu phiếu và chờ kết quả xử lý hóa đơn từ MISA…'
  if (result.phase === 'request_failed') return result.error || 'Không nhận được kết quả. Kiểm tra phiếu đã lưu trước khi thử lại.'
  const workflow = result.workflow
  if (!workflow) return 'Hệ thống chưa trả trạng thái hóa đơn. Chưa xác nhận đã tạo hóa đơn chưa phát hành trên MISA.'
  if (workflow.status === 'SKIPPED_BEFORE_INVOICE_START') return `Phiếu học phí đã lưu. ${workflow.message || 'Chỉ tạo hóa đơn cho kỳ học phí từ tháng 10/2026.'}`
  if (workflow.enabled === false) return 'Phiếu đã lưu. Tự động tạo hóa đơn MISA đang tắt.'
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
    FAILED: 'Phiếu học phí đã lưu. Chưa tạo được hóa đơn trên MISA.',
    SKIPPED_EXISTING_RECORD: 'Phiếu đã tồn tại và đã được xử lý trước đó. Chỉ cập nhật dữ liệu phiếu, không tạo lại hóa đơn nháp MISA.',
  }
  return [labels[workflow.status || ''] || `Phiếu đã lưu. Trạng thái hóa đơn: ${workflow.status || 'chưa xác định'}.`, workflow.message].filter(Boolean).join(' ')
}
type ResultTone = 'success' | 'error' | 'pending' | 'review'
function resultPresentation(result: InvoiceWorkflowResult): { tone: ResultTone; label: string; icon: string } {
  if (result.phase === 'queued') return { tone: 'pending', label: 'Chờ đến lượt', icon: 'schedule' }
  if (result.phase === 'processing') return { tone: 'pending', label: 'Đang xử lý', icon: 'progress_activity' }
  if (result.phase === 'request_failed') return { tone: 'review', label: 'Chưa nhận được kết quả', icon: 'help' }
  if (result.workflow?.status === 'SKIPPED_BEFORE_INVOICE_START') return { tone: 'success', label: 'Đã lưu phiếu, không tạo hóa đơn', icon: 'check_circle' }
  if (result.workflow?.enabled === false) return { tone: 'review', label: 'Đã lưu phiếu học phí', icon: 'info' }
  const status = result.workflow?.status || ''
  if (['DRAFT_CREATED', 'MISA_DRAFT_CREATED'].includes(status)) return { tone: 'success', label: 'Đã tạo hóa đơn chưa phát hành', icon: 'check_circle' }
  if (['ISSUED', 'SENT_TO_TAX'].includes(status)) return { tone: 'success', label: status === 'ISSUED' ? 'Hóa đơn đã phát hành' : 'Hóa đơn đã gửi CQT', icon: 'check_circle' }
  if (['FAILED', 'SYNC_FAILED'].includes(status)) return { tone: 'error', label: 'Tạo hóa đơn thất bại', icon: 'error' }
  if (['CREATING', 'CREATING_MISA', 'PENDING_MISA'].includes(status)) return { tone: 'pending', label: 'Đang chờ kết quả MISA', icon: 'schedule' }
  return { tone: 'review', label: 'Cần kiểm tra trạng thái', icon: 'info' }
}
const toneStyles: Record<ResultTone, { panel: string; badge: string; icon: string }> = {
  success: { panel: 'bg-emerald-50/70 border-emerald-100', badge: 'bg-emerald-100 text-emerald-800', icon: 'text-emerald-700' },
  error: { panel: 'bg-rose-50/70 border-rose-100', badge: 'bg-rose-100 text-rose-800', icon: 'text-rose-700' },
  pending: { panel: 'bg-blue-50/70 border-blue-100', badge: 'bg-blue-100 text-blue-800', icon: 'text-blue-700' },
  review: { panel: 'bg-amber-50/70 border-amber-100', badge: 'bg-amber-100 text-amber-900', icon: 'text-amber-700' },
}
export default function InvoiceWorkflowResultDialog({ results, onClose }: { results: InvoiceWorkflowResult[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const running = results.some(result => result.phase === 'processing' || result.phase === 'queued')
  const completed = results.filter(result => result.phase === 'complete' || result.phase === 'request_failed').length
  const count = (tone: ResultTone) => results.filter(result => resultPresentation(result).tone === tone).length
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; closeRef.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  return <div className="responsive-dialog fixed inset-0 z-[100] bg-slate-950/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6" onKeyDown={event => {
    if (event.key === 'Escape' && !running) onClose()
    if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus() }
  }}>
    <div role="dialog" aria-modal="true" aria-labelledby="invoice-workflow-title" aria-describedby="invoice-workflow-summary"
      className="flex flex-col bg-white rounded-2xl sm:rounded-3xl shadow-2xl ring-1 ring-black/5 w-full max-w-2xl max-h-[90dvh] overflow-hidden">
      <header className="px-5 pt-6 pb-5 sm:px-7 sm:pt-7 border-b border-slate-100">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <span aria-hidden="true" className="material-symbols-outlined text-[26px]">receipt_long</span>
          </div>
          <div className="min-w-0">
            <h2 id="invoice-workflow-title" className="text-xl sm:text-2xl font-bold font-headline text-on-surface leading-tight">{running ? 'Đang xử lý hóa đơn' : 'Kết quả tạo hóa đơn'}</h2>
            <p className="mt-1 text-sm text-slate-500">Hóa đơn điện tử MISA meInvoice</p>
          </div>
        </div>
        <div id="invoice-workflow-summary" className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm">
          <span className="font-medium text-slate-600">Đã nhận phản hồi {completed}/{results.length} phiếu</span>
          {count('success') > 0 && <span className="text-emerald-700 font-medium">{count('success')} thành công</span>}
          {count('error') > 0 && <span className="text-rose-700 font-medium">{count('error')} thất bại</span>}
          {count('review') > 0 && <span className="text-amber-800 font-medium">{count('review')} cần kiểm tra</span>}
        </div>
        {running && <div role="progressbar" aria-label="Tiến độ xử lý phiếu" aria-valuemin={0} aria-valuemax={results.length} aria-valuenow={completed} className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${results.length ? completed / results.length * 100 : 0}%` }} />
        </div>}
      </header>
      <div aria-live="polite" aria-relevant="additions text" className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7 space-y-4">
        {results.map(result => {
          const presentation = resultPresentation(result)
          const styles = toneStyles[presentation.tone]
          return <article key={result.key} className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-4 sm:px-5 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-base text-on-surface break-words">{result.studentName}</h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                  <span>{result.className}</span>
                  <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="material-symbols-outlined text-[16px]">calendar_month</span>Học phí tháng {result.month}/{result.year}</span>
                </div>
              </div>
              <span className={`rounded-md px-2.5 py-1 text-xs font-semibold leading-5 ${styles.badge}`}>{presentation.label}</span>
            </div>
            <div className={`mx-4 mb-4 sm:mx-5 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 ${styles.panel}`}>
              <span aria-hidden="true" className={`material-symbols-outlined shrink-0 mt-0.5 text-[20px] ${styles.icon} ${result.phase === 'processing' ? 'animate-spin motion-reduce:animate-none' : ''}`}>{presentation.icon}</span>
              <p className="text-sm leading-6 text-slate-700 break-words">{invoiceWorkflowLabel(result)}</p>
            </div>
            {(result.recordId || result.workflow?.refId || result.workflow?.transactionId) && <dl className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5 space-y-2 text-xs">
              {result.recordId && <div className="grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] gap-1 sm:gap-3"><dt className="text-slate-500">Mã phiếu</dt><dd className="text-slate-600 break-all select-all">{result.recordId}</dd></div>}
              {result.workflow?.refId && <div className="grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] gap-1 sm:gap-3"><dt className="text-slate-500">RefID</dt><dd className="text-slate-600 break-all select-all">{result.workflow.refId}</dd></div>}
              {result.workflow?.transactionId && result.workflow.transactionId !== result.workflow.refId && <div className="grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] gap-1 sm:gap-3"><dt className="text-slate-500">Mã xử lý MISA</dt><dd className="text-slate-600 break-all select-all">{result.workflow.transactionId}</dd></div>}
            </dl>}
          </article>
        })}
      </div>
      <footer className="border-t border-slate-100 px-5 py-4 sm:px-7 flex flex-wrap items-center justify-end gap-3 bg-slate-50/50">
        {running && <p className="mr-auto text-xs text-slate-500">Vui lòng chờ xử lý xong các phiếu.</p>}
        <button ref={closeRef} type="button" aria-disabled={running} onClick={() => { if (!running) onClose() }} className="min-w-[112px] bg-primary text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-primary-dim transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 aria-disabled:opacity-50 aria-disabled:cursor-wait">{running ? 'Đang xử lý…' : 'Đóng'}</button>
      </footer>
    </div>
  </div>
}
