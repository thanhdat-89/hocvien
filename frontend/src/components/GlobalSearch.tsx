import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import type { Student } from '../types'

const RECENT_KEY = 'qlhv.recentStudents'
const RECENT_LIMIT = 6

interface Recent { id: string; fullName: string; detail: string }

const STATUS: Record<Student['status'], { label: string; cls: string }> = {
  ACTIVE: { label: 'Đang học', cls: 'bg-secondary/10 text-secondary' },
  RESERVED: { label: 'Bảo lưu', cls: 'bg-amber-100 text-amber-800' },
  INACTIVE: { label: 'Đã nghỉ', cls: 'bg-slate-100 text-slate-500' },
}

function readRecent(): Recent[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}
function saveRecent(items: Recent[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, RECENT_LIMIT))) } catch { /* bỏ qua */ }
}

function classesOf(student: Student) {
  const names = (student.enrollments ?? []).filter(e => e.status !== 'DROPPED').map(e => e.className)
  return names.length ? names.join(', ') : 'Học riêng'
}

/** Màn hình tìm học viên theo tên hoặc mã, mở được từ mọi trang trên điện thoại. */
export default function GlobalSearch({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Student[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [recent, setRecent] = useState<Recent[]>(readRecent)
  const term = query.trim()

  useEffect(() => {
    inputRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  useEffect(() => {
    if (!term) { setResults([]); setLoading(false); setFailed(false); return }
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: '1', limit: '20', search: term })
      api.get(`/students?${params}`, { signal: controller.signal })
        .then(r => { setResults(r.data.data ?? []); setFailed(false) })
        .catch(error => { if (error.code !== 'ERR_CANCELED') { setResults([]); setFailed(true) } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [term])

  const open = (item: Recent) => {
    const next = [item, ...recent.filter(r => r.id !== item.id)]
    saveRecent(next)
    onClose()
    navigate(`/students/${item.id}`)
  }
  const clearRecent = () => { saveRecent([]); setRecent([]) }

  // Portal: thanh đầu trang dùng backdrop-filter, sẽ giam phần tử fixed bên trong nó.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Tìm học viên" className="fixed inset-0 z-[90] flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-outline-variant/20 bg-white px-2 py-2" style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}>
        <button type="button" onClick={onClose} aria-label="Đóng tìm kiếm"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100">
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </button>
        <div className="relative min-w-0 flex-1">
          <input ref={inputRef} type="text" inputMode="search" value={query} onChange={e => setQuery(e.target.value)}
            enterKeyHint="search" autoComplete="off" aria-label="Tên hoặc mã học viên" placeholder="Tên hoặc mã học viên"
            className="h-11 w-full rounded-full border-none bg-surface-container-low pl-4 pr-11 text-base focus:outline-none focus:ring-2 focus:ring-primary/30" />
          {query && <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus() }} aria-label="Xoá nội dung tìm"
            className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-400">
            <span className="material-symbols-outlined text-xl" aria-hidden="true">close</span>
          </button>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {!term ? (
          recent.length ? <section aria-labelledby="recent-title">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="recent-title" className="text-xs font-semibold uppercase tracking-wider text-outline">Xem gần đây</h2>
              <button type="button" onClick={clearRecent} className="px-2 text-xs font-semibold text-primary">Xoá</button>
            </div>
            <ul className="divide-y divide-outline-variant/15 rounded-2xl bg-white">
              {recent.map(item => <li key={item.id}>
                <button type="button" onClick={() => open(item)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="material-symbols-outlined text-xl text-outline" aria-hidden="true">history</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-on-surface">{item.fullName}</span>
                    <span className="block truncate text-xs text-outline">{item.detail}</span>
                  </span>
                </button>
              </li>)}
            </ul>
          </section>
          : <p className="py-10 text-center text-sm text-outline">Nhập tên hoặc mã học viên để tìm hồ sơ</p>
        ) : loading && !results.length ? (
          <p role="status" className="py-10 text-center text-sm text-outline">Đang tìm…</p>
        ) : failed ? (
          <p role="alert" className="py-10 text-center text-sm text-error">Không tìm được, kiểm tra kết nối rồi thử lại</p>
        ) : !results.length ? (
          <p className="py-10 text-center text-sm text-outline">Không có học viên nào khớp “{term}”</p>
        ) : (
          <ul aria-label="Kết quả tìm kiếm" aria-busy={loading} className="divide-y divide-outline-variant/15 rounded-2xl bg-white">
            {results.map(student => {
              const detail = [student.gradeLevel ? `Khối ${student.gradeLevel}` : '', classesOf(student)].filter(Boolean).join(' · ')
              const status = STATUS[student.status] ?? STATUS.INACTIVE
              return <li key={student.id}>
                <button type="button" onClick={() => open({ id: student.id, fullName: student.fullName, detail })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary" aria-hidden="true">
                    {student.fullName.trim().split(/\s+/).pop()?.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-on-surface">{student.fullName}</span>
                    <span className="block truncate text-xs text-outline">{detail}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>{status.label}</span>
                </button>
              </li>
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  )
}
