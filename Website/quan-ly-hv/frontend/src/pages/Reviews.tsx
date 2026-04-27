import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'
import { useAlert, useConfirm } from '../components/ConfirmDialog'
import api from '../services/api'

interface ReviewRow {
  studentId: string
  studentName: string
  gradeLevel: number | null
  classes: { classId: string; className: string }[]
  review: { content: string; teacherName?: string; updatedAt?: string } | null
}

interface RowState extends ReviewRow {
  draft: string
  draftTeacher: string
  saving: boolean
  dirty: boolean
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(-2).map(w => w[0] ?? '').join('').toUpperCase()
  const colors = ['bg-blue-100 text-primary', 'bg-pink-100 text-tertiary', 'bg-green-100 text-secondary', 'bg-purple-100 text-tertiary']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center font-bold text-sm flex-shrink-0`}>
      {initials}
    </div>
  )
}

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

const fmtUpdated = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export default function Reviews() {
  const navigate = useNavigate()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [filterGrade, setFilterGrade] = useState<string>('')
  const [filterClassId, setFilterClassId] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'reviewed' | 'pending'>('all')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const alert = useAlert()
  const confirm = useConfirm()

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get(`/reviews?month=${monthKey(year, month)}`)
      const data: ReviewRow[] = r.data?.rows ?? []
      setRows(data.map(x => ({
        ...x,
        draft: x.review?.content ?? '',
        draftTeacher: x.review?.teacherName ?? '',
        saving: false,
        dirty: false,
      })))
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [year, month])

  const grades = useMemo(() => {
    const set = new Set<number>()
    rows.forEach(r => { if (r.gradeLevel != null) set.add(r.gradeLevel) })
    return [...set].sort((a, b) => a - b)
  }, [rows])

  const classOptions = useMemo(() => {
    const map = new Map<string, { classId: string; className: string; gradeLevel: number | null }>()
    rows.forEach(r => {
      if (filterGrade && String(r.gradeLevel ?? '') !== filterGrade) return
      r.classes.forEach(c => {
        if (!map.has(c.classId)) map.set(c.classId, { classId: c.classId, className: c.className, gradeLevel: r.gradeLevel })
      })
    })
    return [...map.values()].sort((a, b) => a.className.localeCompare(b.className, 'vi'))
  }, [rows, filterGrade])

  const hasPrivateInScope = useMemo(() => rows.some(r => {
    if (filterGrade && String(r.gradeLevel ?? '') !== filterGrade) return false
    return r.classes.length === 0
  }), [rows, filterGrade])

  useEffect(() => {
    if (filterClassId === '__private__') return
    if (filterClassId && !classOptions.some(c => c.classId === filterClassId)) setFilterClassId('')
  }, [classOptions, filterClassId])

  // Tập hợp đã lọc theo khối + lớp (không tính status/search) — dùng để đếm
  const scoped = useMemo(() => {
    return rows.filter(r => {
      if (filterGrade && String(r.gradeLevel ?? '') !== filterGrade) return false
      if (filterClassId === '__private__') return r.classes.length === 0
      if (filterClassId && !r.classes.some(c => c.classId === filterClassId)) return false
      return true
    })
  }, [rows, filterGrade, filterClassId])

  const scopedFilled = useMemo(
    () => scoped.filter(r => r.review && r.review.content.trim()).length,
    [scoped]
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped.filter(r => {
      const hasReview = !!(r.review && r.review.content.trim())
      if (filterStatus === 'reviewed' && !hasReview) return false
      if (filterStatus === 'pending' && hasReview) return false
      if (q && !r.studentName.toLowerCase().includes(q)) return false
      return true
    })
  }, [scoped, filterStatus, search])

  const updateRow = (sid: string, patch: Partial<RowState>) => {
    setRows(rs => rs.map(r => r.studentId === sid ? { ...r, ...patch, dirty: true } : r))
  }

  const saveRow = async (sid: string) => {
    const row = rows.find(r => r.studentId === sid)
    if (!row) return
    const content = row.draft.trim()
    const mk = monthKey(year, month)

    setRows(rs => rs.map(r => r.studentId === sid ? { ...r, saving: true } : r))
    try {
      if (!content) {
        if (row.review) await api.delete(`/reviews/${sid}/${mk}`)
        setRows(rs => rs.map(r => r.studentId === sid ? {
          ...r, review: null, draft: '', draftTeacher: '', saving: false, dirty: false,
        } : r))
      } else {
        const payload: any = { content }
        if (row.draftTeacher.trim()) payload.teacherName = row.draftTeacher.trim()
        const res = await api.put(`/reviews/${sid}/${mk}`, payload)
        const saved = res.data
        setRows(rs => rs.map(r => r.studentId === sid ? {
          ...r,
          review: { content: saved.content, teacherName: saved.teacherName, updatedAt: saved.updatedAt },
          draft: saved.content,
          draftTeacher: saved.teacherName ?? '',
          saving: false,
          dirty: false,
        } : r))
      }
    } catch (err: any) {
      setRows(rs => rs.map(r => r.studentId === sid ? { ...r, saving: false } : r))
      await alert({ title: 'Lỗi lưu nhận xét', message: err?.response?.data?.message ?? 'Không lưu được. Thử lại.' })
    }
  }

  const removeRow = async (sid: string) => {
    const row = rows.find(r => r.studentId === sid)
    if (!row?.review) return
    const ok = await confirm({
      title: 'Xoá nhận xét?',
      message: `Xoá nhận xét tháng ${month}/${year} của "${row.studentName}"?`,
      confirmLabel: 'Xoá',
      danger: true,
    })
    if (!ok) return
    try {
      await api.delete(`/reviews/${sid}/${monthKey(year, month)}`)
      setRows(rs => rs.map(r => r.studentId === sid ? {
        ...r, review: null, draft: '', draftTeacher: '', saving: false, dirty: false,
      } : r))
    } catch (err: any) {
      await alert({ title: 'Lỗi xoá', message: err?.response?.data?.message ?? 'Không xoá được.' })
    }
  }

  const dirtyCount = rows.filter(r => r.dirty).length
  const saveAll = async () => {
    for (const r of rows.filter(r => r.dirty)) await saveRow(r.studentId)
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const years = Array.from({ length: 6 }, (_, i) => today.getFullYear() - 2 + i)

  return (
    <div className="space-y-6">
      <TopBar title="Nhận xét học viên" />

      <div className="bg-surface rounded-3xl p-6 md:p-8 shadow-sm">
        <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">Đánh giá định kỳ</p>
        <h2 className="font-headline text-3xl font-black text-on-surface mb-6">Nhận xét học viên</h2>

        <div className="bg-surface-container-low/60 rounded-2xl p-4 mb-6 space-y-4">
          {/* Row 1 — Phạm vi & tìm kiếm */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-outline uppercase tracking-wider mr-1">Tháng</span>
              <select
                value={month}
                onChange={e => setMonth(Number(e.target.value))}
                className="bg-surface border border-outline-variant/30 rounded-lg py-1.5 px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {months.map(m => <option key={m} value={m}>Tháng {m}</option>)}
              </select>
              <select
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                className="bg-surface border border-outline-variant/30 rounded-lg py-1.5 px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <div className="relative ml-2">
                <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-base text-outline pointer-events-none">search</span>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Tìm học viên..."
                  className="bg-surface border border-outline-variant/30 rounded-lg py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 w-56"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-outline">
                Đã nhận xét: <b className="text-on-surface">{scopedFilled}</b> / {scoped.length}
              </span>
              {dirtyCount > 0 && (
                <button
                  onClick={saveAll}
                  className="bg-primary text-on-primary rounded-xl py-2 px-4 text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">save</span>
                  Lưu tất cả ({dirtyCount})
                </button>
              )}
            </div>
          </div>

          {/* Row 2 — Tình trạng nhận xét (đếm theo khối + lớp đang chọn) */}
          <div className="flex items-start gap-3 flex-wrap">
            <span className="text-[10px] font-bold text-outline uppercase tracking-wider w-20 pt-2 shrink-0">Tình trạng</span>
            <div className="flex flex-wrap gap-2 flex-1">
              {([
                { v: 'all', label: 'Tất cả', count: scoped.length },
                { v: 'reviewed', label: 'Đã nhận xét', count: scopedFilled },
                { v: 'pending', label: 'Chưa nhận xét', count: scoped.length - scopedFilled },
              ] as const).map(opt => {
                const active = filterStatus === opt.v
                const tone = opt.v === 'reviewed'
                  ? (active ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-surface text-emerald-700 border-emerald-200 hover:border-emerald-400')
                  : opt.v === 'pending'
                  ? (active ? 'bg-amber-500 text-white border-amber-500 shadow-sm' : 'bg-surface text-amber-700 border-amber-200 hover:border-amber-400')
                  : (active ? 'bg-primary text-on-primary border-primary shadow-sm' : 'bg-surface text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary')
                return (
                  <button
                    key={opt.v}
                    onClick={() => setFilterStatus(opt.v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${tone}`}
                  >
                    {opt.label}
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${active ? 'bg-white/20' : 'bg-surface-container-high text-outline'}`}>
                      {opt.count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Row 3 — Khối lớp */}
          <div className="flex items-start gap-3 flex-wrap">
            <span className="text-[10px] font-bold text-outline uppercase tracking-wider w-20 pt-2 shrink-0">Khối lớp</span>
            <div className="flex flex-wrap gap-2 flex-1">
              <button
                onClick={() => { setFilterGrade(''); setFilterClassId('') }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  filterGrade === ''
                    ? 'bg-primary text-on-primary border-primary shadow-sm'
                    : 'bg-surface text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary'
                }`}
              >
                Tất cả
              </button>
              {grades.map(g => (
                <button
                  key={g}
                  onClick={() => { setFilterGrade(String(g)); setFilterClassId('') }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    filterGrade === String(g)
                      ? 'bg-primary text-on-primary border-primary shadow-sm'
                      : 'bg-surface text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  Lớp {g}
                </button>
              ))}
            </div>
          </div>

          {/* Row 4 — Lớp học */}
          {(classOptions.length > 0 || hasPrivateInScope) && (
            <div className="flex items-start gap-3 flex-wrap">
              <span className="text-[10px] font-bold text-outline uppercase tracking-wider w-20 pt-2 shrink-0">Lớp học</span>
              <div className="flex flex-wrap gap-2 flex-1">
                <button
                  onClick={() => setFilterClassId('')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    filterClassId === ''
                      ? 'bg-primary text-on-primary border-primary shadow-sm'
                      : 'bg-surface text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  Tất cả
                </button>
                {classOptions.map(c => (
                  <button
                    key={c.classId}
                    onClick={() => setFilterClassId(c.classId)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      filterClassId === c.classId
                        ? 'bg-primary text-on-primary border-primary shadow-sm'
                        : 'bg-surface text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary'
                    }`}
                  >
                    {c.className}
                  </button>
                ))}
                {hasPrivateInScope && (
                  <button
                    onClick={() => setFilterClassId('__private__')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      filterClassId === '__private__'
                        ? 'bg-tertiary text-on-tertiary border-tertiary shadow-sm'
                        : 'bg-surface text-tertiary border-tertiary/30 hover:border-tertiary/60'
                    }`}
                  >
                    Học riêng
                  </button>
                )}
              </div>
            </div>
          )}

        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/50">
                <th className="table-header w-px whitespace-nowrap text-center">STT</th>
                <th className="table-header w-px whitespace-nowrap">Học viên</th>
                <th className="table-header w-px whitespace-nowrap">Lớp học</th>
                <th className="table-header">Nội dung nhận xét</th>
                <th className="table-header w-px whitespace-nowrap text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-outline">
                    <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">search_off</span>
                    Không tìm thấy học viên nào
                  </td>
                </tr>
              ) : visible.map((r, i) => (
                <tr key={r.studentId} className="hover:bg-surface-container-low/30 transition-colors group align-top">
                  <td className="table-cell text-center text-sm text-outline font-medium">{i + 1}</td>
                  <td className="table-cell">
                    <button
                      onClick={() => navigate(`/students/${r.studentId}`)}
                      className="hover:opacity-80 transition-opacity text-left"
                    >
                      <p className="font-semibold text-on-surface">{r.studentName}</p>
                    </button>
                  </td>
                  <td className="table-cell">
                    {r.classes.length === 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-tertiary/10 text-tertiary text-xs font-medium">
                        Học riêng
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.classes.map(c => (
                          <span key={c.classId} className="inline-flex items-center px-2 py-0.5 rounded-md bg-primary-container/20 text-primary text-xs font-medium">
                            {c.className}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="table-cell w-auto">
                    <textarea
                      value={r.draft}
                      onChange={e => updateRow(r.studentId, { draft: e.target.value })}
                      placeholder="Nhập nhận xét..."
                      rows={2}
                      className={`w-full bg-surface-container-low rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y min-h-[44px] ${r.dirty ? 'ring-2 ring-amber-300' : ''}`}
                    />
                  </td>
                  <td className="table-cell text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => saveRow(r.studentId)}
                        disabled={!r.dirty || r.saving}
                        className="p-2 text-outline hover:text-primary hover:bg-primary-container/10 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Lưu nhận xét"
                      >
                        <span className="material-symbols-outlined text-[20px]">
                          {r.saving ? 'progress_activity' : 'save'}
                        </span>
                      </button>
                      <button
                        onClick={() => navigate(`/students/${r.studentId}`)}
                        className="p-2 text-outline hover:text-primary hover:bg-primary-container/10 rounded-lg transition-all"
                        title="Xem hồ sơ học viên"
                      >
                        <span className="material-symbols-outlined text-[20px]">visibility</span>
                      </button>
                      {r.review && (
                        <button
                          onClick={() => removeRow(r.studentId)}
                          className="p-2 text-outline hover:text-error hover:bg-error-container/10 rounded-lg transition-all"
                          title="Xoá nhận xét"
                        >
                          <span className="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
