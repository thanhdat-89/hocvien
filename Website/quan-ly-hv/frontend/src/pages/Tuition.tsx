import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import api from '../services/api'
import * as XLSX from 'xlsx'

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
  classId: string
  className: string
  totalSessions: number
  ratePerSession: number
  discountAmount: number
  baseAmount: number
  finalAmount: number
  tuitionRecord: TuitionRecordSummary | null
}

export default function Tuition() {
  const thisYear = new Date().getFullYear()
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [classFilter, setClassFilter] = useState<string | null>(null)
  const [gradeFilter, setGradeFilter] = useState<number | null>(null)

  const loadData = () => {
    setLoading(true)
    api.get(`/tuition/schedule-summary?month=${month}&year=${year}`)
      .then(r => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [month, year])

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

  const years = Array.from({ length: 4 }, (_, i) => thisYear - 1 + i)

  const [creatingRow, setCreatingRow] = useState<string | null>(null)
  const [bulkCreating, setBulkCreating] = useState(false)

  const createRecordForRow = async (row: ScheduleRow) => {
    const isRecalc = !!row.tuitionRecord
    if (isRecalc) {
      const ok = window.confirm(
        `Tính lại phiếu cho ${row.studentName} - ${row.className} T${month}/${year}?\n\n` +
        `Số tiền sẽ cập nhật theo lịch hiện tại. Các giao dịch đã thanh toán được giữ nguyên.`
      )
      if (!ok) return
    }
    const key = `${row.studentId}-${row.classId}`
    setCreatingRow(key)
    try {
      await api.post('/tuition/calculate', {
        studentId: row.studentId, classId: row.classId, month, year,
      })
      loadData()
    } catch (e: any) {
      alert(e?.response?.data?.message || (isRecalc ? 'Tính lại phiếu thất bại' : 'Tạo phiếu thất bại'))
    } finally {
      setCreatingRow(null)
    }
  }

  const createRecordsBulk = async () => {
    const classIds = [...new Set(filtered.map(r => r.classId))]
    if (classIds.length === 0) return
    const phrase = window.prompt(
      `Tạo phiếu học phí cho ${classIds.length} lớp tháng ${month}/${year}.\n` +
      `Hành động này tạo/cập nhật phiếu cho TOÀN BỘ học viên trong các lớp đang hiển thị.\n\n` +
      `Gõ "xacnhan" để xác nhận:`
    )
    if (phrase === null) return
    setBulkCreating(true)
    try {
      const res = await api.post('/tuition/calculate-bulk', {
        month, year, classIds, password: phrase,
      })
      const { created, updated, failed } = res.data
      alert(`Tạo ${created} phiếu mới, cập nhật ${updated} phiếu${failed ? `, ${failed} lớp lỗi` : ''}.`)
      loadData()
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Tạo phiếu hàng loạt thất bại')
    } finally {
      setBulkCreating(false)
    }
  }

  const exportExcel = () => {
    // Build flat rows grouped by student
    const exportRows: Record<string, string | number>[] = []
    const spanMap: Record<string, number> = {}
    filtered.forEach(r => { spanMap[r.studentId] = (spanMap[r.studentId] || 0) + 1 })
    const seen = new Set<string>()
    let stt = 0
    filtered.forEach(r => {
      const isFirst = !seen.has(r.studentId)
      if (isFirst) { seen.add(r.studentId); stt++ }
      exportRows.push({
        'STT': isFirst ? stt : '',
        'Họ tên': isFirst ? r.studentName : '',
        'Khối lớp': r.gradeLevel != null ? `Lớp ${r.gradeLevel}` : '',
        'Lớp học': r.className,
        'Số buổi': r.totalSessions,
        'Học phí/buổi (đ)': r.ratePerSession,
        'Khuyến mại (đ)': r.discountAmount > 0 ? -r.discountAmount : 0,
        'Thành tiền (đ)': r.finalAmount,
      })
    })
    // Total row
    exportRows.push({
      'STT': '',
      'Họ tên': 'TỔNG CỘNG',
      'Khối lớp': '',
      'Lớp học': '',
      'Số buổi': totalSessions,
      'Học phí/buổi (đ)': '',
      'Khuyến mại (đ)': -filtered.reduce((s, r) => s + r.discountAmount, 0),
      'Thành tiền (đ)': totalAmount,
    })

    const ws = XLSX.utils.json_to_sheet(exportRows)
    // Column widths
    ws['!cols'] = [
      { wch: 5 }, { wch: 28 }, { wch: 10 }, { wch: 18 },
      { wch: 9 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Học phí T${month}-${year}`)
    const suffix = [
      gradeFilter != null ? `khoi${gradeFilter}` : '',
      classFilter ? classFilter.replace(/\s+/g, '_') : '',
    ].filter(Boolean).join('-')
    XLSX.writeFile(wb, `hoc-phi-thang-${month}-${year}${suffix ? `-${suffix}` : ''}.xlsx`)
  }

  return (
    <div>
      <TopBar title="Quản lý Học phí" />
      <div className="px-8 py-8 space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Tài chính</span>
            <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Quản lý Học phí</h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={createRecordsBulk}
              disabled={filtered.length === 0 || bulkCreating}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition-all disabled:opacity-40"
              title="Tạo/cập nhật phiếu học phí cho mọi lớp đang hiển thị"
            >
              <span className="material-symbols-outlined text-[18px]">{bulkCreating ? 'sync' : 'receipt_long'}</span>
              {bulkCreating ? 'Đang tạo...' : 'Tạo phiếu cả tháng'}
            </button>
            <button
              onClick={exportExcel}
              disabled={filtered.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary/10 text-secondary text-sm font-semibold hover:bg-secondary/20 transition-all disabled:opacity-40"
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
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <p className="text-sm text-outline font-medium">Tổng số buổi</p>
            <p className="text-3xl font-black text-secondary mt-2">{totalSessions}</p>
          </div>
        </div>

        {/* Filter cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
        <div className="bg-surface-container-lowest rounded-3xl overflow-hidden shadow-sm border border-outline-variant/10">
          {loading ? (
            <div className="py-16 text-center text-outline">
              <span className="material-symbols-outlined text-5xl block mb-3 opacity-30 animate-pulse">sync</span>
              Đang tải...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/50">
                    <th className="table-header w-12">STT</th>
                    <th className="table-header">Họ tên</th>
                    <th className="table-header">Khối lớp</th>
                    <th className="table-header">Lớp học</th>
                    <th className="table-header text-right">Số buổi</th>
                    <th className="table-header text-right">Học phí/buổi</th>
                    <th className="table-header text-right">Khuyến mại</th>
                    <th className="table-header text-right">Thành tiền</th>
                    <th className="table-header text-center">Phiếu</th>
                    <th className="table-header text-center">Thanh toán</th>
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
                        <tr key={`${r.studentId}-${r.classId}`} className={`hover:bg-surface-container-low/30 transition-colors ${isFirst && sttCounter > 1 ? 'border-t border-outline-variant/10' : !isFirst ? 'border-t border-dashed border-outline-variant/10' : ''}`}>
                          {isFirst && <td className="table-cell text-sm text-outline align-top" rowSpan={span}>{sttCounter}</td>}
                          {isFirst && <td className="table-cell font-semibold text-on-surface align-top" rowSpan={span}>{r.studentName}</td>}
                          <td className="table-cell text-sm text-center">
                            {r.gradeLevel != null
                              ? <span className="px-2.5 py-0.5 rounded-full bg-primary/8 text-primary text-xs font-bold">Lớp {r.gradeLevel}</span>
                              : <span className="text-outline">—</span>}
                          </td>
                          <td className="table-cell text-sm text-on-surface-variant">{r.className}</td>
                          <td className="table-cell text-sm text-right">{r.totalSessions}</td>
                          <td className="table-cell text-sm text-right">
                            {r.ratePerSession > 0 ? r.ratePerSession.toLocaleString('vi-VN') + 'đ' : '—'}
                          </td>
                          <td className="table-cell text-sm text-right text-secondary">
                            {r.discountAmount > 0 ? '-' + r.discountAmount.toLocaleString('vi-VN') + 'đ' : '—'}
                          </td>
                          <td className="table-cell text-sm text-right font-bold text-on-surface">
                            {r.finalAmount.toLocaleString('vi-VN')}đ
                          </td>
                          <td className="table-cell text-center">
                            {r.tuitionRecord ? (
                              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 text-xs font-bold">Đã tạo</span>
                            ) : (
                              <button
                                onClick={() => createRecordForRow(r)}
                                disabled={creatingRow === `${r.studentId}-${r.classId}`}
                                className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-all disabled:opacity-40"
                              >
                                {creatingRow === `${r.studentId}-${r.classId}` ? '...' : 'Tạo phiếu'}
                              </button>
                            )}
                          </td>
                          <td className="table-cell text-center text-xs">
                            {!r.tuitionRecord ? (
                              <span className="text-outline">—</span>
                            ) : r.tuitionRecord.status === 'PAID' || r.tuitionRecord.remainingAmount === 0 ? (
                              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 font-bold">Đã đủ</span>
                            ) : r.tuitionRecord.paidAmount > 0 ? (
                              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 font-bold" title={`${r.tuitionRecord.paidAmount.toLocaleString('vi-VN')}đ / ${r.tuitionRecord.finalAmount.toLocaleString('vi-VN')}đ`}>
                                Một phần
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-700 font-bold">Chưa đóng</span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  })()}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-16 text-center text-outline">
                        <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">payments</span>
                        {classFilter || gradeFilter != null
                          ? `Không có dữ liệu cho bộ lọc đang chọn`
                          : `Không có dữ liệu học phí tháng ${month}/${year}`}
                      </td>
                    </tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="bg-surface-container-low/50 border-t-2 border-outline-variant/20">
                      <td colSpan={4} className="table-cell font-bold text-on-surface">Tổng cộng</td>
                      <td className="table-cell text-right font-bold">{totalSessions}</td>
                      <td className="table-cell" />
                      <td className="table-cell text-right font-bold text-secondary">
                        {filtered.reduce((s, r) => s + r.discountAmount, 0) > 0
                          ? '-' + filtered.reduce((s, r) => s + r.discountAmount, 0).toLocaleString('vi-VN') + 'đ'
                          : '—'}
                      </td>
                      <td className="table-cell text-right font-black text-primary text-base">
                        {totalAmount.toLocaleString('vi-VN')}đ
                      </td>
                      <td className="table-cell text-center text-xs text-outline">
                        {filtered.filter(r => r.tuitionRecord).length}/{filtered.length}
                      </td>
                      <td className="table-cell" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
