import InvoiceWorkflowResultDialog, { type InvoiceWorkflowResult } from '../components/InvoiceWorkflowResultDialog'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar'
import api from '../services/api'
import * as XLSX from 'xlsx'
import { buildInvoiceWorkbook } from '../lib/invoiceExport'
import { useAlert, useConfirm } from '../components/ConfirmDialog'

interface TuitionRecordSummary {
  id: string
  finalAmount: number
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'
  paidAmount: number
  remainingAmount: number
}

interface ScheduleRow {
  studentId: string
  studentName: string
  gradeLevel: number | null
  primaryParent: { fullName: string; phone: string | null; zalo: string | null } | null
  classId: string
  className: string
  totalSessions: number
  ratePerSession: number
  discountAmount: number
  baseAmount: number
  finalAmount: number
  tuitionRecord: TuitionRecordSummary | null
}

const IS_LOCAL =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')

function buildParentUrl(studentId: string) {
  return IS_LOCAL
    ? `http://localhost:5174/hoc-vien/index.html?id=${encodeURIComponent(studentId)}`
    : `https://hocthemtoan.vn/hoc-vien/${encodeURIComponent(studentId)}`
}

function buildZaloUrl(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const intl = digits.startsWith('0') ? '84' + digits.slice(1) : digits
  return `https://zalo.me/${intl}`
}

export default function Tuition() {
  const thisYear = new Date().getFullYear()
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const latestRequest = useRef(0)
  const [classFilter, setClassFilter] = useState<string | null>(null)
  const [gradeFilter, setGradeFilter] = useState<number | null>(null)

  const loadData = (force = false) => {
    const request = ++latestRequest.current
    setLoading(true)
    setLoadError(null)
    api.get(`/tuition/schedule-summary?month=${month}&year=${year}${force ? '&force=true' : ''}`)
      .then(r => { if (request === latestRequest.current) setRows(r.data) })
      .catch(() => { if (request === latestRequest.current) { setRows([]); setLoadError('Không tải được dữ liệu học phí.'); } })
      .finally(() => { if (request === latestRequest.current) setLoading(false) })
  }

  useEffect(() => {
    loadData()
  }, [month, year])

  // Bỏ classFilter nếu lớp không thuộc khối đang chọn
  useEffect(() => {
    if (gradeFilter != null && classFilter) {
      const stillValid = rows.some(r => r.className === classFilter && r.gradeLevel === gradeFilter)
      if (!stillValid) setClassFilter(null)
    }
  }, [gradeFilter, rows])

  // Danh sách khối lớp có trong dữ liệu
  const grades = Array.from(new Set(rows.map(r => r.gradeLevel).filter((g): g is number => g != null)))
    .sort((a, b) => a - b)

  // Danh sách lớp học có trong dữ liệu (lọc theo grade nếu đang chọn)
  const classes = Array.from(new Set(
    rows
      .filter(r => gradeFilter == null || r.gradeLevel === gradeFilter)
      .map(r => r.className)
      .filter(Boolean)
  )).sort((a, b) => {
    const na = Number(a.match(/\d+/)?.[0] ?? 999)
    const nb = Number(b.match(/\d+/)?.[0] ?? 999)
    return na - nb || a.localeCompare(b)
  })

  const filtered = rows.filter(r => {
    if (gradeFilter != null && r.gradeLevel !== gradeFilter) return false
    if (classFilter && r.className !== classFilter) return false
    return true
  })

  const totalAmount = filtered.reduce((s, r) => s + r.finalAmount, 0)
  const totalSessions = filtered.reduce((s, r) => s + r.totalSessions, 0)
  const uniqueStudents = new Set(filtered.map(r => r.studentId)).size
  const unpaidStudents = new Set(filtered
    .filter(r => (r.tuitionRecord ? r.tuitionRecord.remainingAmount : r.finalAmount) > 0)
    .map(r => r.studentId)).size

  const years = Array.from({ length: 4 }, (_, i) => thisYear - 1 + i)

  const [creatingRow, setCreatingRow] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sendingZnsId, setSendingZnsId] = useState<string | null>(null)

  // Toggles local state
  const [pendingToggles, setPendingToggles] = useState<Record<string, boolean>>({})
  const [isSavingToggles, setIsSavingToggles] = useState(false)

  const showAlert = useAlert()
  const showConfirm = useConfirm()

  // pendingToggleData stores {paid, tuitionRecordId} per key
  const [pendingToggleData, setPendingToggleData] = useState<Record<string, { paid: boolean; tuitionRecordId?: string }>>({})

  const handleTogglePaid = (row: ScheduleRow, currentPaid: boolean) => {
    const key = `${row.studentId}___${row.classId}`
    setPendingToggles(prev => {
      const next = { ...prev }
      if (next[key] !== undefined) {
        delete next[key]
      } else {
        next[key] = !currentPaid
      }
      return next
    })
    setPendingToggleData(prev => {
      const next = { ...prev }
      if (next[key]) {
        delete next[key]
      } else {
        next[key] = { paid: !currentPaid, tuitionRecordId: row.tuitionRecord?.id }
      }
      return next
    })
  }

  const [invoiceResults, setInvoiceResults] = useState<InvoiceWorkflowResult[] | null>(null)
  const pendingResult = (row: ScheduleRow, key: string): InvoiceWorkflowResult => ({
    key, studentName: row.studentName, className: row.className, month, year, phase: 'processing',
  })
  const updateInvoiceResult = (key: string, patch: Partial<InvoiceWorkflowResult>) => {
    setInvoiceResults(previous => previous?.map(item => item.key === key ? { ...item, ...patch } : item) ?? null)
  }
  const responseWorkflow = (data: any): InvoiceWorkflowResult['workflow'] => data.invoiceWorkflow ?? data.invoiceDraft
  const requestError = (error: any) => error?.response?.data?.message || 'Không nhận được phản hồi. Phiếu có thể đã lưu; kiểm tra trước khi thử lại.'

  const handleSaveToggles = async () => {
    const keys = Object.keys(pendingToggles)
    if (keys.length === 0) return
    setIsSavingToggles(true)
    setInvoiceResults(keys.map(key => {
      const [studentId, classId] = key.split('___')
      const row = rows.find(item => item.studentId === studentId && item.classId === classId)
      return row ? pendingResult(row, key) : { key, studentName: 'Học viên', className: classId, month, year, phase: 'processing' }
    }))
    try {
      const settled = await Promise.allSettled(keys.map(async key => {
        const [studentId, classId] = key.split('___')
        try {
          const { data } = await api.post('/tuition/toggle-paid', {
            studentId, classId, month, year, paid: pendingToggles[key],
            tuitionRecordId: pendingToggleData[key]?.tuitionRecordId || undefined,
          })
          updateInvoiceResult(key, { phase: 'complete', recordId: data.recordId, workflow: responseWorkflow(data) })
          return { key, recordId: data.recordId }
        } catch (error) {
          updateInvoiceResult(key, { phase: 'request_failed', error: requestError(error) })
          throw error
        }
      }))
      const completed = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      setRows(previous => previous.map(row => {
        const key = `${row.studentId}___${row.classId}`
        const result = completed.find(item => item.key === key)
        if (!result) return row
        const paid = pendingToggles[key]
        return { ...row, tuitionRecord: { id: result.recordId || row.tuitionRecord?.id || '',
          finalAmount: row.finalAmount, status: paid ? 'PAID' : 'PENDING',
          paidAmount: paid ? row.finalAmount : 0, remainingAmount: paid ? 0 : row.finalAmount } }
      }))
      // Preserve failed rows for review; do not replay successful payment requests.
      const successful = new Set(completed.map(item => item.key))
      setPendingToggles(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !successful.has(key))))
      setPendingToggleData(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !successful.has(key))))
    } finally {
      setIsSavingToggles(false)
      setTimeout(() => { loadData() }, 1500)
    }
  }

  const handleCancelToggles = () => {
    setPendingToggles({})
    setPendingToggleData({})
  }

  const copyShareLink = async (studentId: string) => {
    const url = buildParentUrl(studentId)
    window.open(url, '_blank', 'noopener,noreferrer')
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(studentId)
      setTimeout(() => setCopiedId(prev => prev === studentId ? null : prev), 1500)
    } catch {
      await showAlert({
        title: 'Không sao chép được',
        message: `Trình duyệt chặn clipboard. Hãy copy thủ công:\n${url}`,
      })
    }
  }

  const sendZnsNotice = async (recordId: string, studentName: string) => {
    const ok = await showConfirm({
      title: 'Gửi thông báo Zalo',
      message: `Gửi thông báo học phí (ZNS) cho phụ huynh học viên ${studentName}?`,
      confirmLabel: 'Gửi',
    })
    if (!ok) return

    setSendingZnsId(recordId)
    try {
      const r = await api.post('/zns/tuition-notice', { tuitionRecordId: recordId, useCase: 'A' })
      const data = r.data as { success: boolean; error?: string; recipientSource?: string; recipientName?: string }
      if (data.success) {
        const fallbackNote = data.recipientSource === 'fallback'
          ? `\n(Đã dùng SĐT của ${data.recipientName ?? 'phụ huynh phụ'} vì PH chính chưa có SĐT)`
          : ''
        await showAlert({ title: '✅ Đã gửi', message: `Thông báo đã gửi thành công.${fallbackNote}` })
      } else {
        await showAlert({ title: 'Gửi thất bại', message: data.error || 'Không xác định' })
      }
    } catch (e: any) {
      await showAlert({
        title: 'Lỗi',
        message: e?.response?.data?.message || 'Không gọi được API gửi ZNS',
      })
    } finally {
      setSendingZnsId(null)
    }
  }

  const createRecordForRow = async (row: ScheduleRow) => {
    const isRecalc = !!row.tuitionRecord
    if (isRecalc) {
      const ok = await showConfirm({
        title: 'Tính lại phiếu',
        message:
          `Tính lại phiếu cho ${row.studentName} - ${row.className} T${month}/${year}?\n\n` +
          `Số tiền sẽ cập nhật theo lịch hiện tại. Các giao dịch đã thanh toán được giữ nguyên.`,
        confirmLabel: 'Tính lại',
      })
      if (!ok) return
    }
    const key = `${row.studentId}-${row.classId}`
    setCreatingRow(key)
    setInvoiceResults([pendingResult(row, key)])
    try {
      const { data } = await api.post('/tuition/calculate', {
        studentId: row.studentId, classId: row.classId, month, year,
      })
      updateInvoiceResult(key, { phase: 'complete', recordId: data.id, workflow: responseWorkflow(data) })
      loadData()
    } catch (e: any) {
      updateInvoiceResult(key, { phase: 'request_failed', error: requestError(e) })
    } finally {
      setCreatingRow(null)
    }
  }

  const exportExcel = () => {
    const wb = buildInvoiceWorkbook(filtered)
    const suffix = [
      gradeFilter != null ? `khoi${gradeFilter}` : '',
      classFilter ? classFilter.replace(/\s+/g, '_') : '',
    ].filter(Boolean).join('-')
    XLSX.writeFile(wb, `hoa-don-thang-${month}-${year}${suffix ? `-${suffix}` : ''}.xlsx`)
  }

  return (
    <div>
      {invoiceResults && <InvoiceWorkflowResultDialog results={invoiceResults} onClose={() => setInvoiceResults(null)} />}
      <TopBar title="Quản lý Học phí" />
      <div className="px-8 py-8 space-y-8">

        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Tài chính</span>
            <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Quản lý Học phí</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => loadData(true)} disabled={loading}
              className="px-4 py-2 rounded-xl bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 disabled:opacity-40">
              Tải lại dữ liệu
            </button>
            <button
              onClick={exportExcel}
              disabled={filtered.length === 0}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 rounded-xl bg-secondary/10 text-secondary text-sm font-semibold hover:bg-secondary/20 transition-all disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Xuất Excel
            </button>
            <select value={month} onChange={e => setMonth(Number(e.target.value))}
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>
              ))}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-8">
        {loadError && <div role="alert" className="text-red-700">{loadError} <button className="underline" onClick={() => loadData(true)}>Thử lại</button></div>}
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <p className="text-sm text-outline font-medium">Tổng phải thu</p>
            <p className="text-3xl font-black text-on-surface mt-2">{(totalAmount / 1_000_000).toFixed(1)}M đ</p>
          </div>
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <p className="text-sm text-outline font-medium">Học viên</p>
            <p className="text-3xl font-black text-primary mt-2">{uniqueStudents}</p>
          </div>
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-red-200">
            <p className="text-sm text-outline font-medium">Chưa thanh toán</p>
            <p className="text-3xl font-black text-red-700 mt-2">{loading || loadError ? '—' : unpaidStudents}</p>
            <p className="text-xs text-outline mt-2">Học viên còn nợ hoặc chưa có phiếu học phí</p>
          </div>
        </div>

        {/* Filter cards */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4">
          {/* Grade filter card */}
          <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-primary text-[18px]">school</span>
              <span className="text-xs font-bold text-outline uppercase tracking-wider">Lọc theo Khối lớp</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setGradeFilter(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  gradeFilter === null
                    ? 'bg-primary text-on-primary border-primary shadow-sm'
                    : 'bg-surface-container-low text-outline border-outline-variant/20 hover:border-primary/40 hover:text-primary'
                }`}
              >
                Tất cả
              </button>
              {grades.map(g => (
                <button
                  key={g}
                  onClick={() => setGradeFilter(g === gradeFilter ? null : g)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    gradeFilter === g
                      ? 'bg-primary text-on-primary border-primary shadow-sm'
                      : 'bg-surface-container-low text-outline border-outline-variant/20 hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  Lớp {g}
                </button>
              ))}
            </div>
          </div>

          {/* Class filter card */}
          <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-secondary text-[18px]">class</span>
              <span className="text-xs font-bold text-outline uppercase tracking-wider">Lọc theo Lớp học</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setClassFilter(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  classFilter === null
                    ? 'bg-secondary text-on-secondary border-secondary shadow-sm'
                    : 'bg-surface-container-low text-outline border-outline-variant/20 hover:border-secondary/40 hover:text-secondary'
                }`}
              >
                Tất cả
              </button>
              {classes.map(c => (
                <button
                  key={c}
                  onClick={() => setClassFilter(c === classFilter ? null : c)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    classFilter === c
                      ? 'bg-secondary text-on-secondary border-secondary shadow-sm'
                      : 'bg-surface-container-low text-outline border-outline-variant/20 hover:border-secondary/40 hover:text-secondary'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-200/80">
          <div className="px-5 sm:px-6 py-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="tuition-table-title" className="text-base font-semibold text-on-surface">Danh sách học phí</h3>
              <p className="mt-1 text-xs text-slate-500">Kỳ học phí {String(month).padStart(2, '0')}/{year}</p>
            </div>
            <p className="text-xs text-slate-500"><span className="font-semibold text-slate-700">{uniqueStudents}</span> học viên <span className="mx-2 text-slate-300">·</span><span className="font-semibold text-slate-700">{filtered.length}</span> khoản học phí</p>
          </div>
          {loading ? (
            <div role="status" className="py-16 text-center text-slate-500">
              <span className="material-symbols-outlined text-5xl block mb-3 opacity-30 animate-pulse">sync</span>
              Đang tải...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table aria-labelledby="tuition-table-title" className="w-full min-w-[1020px] table-fixed text-left border-collapse text-sm text-slate-700">
                <colgroup><col style={{ width: '4%' }} /><col style={{ width: '18%' }} /><col style={{ width: '15%' }} /><col style={{ width: '14%' }} /><col style={{ width: '16%' }} /><col style={{ width: '11%' }} /><col style={{ width: '12%' }} /><col style={{ width: '10%' }} /></colgroup>
                <thead className="bg-slate-50/80 border-b border-slate-200/70">
                  <tr>
                    {['STT', 'Học viên', 'Lớp học', 'Buổi học / Đơn giá', 'Thành tiền', 'Phiếu học phí', 'Thanh toán', 'Thao tác'].map((label, index) => <th key={label} scope="col" className={`py-3.5 text-xs font-semibold text-slate-500 whitespace-nowrap ${index === 0 || index >= 5 ? 'px-3' : 'px-4'} ${index === 3 || index === 4 ? 'text-right' : index >= 5 ? 'text-center' : 'text-left'}`}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Tính rowspan cho mỗi student
                    const spanMap: Record<string, number> = {}
                    filtered.forEach(r => { spanMap[r.studentId] = (spanMap[r.studentId] || 0) + 1 })
                    const seen = new Set<string>()
                    let sttCounter = 0

                    return filtered.map((r) => {
                      const isFirst = !seen.has(r.studentId)
                      if (isFirst) { seen.add(r.studentId); sttCounter++ }
                      const span = spanMap[r.studentId]

                      return (
                        <tr key={`${r.studentId}-${r.classId}`} className={`hover:bg-slate-50/70 transition-colors ${isFirst && sttCounter > 1 ? 'border-t border-slate-200/80' : !isFirst ? 'border-t border-dashed border-slate-100' : ''}`}>
                          {isFirst && <td className="px-3 py-5 text-xs text-slate-400 align-top tabular-nums" rowSpan={span}>{sttCounter}</td>}
                          {isFirst && <td className="px-4 py-5 align-top" rowSpan={span}>
                            <p className="font-semibold text-on-surface text-[15px] leading-5 break-words">{r.studentName}</p>
                            <p className="mt-1.5 text-xs text-slate-500">{r.gradeLevel != null ? `Khối ${r.gradeLevel}` : 'Chưa có khối lớp'}</p>
                          </td>}
                          <td className="px-4 py-5 align-middle text-sm text-slate-600 leading-5 break-words">{r.className}</td>
                          <td className="px-4 py-5 align-middle text-right tabular-nums">
                            <p className="font-medium text-slate-700 whitespace-nowrap">{r.totalSessions} <span className="text-xs font-normal text-slate-500">buổi</span></p>
                            <p className="mt-1.5 text-xs text-slate-500 whitespace-nowrap">{r.ratePerSession > 0 ? `${r.ratePerSession.toLocaleString('vi-VN')}đ / buổi` : '—'}</p>
                          </td>
                          <td className="px-4 py-5 align-middle text-right tabular-nums">
                            <p className="font-semibold text-on-surface whitespace-nowrap">{r.finalAmount.toLocaleString('vi-VN')}đ</p>
                            {r.discountAmount > 0 && <p className="mt-1.5 text-xs text-emerald-700 whitespace-nowrap" title="Khuyến mãi đã áp dụng">Giảm {r.discountAmount.toLocaleString('vi-VN')}đ</p>}
                          </td>
                          <td className="px-3 py-5 align-middle text-center">
                            {r.tuitionRecord ? (
                              <div className="inline-flex items-center gap-1 whitespace-nowrap">
                                <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold whitespace-nowrap">Đã tạo</span>
                                <button
                                  onClick={() => sendZnsNotice(r.tuitionRecord!.id, r.studentName)}
                                  disabled={sendingZnsId === r.tuitionRecord.id}
                                  className="p-1 text-primary hover:bg-blue-50 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors disabled:opacity-40"
                                  title="Gửi thông báo Zalo cho phụ huynh"
                                  aria-label={`Gửi thông báo Zalo cho phụ huynh ${r.studentName} (${r.className})`}
                                >
                                  <span className="material-symbols-outlined text-[18px]">
                                    {sendingZnsId === r.tuitionRecord.id ? 'hourglass_top' : 'campaign'}
                                  </span>
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => createRecordForRow(r)}
                                disabled={creatingRow === `${r.studentId}-${r.classId}`}
                                className="px-2.5 py-2 rounded-lg border border-blue-100 bg-blue-50/60 text-primary text-xs font-semibold whitespace-nowrap hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors disabled:opacity-40"
                              >
                                {creatingRow === `${r.studentId}-${r.classId}` ? 'Đang tạo…' : 'Tạo phiếu'}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-5 align-middle text-center text-xs">
                            {(() => {
                              const isOriginalPaid = !!(
                                r.tuitionRecord &&
                                (r.tuitionRecord.status === 'PAID' || r.tuitionRecord.remainingAmount === 0)
                              )
                              const key = `${r.studentId}___${r.classId}`
                              const isPaid = pendingToggles[key] !== undefined ? pendingToggles[key] : isOriginalPaid
                              const isChanged = pendingToggles[key] !== undefined

                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleTogglePaid(r, isOriginalPaid)
                                  }}
                                  aria-label={`Thanh toán học phí ${r.studentName} (${r.className})`}
                                  aria-pressed={isPaid}
                                  title={isChanged ? 'Thay đổi thanh toán chưa lưu' : 'Thay đổi trạng thái thanh toán'}
                                  className={`inline-flex items-center gap-1.5 rounded-lg px-1 py-1.5 cursor-pointer select-none group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors whitespace-nowrap ${isChanged ? 'bg-amber-50 ring-1 ring-amber-200' : ''}`}
                                >
                                  <div className={`w-4 h-4 rounded flex items-center justify-center transition-all ${
                                    isPaid
                                      ? (isChanged ? 'bg-primary border border-primary text-on-primary' : 'bg-emerald-600 border border-emerald-600 text-white')
                                      : 'border border-slate-300 bg-white group-hover:border-primary'
                                  }`}>
                                    {isPaid && (
                                      <span className="material-symbols-outlined text-[13px] font-black leading-none">check</span>
                                    )}
                                  </div>
                                  <span className={`text-xs font-bold transition-colors ${
                                    isPaid ? (isChanged ? 'text-primary' : 'text-emerald-600') : 'text-slate-500 group-hover:text-on-surface'
                                  }`}>
                                    {isPaid ? 'Đã đóng' : 'Chưa đóng'}
                                  </span>
                                </button>
                              )
                            })()}
                          </td>
                          {isFirst && (
                            <td className="px-2 py-5 text-center align-top" rowSpan={span}>
                              <div className="inline-flex items-center justify-center gap-1">
                                <Link
                                  to={`/students/${r.studentId}`}
                                  className="p-1.5 text-slate-400 hover:text-primary hover:bg-blue-50 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
                                  title={`Xem hồ sơ học viên ${r.studentName}`}
                                  aria-label={`Xem hồ sơ học viên ${r.studentName}`}
                                >
                                  <span className="material-symbols-outlined text-[18px]">visibility</span>
                                </Link>
                                <button
                                  onClick={() => copyShareLink(r.studentId)}
                                  className={`p-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors ${copiedId === r.studentId
                                    ? 'text-secondary bg-secondary-container/15'
                                    : 'text-slate-400 hover:text-primary hover:bg-blue-50'}`}
                                  title={copiedId === r.studentId ? 'Đã sao chép link' : 'Sao chép link chia sẻ phụ huynh'}
                                  aria-label={`Chia sẻ học phí ${r.studentName} với phụ huynh`}
                                >
                                  <span className="material-symbols-outlined text-[18px]">
                                    {copiedId === r.studentId ? 'check' : 'share'}
                                  </span>
                                </button>
                                {(() => {
                                  const phone = r.primaryParent?.zalo || r.primaryParent?.phone
                                  const zaloUrl = buildZaloUrl(phone)
                                  return zaloUrl ? (
                                    <a
                                      href={zaloUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-1.5 text-slate-400 hover:text-primary hover:bg-blue-50 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
                                      title={`Nhắn tin Zalo cho ${phone}`}
                                      aria-label={`Nhắn tin Zalo cho phụ huynh ${r.studentName}`}
                                    >
                                      <span className="material-symbols-outlined text-[18px]">chat</span>
                                    </a>
                                  ) : null
                                })()}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })
                  })()}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-outline">
                        <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">payments</span>
                        {classFilter || gradeFilter != null
                          ? `Không có dữ liệu cho bộ lọc đang chọn`
                          : `Không có dữ liệu học phí tháng ${month}/${year}`}
                      </td>
                    </tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-slate-50/80 border-t border-slate-200">
                    <tr>
                      <td colSpan={3} className="px-4 py-5 font-semibold text-on-surface">Tổng cộng <span className="ml-2 text-xs font-normal text-slate-500">{uniqueStudents} học viên</span></td>
                      <td className="px-4 py-5 text-right tabular-nums font-semibold whitespace-nowrap">{totalSessions} <span className="text-xs font-normal text-slate-500">buổi</span></td>
                      <td className="px-4 py-5 text-right tabular-nums">
                        <p className="font-bold text-primary whitespace-nowrap">{totalAmount.toLocaleString('vi-VN')}đ</p>
                        {filtered.reduce((s, r) => s + r.discountAmount, 0) > 0 && <p className="mt-1.5 text-xs text-emerald-700 whitespace-nowrap">Giảm {filtered.reduce((s, r) => s + r.discountAmount, 0).toLocaleString('vi-VN')}đ</p>}
                      </td>
                      <td className="px-3 py-5 text-center text-xs text-slate-500">{filtered.filter(r => r.tuitionRecord).length}/{filtered.length} phiếu</td>
                      <td className="px-3 py-5 text-center text-xs font-semibold text-emerald-700">{filtered.filter(r => r.tuitionRecord && (r.tuitionRecord.status === 'PAID' || r.tuitionRecord.remainingAmount === 0)).length}/{filtered.length} đã đóng</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        </div>
      </div>
      {Object.keys(pendingToggles).length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-surface-container-highest shadow-xl border border-outline-variant/30 px-6 py-4 rounded-2xl z-50 flex items-center gap-6 animate-in slide-in-from-bottom-5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">info</span>
            <span className="text-sm font-semibold text-on-surface">
              Đang có {Object.keys(pendingToggles).length} thay đổi chưa lưu
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancelToggles}
              disabled={isSavingToggles}
              className="px-4 py-2 text-sm font-semibold text-secondary hover:bg-secondary/10 rounded-xl transition-colors disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              onClick={handleSaveToggles}
              disabled={isSavingToggles}
              className="px-4 py-2 text-sm font-semibold bg-primary text-on-primary hover:bg-primary/90 rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isSavingToggles ? (
                <>
                  <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                  Đang lưu...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">save</span>
                  Áp dụng thay đổi
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
