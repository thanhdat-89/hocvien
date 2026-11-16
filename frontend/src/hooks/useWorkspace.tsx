import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import api, { SCHOOL_YEAR_KEY } from '../services/api'

// ─── Cơ sở làm việc & năm học đang xem ────────────────────────
// Cơ sở làm việc lưu ở tài khoản (Cài đặt → Tài khoản của tôi), server tự áp cho mọi request.
// Năm học nằm trong localStorage, services/api gửi kèm (X-School-Year-Id). Đổi một trong hai thì tải lại trang.

export interface Branch { id: string; name: string; address?: string | null; phone?: string | null; isActive: boolean
  counts?: { students: number; classes: number; users: number; teachers: number } }
export interface SchoolYear { id: string; name: string; startDate: string; endDate: string; status: 'UPCOMING' | 'CURRENT' | 'CLOSED'; classCount: number }

interface WorkspaceValue {
  branches: Branch[]
  years: SchoolYear[]
  /** Cơ sở đang làm việc ('' khi chưa được phân công cơ sở nào) */
  branchId: string
  /** Các cơ sở được làm việc (chọn cơ sở làm việc, cơ sở áp dụng ngày nghỉ) */
  allowedBranchIds: string[]
  /** Năm học đang xem (mặc định năm đang chạy) */
  year: SchoolYear | null
  setBranch: (id: string) => Promise<void>
  setYear: (id: string) => void
  reload: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)
const read = (key: string) => { try { return localStorage.getItem(key) || '' } catch { return '' } }
const chooseYear = (value: string) => {
  try { if (value) localStorage.setItem(SCHOOL_YEAR_KEY, value); else localStorage.removeItem(SCHOOL_YEAR_KEY) } catch { /* bỏ qua */ }
  window.location.reload()
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [years, setYears] = useState<SchoolYear[]>([])
  const [branchId, setBranchId] = useState('')
  const [allowedBranchIds, setAllowed] = useState<string[]>([])
  const yearId = read(SCHOOL_YEAR_KEY)

  const reload = useCallback(async () => {
    const [b, y, me] = await Promise.all([api.get<Branch[]>('/branches'), api.get<SchoolYear[]>('/school-years'),
      api.get<{ workingBranchId: string | null; allowedBranchIds: string[] }>('/auth/me')])
    setBranches(b.data); setYears(y.data); setBranchId(me.data.workingBranchId ?? ''); setAllowed(me.data.allowedBranchIds)
    // Năm học đã chọn bị xoá: về năm đang chạy
    if (yearId && !y.data.some(x => x.id === yearId)) chooseYear('')
  }, [yearId])
  useEffect(() => { reload().catch(() => {}) }, [reload])
  // Bỏ lựa chọn cơ sở cũ trên trình duyệt (trước đây chọn ở thanh trên cùng)
  useEffect(() => { try { localStorage.removeItem('qlhv.branch') } catch { /* bỏ qua */ } }, [])

  const year = years.find(y => y.id === yearId) ?? years.find(y => y.status === 'CURRENT') ?? null
  return (
    <WorkspaceContext.Provider value={{
      branches, years, branchId, allowedBranchIds, year, reload,
      setBranch: async id => { await api.put('/auth/me', { defaultBranchId: id }); window.location.reload() },
      setYear: id => chooseYear(years.find(y => y.id === id)?.status === 'CURRENT' ? '' : id),
    }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}
