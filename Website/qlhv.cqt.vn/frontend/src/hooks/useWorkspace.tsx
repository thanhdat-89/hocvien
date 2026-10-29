import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import api, { BRANCH_KEY, SCHOOL_YEAR_KEY } from '../services/api'

// ─── Cơ sở & năm học đang xem ─────────────────────────────────
// Lựa chọn nằm trong localStorage; services/api gửi kèm mọi request (X-Branch-Id, X-School-Year-Id).
// Đổi lựa chọn thì tải lại trang để mọi trang đọc lại dữ liệu theo phạm vi mới.

export interface Branch { id: string; name: string; address?: string | null; phone?: string | null; isActive: boolean
  counts?: { students: number; classes: number; users: number; teachers: number } }
export interface SchoolYear { id: string; name: string; startDate: string; endDate: string; status: 'UPCOMING' | 'CURRENT' | 'CLOSED'; classCount: number }

interface WorkspaceValue {
  branches: Branch[]
  years: SchoolYear[]
  /** '' = mọi cơ sở được phép */
  branchId: string
  /** Năm học đang xem (mặc định năm đang chạy) */
  year: SchoolYear | null
  setBranch: (id: string) => void
  setYear: (id: string) => void
  reload: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)
const read = (key: string) => { try { return localStorage.getItem(key) || '' } catch { return '' } }
const choose = (key: string, value: string) => {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key) } catch { /* bỏ qua */ }
  window.location.reload()
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [years, setYears] = useState<SchoolYear[]>([])
  const branchId = read(BRANCH_KEY), yearId = read(SCHOOL_YEAR_KEY)

  const reload = useCallback(async () => {
    const [b, y] = await Promise.all([api.get<Branch[]>('/branches'), api.get<SchoolYear[]>('/school-years')])
    setBranches(b.data); setYears(y.data)
    // Lựa chọn cũ không còn hợp lệ (bị gỡ phân công, cơ sở ngừng, năm bị xoá): về mặc định
    if (branchId && !b.data.some(x => x.id === branchId && x.isActive)) choose(BRANCH_KEY, '')
    else if (yearId && !y.data.some(x => x.id === yearId)) choose(SCHOOL_YEAR_KEY, '')
  }, [branchId, yearId])
  useEffect(() => { reload().catch(() => {}) }, [reload])

  const year = years.find(y => y.id === yearId) ?? years.find(y => y.status === 'CURRENT') ?? null
  return (
    <WorkspaceContext.Provider value={{
      branches, years, branchId, year, reload,
      setBranch: id => choose(BRANCH_KEY, id),
      setYear: id => choose(SCHOOL_YEAR_KEY, years.find(y => y.id === id)?.status === 'CURRENT' ? '' : id),
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
