import React, { useEffect, useMemo, useState } from 'react'
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

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

export default function Reviews() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [filterGrade, setFilterGrade] = useState<string>('')
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filterGrade && String(r.gradeLevel ?? '') !== filterGrade) return false
      if (q && !r.studentName.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, filterGrade, search])

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
        if (row.review) {
          await api.delete(`/reviews/${sid}/${mk}`)
        }
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
    const dirty = rows.filter(r => r.dirty)
    for (const r of dirty) await saveRow(r.studentId)
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const years = Array.from({ length: 6 }, (_, i) => today.getFullYear() - 2 + i)
  const filledCount = rows.filter(r => r.review && r.review.content.trim()).length

  return (
    <div className="space-y-6">
      <TopBar title="Nhận xét học viên" />

      <div className="flex items-center justify-between gap-3 flex-wrap">
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
          <select
            value={filterGrade}
            onChange={e => setFilterGrade(e.target.value)}
            className="bg-surface-container-low border border-outline-variant/20 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Tất cả khối</option>
            {grades.map(g => <option key={g} value={g}>Khối {g}</option>)}
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

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface rounded-2xl py-20 text-center">
          <p className="text-outline">Không có học viên phù hợp.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-2xl overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-outline-variant/10 text-[10px] uppercase font-bold text-outline tracking-widest">
                <th className="py-3 px-4 w-12">STT</th>
                <th className="py-3 px-4 w-56">Học viên</th>
                <th className="py-3 px-4 w-20">Khối lớp</th>
                <th className="py-3 px-4 w-48">Lớp học</th>
                <th className="py-3 px-4">Nội dung nhận xét</th>
                <th className="py-3 px-4 w-32">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5">
              {visible.map((r, i) => (
                <tr key={r.studentId} className="hover:bg-surface-container-low/30 transition-colors align-top">
                  <td className="py-3 px-4 text-sm text-outline">{i + 1}</td>
                  <td className="py-3 px-4">
                    <a
                      href={`/students/${r.studentId}`}
                      className="text-sm font-semibold text-on-surface hover:text-primary"
                    >
                      {r.studentName}
                    </a>
                  </td>
                  <td className="py-3 px-4">
                    {r.gradeLevel != null ? (
                      <span className="inline-block bg-primary/10 text-primary text-xs font-bold px-2 py-0.5 rounded-md">
                        Lớp {r.gradeLevel}
                      </span>
                    ) : (
                      <span className="text-xs text-outline">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {r.classes.length === 0 ? (
                      <span className="text-xs text-outline">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.classes.map(c => (
                          <span key={c.classId} className="inline-block bg-emerald-50 text-emerald-700 text-xs font-medium px-2 py-0.5 rounded-md">
                            {c.className}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <textarea
                      value={r.draft}
                      onChange={e => updateRow(r.studentId, { draft: e.target.value })}
                      placeholder="Nhập nhận xét..."
                      rows={2}
                      className={`w-full bg-surface-container-low rounded-lg py-1.5 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y min-h-[44px] ${r.dirty ? 'ring-2 ring-amber-300' : ''}`}
                    />
                    <input
                      type="text"
                      value={r.draftTeacher}
                      onChange={e => updateRow(r.studentId, { draftTeacher: e.target.value })}
                      placeholder="Tên giáo viên (không bắt buộc)"
                      className="mt-1 w-full bg-transparent border-none text-xs text-outline focus:outline-none focus:text-on-surface"
                    />
                    {r.review?.updatedAt && !r.dirty && (
                      <p className="mt-1 text-[10px] text-outline">
                        Cập nhật: {new Date(r.review.updatedAt).toLocaleString('vi-VN')}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => saveRow(r.studentId)}
                        disabled={!r.dirty || r.saving}
                        className="p-2 hover:bg-primary/10 text-outline hover:text-primary rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Lưu"
                      >
                        <span className="material-symbols-outlined text-base">
                          {r.saving ? 'progress_activity' : 'save'}
                        </span>
                      </button>
                      {r.review && (
                        <button
                          onClick={() => removeRow(r.studentId)}
                          className="p-2 hover:bg-error/10 text-outline hover:text-error rounded-lg transition-colors"
                          title="Xoá nhận xét"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
