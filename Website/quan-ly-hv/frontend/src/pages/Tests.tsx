import React, { useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import { useAlert } from '../components/ConfirmDialog'
import api from '../services/api'

interface Row {
  id: string
  studentId: string
  studentName: string
  classId: string
  className: string
  year: number
  month: number
  expectedCount: number
  scores: (number | null)[]
  notes?: string
  updatedAt?: string
}

interface ListResponse { year: number; month: number; rows: Row[] }

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const MAX_SCORE = 10
const PRIVATE_ID = 'private'

const fmtScore = (n: number | null): string => {
  if (n == null) return ''
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

const scoreColor = (s: number | null) => {
  if (s == null) return ''
  if (s >= 8) return 'text-emerald-600'
  if (s >= 6.5) return 'text-primary'
  if (s >= 5) return 'text-amber-600'
  return 'text-rose-600'
}

const fmtClock = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const cellKey = (rowId: string, idx: number | 'notes') => `${rowId}_${idx}`

export default function Tests() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [classFilter, setClassFilter] = useState<string>('') // '' = tất cả
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const alert = useAlert()

  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})
  const [globalSavedAt, setGlobalSavedAt] = useState<string>('')

  const [notesOpen, setNotesOpen] = useState<string | null>(null)

  const debouncers = useRef<Record<string, number>>({})

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) })
      if (classFilter) params.set('classId', classFilter)
      const res = await api.get(`/monthly-scores?${params.toString()}`)
      const data = res.data as ListResponse
      setRows(data.rows ?? [])
    } catch (err: any) {
      await alert({ title: 'Lỗi tải dữ liệu', message: err?.response?.data?.message ?? 'Không tải được điểm tháng này.' })
      setRows([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year, month, classFilter])

  const classPills = useMemo(() => {
    const seen = new Map<string, string>()
    rows.forEach(r => { if (!seen.has(r.classId)) seen.set(r.classId, r.className) })
    return [...seen.entries()].sort((a, b) => {
      if (a[0] === PRIVATE_ID) return 1
      if (b[0] === PRIVATE_ID) return -1
      return a[1].localeCompare(b[1], 'vi')
    })
  }, [rows])

  const maxCols = useMemo(() => rows.reduce((m, r) => Math.max(m, r.expectedCount), 0), [rows])

  const queueSave = (rowId: string, payload: object, key: number | 'notes') => {
    const k = cellKey(rowId, key)
    setSaveStates(s => ({ ...s, [k]: 'saving' }))
    if (debouncers.current[k]) window.clearTimeout(debouncers.current[k])
    debouncers.current[k] = window.setTimeout(async () => {
      try {
        const res = await api.put(`/monthly-scores/${rowId}`, payload)
        setRows(rs => rs.map(r => r.id === rowId ? { ...r, updatedAt: res.data.updatedAt } : r))
        setSaveStates(s => ({ ...s, [k]: 'saved' }))
        setGlobalSavedAt(new Date().toISOString())
        window.setTimeout(() => setSaveStates(s => ({ ...s, [k]: 'idle' })), 1200)
      } catch (err: any) {
        setSaveStates(s => ({ ...s, [k]: 'error' }))
        await alert({ title: 'Không lưu được', message: err?.response?.data?.message ?? 'Thử lại.' })
      }
    }, 450)
  }

  const setCell = (rowId: string, idx: number, raw: string) => {
    const trimmed = raw.trim()
    let next: number | null = null
    if (trimmed !== '') {
      const n = Number(trimmed.replace(',', '.'))
      if (!Number.isFinite(n) || n < 0 || n > MAX_SCORE) return
      next = Math.round(n * 4) / 4
    }
    setRows(rs => rs.map(r => {
      if (r.id !== rowId) return r
      const newScores = r.scores.slice()
      newScores[idx] = next
      return { ...r, scores: newScores }
    }))
    queueSave(rowId, { index: idx, score: next }, idx)
  }

  const setNotes = (rowId: string, value: string) => {
    setRows(rs => rs.map(r => r.id === rowId ? { ...r, notes: value } : r))
    queueSave(rowId, { notes: value }, 'notes')
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const years = Array.from({ length: 6 }, (_, i) => today.getFullYear() - 2 + i)

  return (
    <div className="space-y-6">
      <TopBar title="Điểm kiểm tra" />

      <div className="bg-surface rounded-3xl p-6 md:p-8 shadow-sm">
        <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">Đánh giá theo tháng</p>
            <h2 className="font-headline text-2xl font-bold text-on-surface">Điểm kiểm tra</h2>
          </div>
          {globalSavedAt && (
            <span className="inline-flex items-center gap-1 text-xs text-outline pt-2">
              <span className="material-symbols-outlined text-emerald-500" style={{ fontSize: 18 }}>check_circle</span>
              Đã lưu lúc {fmtClock(globalSavedAt)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-4 mb-4 flex-wrap">
          <span className="text-[10px] font-bold text-outline uppercase tracking-wider">Tháng</span>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="input w-auto py-1.5">
            {months.map(m => <option key={m} value={m}>T{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="input w-auto py-1.5">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="flex items-start gap-2 mb-6 flex-wrap">
          <span className="text-[10px] font-bold text-outline uppercase tracking-wider w-12 pt-2 shrink-0">Lớp</span>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setClassFilter('')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                classFilter === '' ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-outline hover:bg-surface-container'
              }`}>
              Tất cả
            </button>
            {classPills.map(([cid, cname]) => (
              <button key={cid} onClick={() => setClassFilter(cid)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  classFilter === cid
                    ? (cid === PRIVATE_ID ? 'bg-tertiary text-on-tertiary' : 'bg-primary text-on-primary')
                    : (cid === PRIVATE_ID ? 'bg-tertiary/10 text-tertiary hover:bg-tertiary/20' : 'bg-surface-container-low text-outline hover:bg-surface-container')
                }`}>
                {cname}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/50">
                <th className="table-header w-12 text-center">STT</th>
                <th className="table-header min-w-[200px]">Học viên / Lớp</th>
                {Array.from({ length: maxCols }, (_, i) => (
                  <th key={i} className="table-header text-center w-16 px-1">KT{i + 1}</th>
                ))}
                <th className="table-header text-center w-16">TB</th>
                <th className="table-header text-center w-12">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {loading ? (
                <tr>
                  <td colSpan={maxCols + 4} className="py-16 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={maxCols + 4} className="py-16 text-center text-outline">
                    <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">grading</span>
                    Tháng này chưa có buổi học nào
                  </td>
                </tr>
              ) : rows.map((r, i) => {
                const valid = r.scores.filter((x): x is number => x != null)
                const avg = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null
                return (
                  <tr key={r.id} className="hover:bg-surface-container-low/30 transition-colors">
                    <td className="table-cell text-center text-sm text-outline font-medium">{i + 1}</td>
                    <td className="table-cell">
                      <p className="font-semibold text-on-surface text-sm">{r.studentName}</p>
                      <p className={`text-[11px] ${r.classId === PRIVATE_ID ? 'text-tertiary' : 'text-outline'}`}>{r.className}</p>
                    </td>
                    {Array.from({ length: maxCols }, (_, ci) => {
                      const inRange = ci < r.expectedCount
                      const k = cellKey(r.id, ci)
                      const state = saveStates[k]
                      const value = r.scores[ci] ?? null
                      return (
                        <td key={ci} className="table-cell text-center px-1 align-middle">
                          {inRange ? (
                            <div className="relative inline-block">
                              <input
                                key={`${r.updatedAt ?? ''}_${ci}_${value ?? ''}`}
                                type="text"
                                inputMode="decimal"
                                defaultValue={fmtScore(value)}
                                onBlur={e => setCell(r.id, ci, e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                className={`w-14 text-center bg-surface-container-low/60 rounded-md py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30 ${scoreColor(value)} ${state === 'error' ? 'ring-2 ring-rose-300' : ''}`}
                              />
                              {state === 'saving' && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                              )}
                              {state === 'saved' && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500" />
                              )}
                            </div>
                          ) : (
                            <span className="text-outline/40 text-sm">—</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="table-cell text-center">
                      {avg != null ? (
                        <span className={`text-sm font-bold ${scoreColor(avg)}`}>{avg.toFixed(1)}</span>
                      ) : <span className="text-outline/40 text-sm">—</span>}
                    </td>
                    <td className="table-cell text-center">
                      <button
                        onClick={() => setNotesOpen(notesOpen === r.id ? null : r.id)}
                        className={`p-1.5 rounded-lg hover:bg-surface-container-low transition-colors ${r.notes ? 'text-primary' : 'text-outline'}`}
                        title={r.notes || 'Thêm ghi chú'}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{r.notes ? 'edit_note' : 'note_add'}</span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {notesOpen && (() => {
        const row = rows.find(r => r.id === notesOpen)
        if (!row) return null
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setNotesOpen(null)}>
            <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-xl w-full max-w-md">
              <div className="p-5 border-b border-outline-variant/10">
                <h3 className="font-bold text-base text-on-surface">Ghi chú tháng {month}/{year}</h3>
                <p className="text-xs text-outline mt-0.5">{row.studentName} · {row.className}</p>
              </div>
              <div className="p-5">
                <textarea
                  defaultValue={row.notes ?? ''}
                  onBlur={e => setNotes(row.id, e.target.value)}
                  rows={5}
                  placeholder="VD: Con tiến bộ, cần ôn thêm phần hình học..."
                  className="input min-h-[120px]"
                />
                <p className="text-[11px] text-outline mt-2">Tự lưu khi anh/chị bấm ra ngoài hoặc đóng cửa sổ.</p>
              </div>
              <div className="p-5 pt-0 flex justify-end">
                <button onClick={() => setNotesOpen(null)} className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors">
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
