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

  useEffect(() => {
    if (filterClassId && !classOptions.some(c => c.classId === filterClassId)) setFilterClassId('')
  }, [classOptions, filterClassId])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filterGrade && String(r.gradeLevel ?? '') !== filterGrade) return false
      if (filterClassId && !r.classes.some(c => c.classId === filterClassId)) return false
      if (q && !r.studentName.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, filterGrade, filterClassId, search])

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
  const filledCount = rows.filter(r => r.review && r.review.content.trim()).length

  return (
    <div className="space-y-6">
      <TopBar title="Nhận xét học viên" />

      <div className="bg-surface rounded-3xl p-6 md:p-8 shadow-sm">
        <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">Đánh giá định kỳ</p>
        <h2 className="font-headline text-3xl font-black text-on-surface mb-6">Nhận xét học viên</h2>

        <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="bg-surface-container-low border border-outline-variant/20 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {months.map(m => <option key={m} value={m}>Tháng {m}</option>)}
            </select>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="bg-surface-container-low border border-outline-variant/20 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm học viên..."
              className="bg-surface-container-low border border-outline-variant/20 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 w-56"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-outline">
              Đã nhận xét: <b className="text-on-surface">{filledCount}</b> / {rows.length}
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

        <div className="bg-surface-container-low/60 rounded-2xl p-4 mb-6 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider mb-2 block">Khối lớp</label>
            <div className="flex flex-wrap gap-2">
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
          {classOptions.length > 0 && (
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider mb-2 block">Lớp học</label>
              <div className="flex flex-wrap gap-2">
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
              </div>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/50">
                <th className="table-header w-12 text-center">STT</th>
                <th className="table-header">Học viên</th>
                <th className="table-header">Khối lớp</th>
                <th className="table-header">Lớp học</th>
                <th className="table-header">Nội dung nhận xét</th>
                <th className="table-header">Tình trạng</th>
                <th className="table-header text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-outline">
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
                      className="flex items-center gap-3 hover:opacity-80 transition-opacity text-left"
                    >
                      <Avatar name={r.studentName} />
                      <p className="font-semibold text-on-surface">{r.studentName}</p>
                    </button>
                  </td>
                  <td className="table-cell">
                    {r.gradeLevel != null ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-container-high text-xs font-bold text-primary">
                        Lớp {r.gradeLevel}
                      </span>
                    ) : <span className="text-outline text-sm">—</span>}
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
                  <td className="table-cell w-[40%] min-w-[280px]">
                    <textarea
                      value={r.draft}
                      onChange={e => updateRow(r.studentId, { draft: e.target.value })}
                      placeholder="Nhập nhận xét..."
                      rows={2}
                      className={`w-full bg-surface-container-low rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y min-h-[44px] ${r.dirty ? 'ring-2 ring-amber-300' : ''}`}
                    />
                    <input
                      type="text"
                      value={r.draftTeacher}
                      onChange={e => updateRow(r.studentId, { draftTeacher: e.target.value })}
                      placeholder="Tên giáo viên (không bắt buộc)"
                      className="mt-1 w-full bg-transparent border-none text-xs text-outline focus:outline-none focus:text-on-surface px-1"
                    />
                  </td>
                  <td className="table-cell">
                    {r.review && r.review.content.trim() ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-wider">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Đã nhận xét
                        </span>
                        {r.review.updatedAt && (
                          <p className="text-[10px] text-outline">{fmtUpdated(r.review.updatedAt)}</p>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high text-outline text-[11px] font-bold uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-outline/40" /> Chưa nhận xét
                      </span>
                    )}
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
