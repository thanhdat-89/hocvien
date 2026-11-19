import { useEffect, useRef, useState } from 'react'
import api from '../services/api'
import { useConfirm } from './ConfirmDialog'
import { downloadPrivateScheduleTemplate, LegacyTemplateError, PrivateImportRow, readPrivateScheduleFile, TemplateSuggestions } from '../lib/privateScheduleExcel'

interface Issue { level: 'error' | 'warning'; code: string; message: string }
interface Candidate { id: string; fullName: string; gradeLevel: number | null; activeClasses: string[] }
interface RowResult {
  row: number
  status: 'ok' | 'warning' | 'error'
  studentId: string | null
  studentName: string
  gradeLevel: number | null
  candidates?: Candidate[]
  activeClasses?: string[]
  dates: string[]
  holidayDates: string[]
  absentDates: string[]
  duplicateDates: string[]
  issues: Issue[]
}
interface ImportResult {
  dryRun: boolean
  summary: { total: number; valid: number; errors: number; sessions: number }
  rows: RowResult[]
  created: number
  deleted: number
}

const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const fmtMonth = (m: string) => `${Number(m.slice(5))}/${m.slice(0, 4)}`
const dayList = (dates: string[]) => dates.map(d => Number(d.slice(8))).join(', ')
const fmtMoney = (v: number | string) => (typeof v === 'number' ? v.toLocaleString('vi-VN') + 'đ' : v || '—')

export default function PrivateScheduleImportModal({ month, missingStudents, onClose, onImported }: {
  month: string // YYYY-MM — tháng gợi ý cho file mẫu
  missingStudents: { id: string; fullName: string; gradeLevel?: number | null }[]
  onClose: () => void
  onImported: () => void
}) {
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<PrivateImportRow[]>([])
  const [picks, setPicks] = useState<Record<number, string>>({}) // dòng → studentId khi trùng tên
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const previewSeq = useRef(0)
  const [downloading, setDownloading] = useState(false)

  const downloadTemplate = async () => {
    setDownloading(true)
    let suggestions: TemplateSuggestions = {}
    try {
      if (missingStudents.length) {
        const r = await api.get('/students/private-schedule/suggestions', { params: { ids: missingStudents.map(s => s.id).join(',') } })
        suggestions = r.data ?? {}
      }
    } catch { /* không có gợi ý thì vẫn tải file mẫu trống */ }
    try { downloadPrivateScheduleTemplate(missingStudents, month, suggestions) } finally { setDownloading(false) }
  }

  const payload = () => ({
    rows: rows.map(r => ({ ...r, studentId: picks[r.row] || undefined })),
    replaceExisting, confirmedStudentIds: [...confirmed],
  })

  // Xem trước lại mỗi khi dữ liệu hoặc tuỳ chọn đổi
  useEffect(() => {
    if (!rows.length) { setPreview(null); return }
    const seq = ++previewSeq.current
    setBusy(true); setError('')
    api.post('/students/private-schedule/import/preview', payload())
      .then(r => { if (seq === previewSeq.current) setPreview(r.data) })
      .catch(err => { if (seq === previewSeq.current) setError(err.response?.data?.message ?? 'Không kiểm tra được file.') })
      .finally(() => { if (seq === previewSeq.current) setBusy(false) })
  }, [rows, picks, confirmed, replaceExisting])

  const handleFile = async (file: File) => {
    setError(''); setResult(null); setPicks({}); setConfirmed(new Set()); setReplaceExisting(false)
    try {
      const parsed = await readPrivateScheduleFile(file)
      if (!parsed.length) { setError('Không tìm thấy dòng dữ liệu. Kiểm tra file có cột "Họ tên học viên" như file mẫu.'); return }
      setRows(parsed); setFileName(file.name)
    } catch (err) {
      setError(err instanceof LegacyTemplateError ? err.message : 'Không đọc được file. Vui lòng dùng file .xlsx hoặc .xls')
    }
  }

  const reset = () => { setRows([]); setFileName(''); setPreview(null); setResult(null); setError('') }

  const handleImport = async () => {
    if (!preview?.summary.valid) return
    const parts = [`Tạo ${preview.summary.sessions} buổi học riêng cho ${preview.summary.valid} dòng hợp lệ.`]
    if (preview.summary.errors) parts.push(`${preview.summary.errors} dòng lỗi sẽ bị bỏ qua.`)
    const replacing = preview.rows.filter(r => r.status !== 'error' && r.duplicateDates.length)
    if (replacing.length) parts.push(`Các buổi học riêng đã xếp trước đó của ${replacing.length} dòng trong các tháng import sẽ bị XOÁ rồi xếp lại.`)
    const ok = await confirm({ title: 'Import lịch học riêng', message: parts.join(' '), confirmLabel: 'Import', danger: replacing.length > 0 })
    if (!ok) return
    setBusy(true); setError('')
    try {
      const r = await api.post('/students/private-schedule/import', payload())
      setResult(r.data)
      onImported()
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra khi import.')
    } finally { setBusy(false) }
  }

  const byRow = new Map(preview?.rows.map(r => [r.row, r]) ?? [])
  const hasDuplicate = preview?.rows.some(r => r.duplicateDates.length > 0) ?? false
  const visible = rows.filter(r => !onlyProblems || (byRow.get(r.row)?.status ?? 'ok') !== 'ok')

  const toggleConfirmed = (id: string) => setConfirmed(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })

  return (
    <div className="responsive-dialog fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="private-import-title"
        className="relative w-full max-w-6xl bg-surface-container-lowest rounded-2xl shadow-2xl z-10 flex flex-col max-h-[92vh]">

        <div className="p-6 border-b border-outline-variant/10 flex items-center justify-between gap-3">
          <div>
            <h3 id="private-import-title" className="text-lg font-headline font-bold text-on-surface">Import lịch học riêng từ Excel</h3>
            <p className="text-sm text-outline mt-0.5">Mỗi dòng: học viên + khối, các thứ học, tháng, năm, ngày nghỉ, học phí/buổi. Ngày nghỉ của học viên và ngày nghỉ lễ được tự bỏ qua.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void downloadTemplate()} disabled={downloading}
              title={missingStudents.length ? `File mẫu điền sẵn ${missingStudents.length} học viên chưa có lịch tháng ${fmtMonth(month)}` : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary bg-primary/8 hover:bg-primary/15 rounded-lg transition-all">
              <span className={`material-symbols-outlined text-[15px] ${downloading ? 'animate-spin' : ''}`}>{downloading ? 'progress_activity' : 'download'}</span>
              Tải file mẫu
            </button>
            <button onClick={onClose} aria-label="Đóng" className="p-1.5 hover:bg-surface-container-low rounded-lg">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && <div role="alert" className="p-3 rounded-xl bg-error-container/20 text-error text-sm">{error}</div>}

          {!rows.length && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void handleFile(f) }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                dragOver ? 'border-primary bg-primary/5' : 'border-outline-variant/30 hover:border-primary/40 hover:bg-surface-container-low'}`}
            >
              <span className="material-symbols-outlined text-5xl text-outline/40 block mb-3">upload_file</span>
              <p className="text-sm font-semibold text-on-surface-variant">Kéo thả file vào đây hoặc click để chọn</p>
              <p className="text-xs text-outline mt-1">Hỗ trợ .xlsx, .xls. File mẫu điền sẵn các học viên chưa có lịch tháng {fmtMonth(month)}.</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleFile(f) }} />
            </div>
          )}

          {rows.length > 0 && result && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary-container/20">
                <span className="material-symbols-outlined text-2xl text-secondary">check_circle</span>
                <div>
                  <p className="text-sm font-bold text-on-surface">Đã tạo <span className="text-secondary">{result.created}</span> buổi học riêng</p>
                  <p className="text-xs text-outline mt-0.5">
                    {result.summary.valid} dòng hợp lệ{result.deleted ? ` · đã xoá ${result.deleted} buổi cũ` : ''}
                    {result.summary.errors ? ` · ${result.summary.errors} dòng lỗi bị bỏ qua` : ''}
                  </p>
                </div>
              </div>
              {result.rows.some(r => r.status === 'error') && (
                <div className="rounded-xl border border-error/20 overflow-hidden">
                  <p className="text-[10px] font-bold text-error uppercase tracking-wider px-4 py-2 bg-error/5">Dòng chưa import</p>
                  {result.rows.filter(r => r.status === 'error').map(r => (
                    <div key={r.row} className="px-4 py-2 text-sm border-t border-error/10 flex flex-wrap gap-x-3">
                      <span className="text-outline">Dòng {r.row}</span>
                      <span className="font-medium text-on-surface">{r.studentName || '—'}</span>
                      <span className="text-error">{r.issues.filter(i => i.level === 'error').map(i => i.message).join(' ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {rows.length > 0 && !result && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-on-surface">
                  <span className="font-bold">{rows.length}</span> dòng từ <span className="text-outline">{fileName}</span>
                  {preview && <>
                    {' · '}<span className="font-bold text-secondary">{preview.summary.valid} hợp lệ</span>
                    {preview.summary.errors > 0 && <>{' · '}<span className="font-bold text-error">{preview.summary.errors} lỗi</span></>}
                    {' · '}<span className="font-bold text-primary">{preview.summary.sessions} buổi</span>
                  </>}
                  {busy && <span className="ml-2 inline-block w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin align-middle" />}
                </p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-on-surface-variant cursor-pointer">
                    <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} />
                    Chỉ hiện dòng có cảnh báo/lỗi
                  </label>
                  <button onClick={reset} className="text-xs text-outline hover:text-error flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">close</span>Chọn file khác
                  </button>
                </div>
              </div>

              {(hasDuplicate || replaceExisting) && (
                <div className="p-3 rounded-xl bg-surface-container-low">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={replaceExisting} onChange={e => setReplaceExisting(e.target.checked)} />
                    <span><b className="text-error">Xoá lịch học riêng đã xếp trước đó</b> trong tháng import của những học viên bị trùng, rồi xếp lại theo file.</span>
                  </label>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
                <table className="w-full text-left text-sm min-w-[980px]">
                  <thead>
                    <tr className="bg-surface-container-low/60 text-[10px] uppercase font-bold text-outline tracking-wider">
                      <th className="px-3 py-2.5 w-14">Dòng</th>
                      <th className="px-3 py-2.5">Học viên</th>
                      <th className="px-3 py-2.5">Lịch</th>
                      <th className="px-3 py-2.5">Ngày bỏ qua</th>
                      <th className="px-3 py-2.5 text-right">Học phí/buổi</th>
                      <th className="px-3 py-2.5 text-right">Số buổi</th>
                      <th className="px-3 py-2.5 w-[34%]">Kiểm tra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {visible.map(r => {
                      const res = byRow.get(r.row)
                      const tone = res?.status === 'error' ? 'bg-error/5' : res?.status === 'warning' ? 'bg-amber-50/60' : ''
                      return (
                        <tr key={r.row} className={`align-top ${tone}`}>
                          <td className="px-3 py-2 text-outline text-xs">{r.row}</td>
                          <td className="px-3 py-2">
                            <p className="font-medium text-on-surface">{r.studentName || <span className="text-error">Chưa có tên</span>}</p>
                            <p className="text-xs text-outline">{r.gradeLevel ? `Khối ${String(r.gradeLevel).replace(/\D/g, '') || r.gradeLevel}` : 'Chưa có khối'}</p>
                            {res?.candidates && res.candidates.length > 0 && (
                              <select value={picks[r.row] ?? ''} onChange={e => setPicks(p => ({ ...p, [r.row]: e.target.value }))}
                                className="mt-1 w-full max-w-[240px] text-xs rounded-lg border border-outline-variant/40 bg-white px-2 py-1">
                                <option value="">— Chọn đúng học viên —</option>
                                {res.candidates.map(c => (
                                  <option key={c.id} value={c.id}>
                                    {c.fullName} · {c.gradeLevel ? `Khối ${c.gradeLevel}` : 'chưa có khối'}{c.activeClasses.length ? ` · ${c.activeClasses.join(', ')}` : ' · học riêng'}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-2 text-on-surface-variant whitespace-nowrap">
                            <p>{r.weekdays.length ? r.weekdays.map(d => WD[d]).join(', ') : <span className="text-error">{r.weekdaysRaw || 'Chưa có thứ'}</span>}</p>
                            <p className="text-xs text-outline">Tháng {r.month || '?'}/{r.year || '?'}</p>
                          </td>
                          <td className="px-3 py-2 text-xs text-on-surface-variant">
                            {res?.absentDates.length ? <p>HV nghỉ: {dayList(res.absentDates)}</p> : null}
                            {res?.holidayDates.length ? <p>Nghỉ lễ: {dayList(res.holidayDates)}</p> : null}
                            {!res?.absentDates.length && !res?.holidayDates.length && (r.absentRaw ? <p className="text-outline">{r.absentRaw}</p> : '—')}
                          </td>
                          <td className="px-3 py-2 text-right text-on-surface-variant whitespace-nowrap">{fmtMoney(r.ratePerSession)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{res?.dates.length ?? '…'}</td>
                          <td className="px-3 py-2">
                            {!res ? <span className="text-xs text-outline">Đang kiểm tra…</span>
                              : res.issues.length === 0 ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-secondary"><span className="material-symbols-outlined text-[16px]">check_circle</span>Hợp lệ</span>
                              : <ul className="space-y-1">
                                  {res.issues.map((i, k) => (
                                    <li key={k} className={`flex gap-1 text-xs ${i.level === 'error' ? 'text-error' : 'text-amber-700'}`}>
                                      <span className="material-symbols-outlined text-[15px] shrink-0">{i.level === 'error' ? 'error' : 'warning'}</span>
                                      <span>{i.message}</span>
                                    </li>
                                  ))}
                                </ul>}
                            {res?.studentId && res.activeClasses && res.activeClasses.length > 0 && (
                              <label className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-on-surface cursor-pointer">
                                <input type="checkbox" className="mt-0.5" checked={confirmed.has(res.studentId)} onChange={() => toggleConfirmed(res.studentId!)} />
                                Xác nhận vẫn xếp lịch học riêng cho {res.studentName}
                              </label>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="px-6 pb-6 pt-2 flex gap-3">
          {result ? (
            <button onClick={onClose} className="flex-1 btn-primary justify-center">Xong</button>
          ) : (
            <>
              <button onClick={onClose} className="flex-1 btn-secondary justify-center">Huỷ</button>
              <button onClick={handleImport} disabled={busy || !preview?.summary.valid}
                className="flex-1 btn-primary justify-center disabled:opacity-60">
                {busy && preview
                  ? <><span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />Đang xử lý...</>
                  : <><span className="material-symbols-outlined text-base">upload</span>Import {preview?.summary.sessions ? `${preview.summary.sessions} buổi` : ''}</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
