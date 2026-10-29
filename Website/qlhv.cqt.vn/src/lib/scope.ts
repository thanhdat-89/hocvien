import { AsyncLocalStorage } from 'node:async_hooks'

// ─── Phạm vi cơ sở của request ────────────────────────────────
// authenticate() đặt phạm vi cho cả request; Prisma client (lib/db) tự thêm điều kiện cơ sở vào mọi truy vấn
// của học viên, lớp và dữ liệu con. Không có phạm vi (cron, webhook, trang phụ huynh) = không lọc.

export interface Scope {
  /** null = mọi cơ sở (ADMIN không chọn cơ sở cụ thể) */
  branchIds: string[] | null
  /** Năm học đang xem; null = năm học đang chạy. Chỉ áp cho danh sách lớp, không áp ở tầng Prisma. */
  schoolYearId: string | null
}

const storage = new AsyncLocalStorage<Scope>()

export const currentScope = (): Scope | undefined => storage.getStore()
export const runInScope = <T>(scope: Scope, fn: () => T): T => storage.run(scope, fn)

/** Khoá cache cho dữ liệu đọc theo phạm vi (readViews) */
export const scopeKey = (scope = currentScope()) => `${scope?.branchIds?.slice().sort().join(',') ?? '*'}|${scope?.schoolYearId ?? 'current'}`
