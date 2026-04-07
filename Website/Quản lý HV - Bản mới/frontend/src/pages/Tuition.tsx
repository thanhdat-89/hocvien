import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import api from '../services/api'
import * as XLSX from 'xlsx'

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
}

export default function Tuition() {
  const thisYear = new Date().getFullYear()
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [gradeFilter, setGradeFilter] = useState<string | null>(null)

  const loadData = () => {
    setLoading(true)
    api.get(`/tuition/schedule-summary?month=${month}&year=${year}`)
      .then(r => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [month, year])

  // Danh sách khối có trong dữ liệu, sắp xếp theo số
  const grades = Array.from(new Set(rows.map(r => r.gradeLevel != null ? `Lớp ${r.gradeLevel}` : 'Khác')))
    .sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99))

  const filtered = gradeFilter
    ? rows.filter(r => (r.gradeLevel != null ? `Lớp ${r.gradeLevel}` : 'Khác') === gradeFilter)
    : rows

  const totalAmount = filtered.reduce((s, r) => s + r.finalAmount, 0)
  const totalSessions = filtered.reduce((s, r) => s + r.totalSessions, 0)
  const uniqueStudents = new Set(filtered.map(r => r.studentId)).size

  const years = Array.from({ length: 4 }, (_, i) => thisYear - 1 + i)

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
    XLSX.writeFile(wb, `hoc-phi-thang-${month}-${year}${gradeFilter ? `-lop${gradeFilter.replace('Lớp ', '')}` : ''}.xlsx`)
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

        {/* Grade filter */}
        {grades.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-outline uppercase tracking-wider mr-1">Khối lớp:</span>
            <button
              onClick={() => setGradeFilter(null)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all ${
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
                className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all ${
                  gradeFilter === g
                    ? 'bg-primary text-on-primary border-primary shadow-sm'
                    : 'bg-surface-container-low text-outline border-outline-variant/20 hover:border-primary/40 hover:text-primary'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        )}

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
                        </tr>
                      )
                    })
                  })()}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-outline">
                        <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">payments</span>
                        {gradeFilter ? `Không có dữ liệu cho ${gradeFilter}` : `Không có dữ liệu học phí tháng ${month}/${year}`}
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
