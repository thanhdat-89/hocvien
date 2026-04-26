import React, { useEffect, useMemo, useState } from 'react'
import TopBar from '../components/TopBar'
import { useConfirm, useAlert } from '../components/ConfirmDialog'
import api from '../services/api'

interface Test {
  id: string
  name: string
  testDate: string
  classId: string
  className: string
  gradeLevel?: number
  maxScore: number
  teacherName?: string
  notes?: string
  averageScore?: number
  submissionCount?: number
}

interface ClassLite {
  id: string
  name: string
  gradeLevel?: number
  activeStudents?: number
}

interface ScoreRow {
  studentId: string
  studentName: string
  scoreId?: string
  score: number | null
  notes: string
}

const fmtDate = (s: string) => {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

const scoreColor = (score: number, max: number) => {
  if (score == null || max <= 0) return 'text-outline'
  const pct = (score / max) * 100
  if (pct >= 80) return 'text-emerald-600'
  if (pct >= 65) return 'text-primary'
  if (pct >= 50) return 'text-amber-600'
  return 'text-error'
}

export default function Tests() {
  const [tests, setTests] = useState<Test[]>([])
  const [classes, setClasses] = useState<ClassLite[]>([])
  const [filterClassId, setFilterClassId] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingTest, setEditingTest] = useState<Test | null>(null)
  const [openTest, setOpenTest] = useState<Test | null>(null)

  const loadClasses = () => {
    api.get('/classes').then(r => setClasses(Array.isArray(r.data) ? r.data : (r.data?.data ?? []))).catch(() => setClasses([]))
  }
  const loadTests = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterClassId && filterClassId !== '__private__') params.set('classId', filterClassId)
    api.get(`/tests?${params.toString()}`)
      .then(r => setTests(Array.isArray(r.data) ? r.data : []))
      .catch(() => setTests([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadClasses() }, [])
  useEffect(() => { loadTests() }, [filterClassId])

  // Lọc client-side cho pill "Học riêng" — bài KT không thuộc danh sách lớp đã đăng ký
  const visibleTests = useMemo(() => {
    if (filterClassId !== '__private__') return tests
    const ids = new Set(classes.map(c => c.id))
    return tests.filter(t => !ids.has(t.classId))
  }, [tests, classes, filterClassId])

  return (
    <div className="space-y-6">
      <TopBar title="Điểm kiểm tra" />

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Đánh giá kết quả</span>
          <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Điểm kiểm tra</h2>
        </div>
        <button
          onClick={() => { setEditingTest(null); setShowCreate(true) }}
          className="btn-primary text-sm"
        >
          <span className="material-symbols-outlined text-base">add</span>
          Thêm bài KT
        </button>
      </div>

      <div className="bg-surface-container-low/60 rounded-2xl p-4">
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
            {classes.map(c => (
              <button
                key={c.id}
                onClick={() => setFilterClassId(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  filterClassId === c.id
                    ? 'bg-primary text-on-primary border-primary shadow-sm'
                    : 'bg-surface text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary'
                }`}
              >
                {c.name}
              </button>
            ))}
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
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
        </div>
      ) : visibleTests.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-16 text-center shadow-sm">
          <span className="material-symbols-outlined text-6xl text-outline/40 block mb-3">quiz</span>
          <p className="text-base font-semibold text-on-surface mb-1">Chưa có bài kiểm tra nào</p>
          <p className="text-sm text-outline">Bấm "Thêm bài KT" để tạo bài kiểm tra đầu tiên.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleTests.map(t => (
            <article
              key={t.id}
              onClick={() => setOpenTest(t)}
              className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer border border-transparent hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-headline font-bold text-on-surface truncate">{t.name}</h3>
                  <p className="text-xs text-outline mt-0.5">{fmtDate(t.testDate)} · {t.className}</p>
                </div>
                <span className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-bold">{t.maxScore}đ</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase font-bold text-outline tracking-wider">Đã chấm</p>
                  <p className="font-bold text-on-surface">{t.submissionCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-outline tracking-wider">Điểm TB</p>
                  <p className={`font-bold ${scoreColor(t.averageScore ?? 0, t.maxScore)}`}>
                    {t.submissionCount ? (t.averageScore ?? 0).toFixed(2) : '—'}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {showCreate && (
        <TestFormModal
          editing={editingTest}
          classes={classes}
          onClose={() => { setShowCreate(false); setEditingTest(null) }}
          onSaved={(test) => {
            setShowCreate(false)
            setEditingTest(null)
            loadTests()
            if (!editingTest) setOpenTest(test)
          }}
        />
      )}

      {openTest && (
        <ScoreEntryModal
          test={openTest}
          onClose={() => setOpenTest(null)}
          onSaved={() => { loadTests() }}
          onEdit={() => { setEditingTest(openTest); setOpenTest(null); setShowCreate(true) }}
          onDeleted={() => { setOpenTest(null); loadTests() }}
        />
      )}
    </div>
  )
}

// ─── Test create / edit modal ───────────────────────────────────────────────

function TestFormModal({ editing, classes, onClose, onSaved }: {
  editing: Test | null
  classes: ClassLite[]
  onClose: () => void
  onSaved: (t: Test) => void
}) {
  const alert = useAlert()
  const [name, setName] = useState(editing?.name ?? '')
  const [testDate, setTestDate] = useState(editing?.testDate ?? new Date().toISOString().slice(0, 10))
  const [classId, setClassId] = useState(editing?.classId ?? '')
  const [maxScore, setMaxScore] = useState(String(editing?.maxScore ?? 10))
  const [teacherName, setTeacherName] = useState(editing?.teacherName ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { await alert({ title: 'Thiếu tên bài', message: 'Nhập tên bài kiểm tra.' }); return }
    if (!classId) { await alert({ title: 'Chưa chọn lớp', message: 'Chọn lớp cho bài kiểm tra.' }); return }
    const m = Number(maxScore)
    if (!Number.isFinite(m) || m <= 0) { await alert({ title: 'Thang điểm không hợp lệ', message: 'Phải là số > 0.' }); return }

    const cls = classes.find(c => c.id === classId)
    const payload = {
      name: name.trim(),
      testDate,
      classId,
      className: cls?.name,
      gradeLevel: cls?.gradeLevel,
      maxScore: m,
      teacherName: teacherName.trim() || undefined,
      notes: notes.trim() || undefined,
    }

    setSaving(true)
    try {
      const res = editing
        ? await api.put(`/tests/${editing.id}`, payload)
        : await api.post('/tests', payload)
      onSaved(res.data)
    } catch (err: any) {
      await alert({ title: 'Lỗi', message: err?.response?.data?.message ?? 'Không lưu được bài kiểm tra.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h3 className="font-headline text-lg font-bold text-on-surface">
          {editing ? 'Sửa bài kiểm tra' : 'Thêm bài kiểm tra'}
        </h3>

        <div>
          <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Tên bài</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} required
            placeholder="VD: KT 15 phút - Hàm số bậc 2"
            className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Ngày KT</label>
            <input type="date" value={testDate} onChange={e => setTestDate(e.target.value)} required
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Thang điểm</label>
            <input type="number" step="1" min="1" value={maxScore} onChange={e => setMaxScore(e.target.value)} required
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Lớp</label>
          <select value={classId} onChange={e => setClassId(e.target.value)} required
            className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
            <option value="">— Chọn lớp —</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Giáo viên <span className="text-outline/50 font-normal normal-case">(không bắt buộc)</span></label>
          <input type="text" value={teacherName} onChange={e => setTeacherName(e.target.value)}
            className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>

        <div>
          <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Ghi chú chung <span className="text-outline/50 font-normal normal-case">(không bắt buộc)</span></label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 btn-secondary justify-center">Huỷ</button>
          <button type="submit" disabled={saving} className="flex-1 btn-primary justify-center disabled:opacity-60">
            {saving ? 'Đang lưu...' : (editing ? 'Cập nhật' : 'Tạo bài KT')}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Score entry modal (one row per student in class) ───────────────────────

function ScoreEntryModal({ test, onClose, onSaved, onEdit, onDeleted }: {
  test: Test
  onClose: () => void
  onSaved: () => void
  onEdit: () => void
  onDeleted: () => void
}) {
  const alert = useAlert()
  const confirm = useConfirm()
  const [rows, setRows] = useState<ScoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    api.get(`/tests/${test.id}/scores`)
      .then(r => setRows((r.data?.rows ?? []).map((x: any) => ({
        studentId: x.studentId,
        studentName: x.studentName,
        scoreId: x.scoreId,
        score: x.score,
        notes: x.notes ?? '',
      }))))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [test.id])

  const updateRow = (idx: number, patch: Partial<ScoreRow>) => {
    setDirty(true)
    setRows(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  const filled = rows.filter(r => r.score !== null && r.score !== undefined && (r.score as any) !== '' && Number.isFinite(Number(r.score))).length
  const sum = rows.reduce((s, r) => (r.score != null && Number.isFinite(Number(r.score)) ? s + Number(r.score) : s), 0)
  const avg = filled > 0 ? sum / filled : 0

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        scores: rows.map(r => ({
          studentId: r.studentId,
          score: (r.score as any) === '' ? null : r.score,
          notes: r.notes,
        })),
      }
      await api.put(`/tests/${test.id}/scores`, payload)
      setDirty(false)
      onSaved()
      onClose()
    } catch (err: any) {
      await alert({ title: 'Lỗi lưu điểm', message: err?.response?.data?.message ?? 'Không lưu được. Thử lại.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Xoá bài kiểm tra',
      message: `Xoá bài "${test.name}"? Toàn bộ điểm của học viên trong bài này cũng sẽ bị xoá.`,
      confirmLabel: 'Xoá',
      danger: true,
    })
    if (!ok) return
    try {
      await api.delete(`/tests/${test.id}`)
      onDeleted()
    } catch {
      await alert({ title: 'Lỗi', message: 'Không xoá được bài kiểm tra.' })
    }
  }

  const tryClose = async () => {
    if (!dirty) { onClose(); return }
    const ok = await confirm({
      title: 'Bỏ thay đổi?',
      message: 'Có điểm chưa lưu. Bạn có chắc muốn đóng?',
      confirmLabel: 'Đóng',
      danger: true,
    })
    if (ok) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={tryClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="p-6 border-b border-outline-variant/10">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <h3 className="font-headline text-xl font-bold text-on-surface">{test.name}</h3>
              <p className="text-sm text-outline mt-1">
                {fmtDate(test.testDate)} · {test.className} · Thang điểm {test.maxScore}
                {test.teacherName ? ` · GV ${test.teacherName}` : ''}
              </p>
              {test.notes && <p className="text-sm text-on-surface-variant mt-2">{test.notes}</p>}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={onEdit} className="p-2 hover:bg-primary/10 text-outline hover:text-primary rounded-lg transition-colors" title="Sửa thông tin bài">
                <span className="material-symbols-outlined text-base">edit</span>
              </button>
              <button onClick={handleDelete} className="p-2 hover:bg-error/10 text-outline hover:text-error rounded-lg transition-colors" title="Xoá bài">
                <span className="material-symbols-outlined text-base">delete</span>
              </button>
              <button onClick={tryClose} className="p-2 hover:bg-surface-container-low text-outline hover:text-on-surface rounded-lg transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </div>
          {!loading && rows.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="bg-surface-container-low rounded-xl p-3 text-center">
                <p className="text-[10px] uppercase font-bold text-outline tracking-wider">Đã chấm</p>
                <p className="font-bold text-on-surface">{filled}/{rows.length}</p>
              </div>
              <div className="bg-surface-container-low rounded-xl p-3 text-center">
                <p className="text-[10px] uppercase font-bold text-outline tracking-wider">Điểm TB</p>
                <p className={`font-bold ${scoreColor(avg, test.maxScore)}`}>{filled ? avg.toFixed(2) : '—'}</p>
              </div>
              <div className="bg-surface-container-low rounded-xl p-3 text-center">
                <p className="text-[10px] uppercase font-bold text-outline tracking-wider">Đạt ≥ 5</p>
                <p className="font-bold text-emerald-600">
                  {rows.filter(r => Number(r.score) >= test.maxScore / 2).length}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-outline text-center py-8">Lớp này chưa có học viên đang học.</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-outline-variant/10 text-[10px] uppercase font-bold text-outline tracking-widest">
                  <th className="pb-3 pr-4">Học viên</th>
                  <th className="pb-3 pr-4 w-32">Điểm (/{test.maxScore})</th>
                  <th className="pb-3">Ghi chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/5">
                {rows.map((r, i) => (
                  <tr key={r.studentId}>
                    <td className="py-2 pr-4 text-sm font-medium">{r.studentName}</td>
                    <td className="py-2 pr-4">
                      <input
                        type="number" step="0.25" min="0" max={test.maxScore}
                        value={r.score ?? ''}
                        onChange={e => {
                          const v = e.target.value
                          updateRow(i, { score: v === '' ? null : (Number(v) as any) })
                        }}
                        placeholder="—"
                        className={`w-24 bg-surface-container-low border-none rounded-lg py-1.5 px-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 ${scoreColor(Number(r.score ?? 0), test.maxScore)}`}
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="text"
                        value={r.notes}
                        onChange={e => updateRow(i, { notes: e.target.value })}
                        placeholder="Ghi chú riêng..."
                        className="w-full bg-surface-container-low border-none rounded-lg py-1.5 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-outline-variant/10 flex justify-end gap-3">
          <button onClick={tryClose} className="btn-secondary">Đóng</button>
          <button onClick={save} disabled={saving || !dirty} className="btn-primary disabled:opacity-50">
            <span className="material-symbols-outlined text-lg">save</span>
            {saving ? 'Đang lưu...' : 'Lưu điểm'}
          </button>
        </div>
      </div>
    </div>
  )
}
