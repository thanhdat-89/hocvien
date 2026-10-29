import { randomInt } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { currentScope } from './scope'
import { createError } from '../middleware/errorHandler'

// ─── Prisma client (PostgreSQL `qlhv`) ────────────────────────
// Một client cho cả tiến trình; khi chạy dev bằng tsx watch, giữ lại qua các lần nạp lại module.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const base = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = base

// ─── Lọc theo cơ sở ───────────────────────────────────────────
// Khi request có phạm vi cơ sở (lib/scope), mọi truy vấn của các model dưới đây được thêm điều kiện cơ sở,
// kể cả findUnique / update / delete theo id; tạo hay chuyển bản ghi sang cơ sở ngoài phạm vi bị chặn.
// include / select lồng nhau không bị lọc: dữ liệu con đi theo bản ghi gốc đã lọc.

type Where = Record<string, unknown>
const inBranches = (ids: string[]) => ({ branchId: { in: ids } })
const viaClass = (ids: string[]) => ({ class: inBranches(ids) })
const viaStudent = (ids: string[]) => ({ student: inBranches(ids) })
const SCOPED: Record<string, (ids: string[]) => Where> = {
  Student: inBranches,
  Class: inBranches,
  Lead: ids => ({ OR: [inBranches(ids), { branchId: null }] }),
  Teacher: ids => ({ branches: { some: inBranches(ids) } }),
  Holiday: ids => ({ branches: { some: inBranches(ids) } }),
  MisaInvoice: inBranches,
  ActivityLog: ids => ({ OR: [inBranches(ids), { branchId: null }] }),
  ClassEnrollment: viaClass, Schedule: viaClass, Session: viaClass, ClassTuitionRate: viaClass,
  StudentAttendance: viaClass, TeacherAttendance: viaClass,
  Parent: viaStudent, StudentReview: viaStudent, PrivateSession: viaStudent, TuitionRecord: viaStudent,
  Payment: viaStudent, MonthlyScore: viaStudent, StudentPromotion: viaStudent,
}
/** Khoá ngoại tới bản ghi có cơ sở: không được trỏ sang cơ sở ngoài phạm vi khi tạo / sửa */
const REFS: Record<string, string> = { classId: 'Class', studentId: 'Student', sessionId: 'Session', tuitionRecordId: 'TuitionRecord' }
const FILTERED = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'])
const delegate = (model: string) => (base as unknown as Record<string, { count(args: unknown): Promise<number> }>)[model[0].toLowerCase() + model.slice(1)]

const withScope = (where: Where | undefined, scoped: Where): Where => {
  if (!where) return scoped
  const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND]
  return { ...where, AND: [...and, scoped] } // giữ trường unique ở cấp ngoài cho findUnique / update
}

async function checkWrite(model: string, data: unknown, ids: string[]) {
  for (const row of Array.isArray(data) ? data : data ? [data] : []) {
    const d = row as Record<string, any>
    const branchId = d.branchId ?? d.branch?.connect?.id
    if (['Student', 'Class', 'Lead', 'MisaInvoice'].includes(model) && typeof branchId === 'string' && !ids.includes(branchId)) {
      throw createError('Không có quyền với cơ sở này', 403)
    }
    for (const [field, parent] of Object.entries(REFS)) {
      const id = d[field] ?? d[field.slice(0, -2)]?.connect?.id
      if (typeof id !== 'string' || parent === model) continue
      // Chỉ chặn bản ghi cha thuộc cơ sở khác. Không thấy (vừa tạo trong cùng transaction, chưa commit, hoặc không tồn tại)
      // thì để khoá ngoại của database quyết định.
      if (await delegate(parent).count({ where: { id, NOT: SCOPED[parent](ids) } })) throw createError('Không tìm thấy dữ liệu', 404)
    }
  }
}

/** Học viên chỉ ghi danh vào lớp cùng cơ sở, của năm học chưa đóng (áp dụng cả khi không có phạm vi) */
async function sameBranch(data: unknown) {
  for (const row of Array.isArray(data) ? data : data ? [data] : []) {
    const d = row as Record<string, any>
    const classId = d.classId ?? d.class?.connect?.id, studentId = d.studentId ?? d.student?.connect?.id
    if (typeof classId !== 'string' || typeof studentId !== 'string') continue
    const [klass, student] = await Promise.all([
      base.class.findUnique({ where: { id: classId }, select: { branchId: true, schoolYear: { select: { status: true } } } }),
      base.student.findUnique({ where: { id: studentId }, select: { branchId: true } }),
    ])
    if (klass?.schoolYear.status === 'CLOSED') throw createError('Lớp thuộc năm học đã đóng, không ghi danh thêm được', 409)
    if (klass && student && klass.branchId !== student.branchId) throw createError('Học viên thuộc cơ sở khác với lớp', 400)
  }
}

export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const a = (args ?? {}) as Record<string, any>
        if (model === 'ClassEnrollment' && ['create', 'createMany', 'createManyAndReturn'].includes(operation)) await sameBranch(a.data)
        const rule = SCOPED[model]
        const ids = currentScope()?.branchIds
        if (!rule || !ids) return query(args)
        if (['create', 'createMany', 'createManyAndReturn'].includes(operation)) await checkWrite(model, a.data, ids)
        if (['update', 'updateMany'].includes(operation)) await checkWrite(model, a.data, ids)
        if (operation === 'upsert') { await checkWrite(model, a.create, ids); await checkWrite(model, a.update, ids) }
        if (FILTERED.has(operation)) return query({ ...a, where: withScope(a.where, rule(ids)) } as typeof args)
        return query(args)
      },
    },
  },
})

export type Tx = Parameters<Parameters<typeof prisma['$transaction']>[0]>[0]

// ─── ID ───────────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** ID 20 ký tự cùng dạng auto-ID Firestore, để ID cũ và mới trông như nhau (link phụ huynh, MISA RefID). */
export function newId(): string {
  let id = ''
  for (let i = 0; i < 20; i++) id += ALPHABET[randomInt(ALPHABET.length)]
  return id
}

// ─── Chuyển kết quả sang JSON giống Firestore cũ ──────────────

/** Cột @db.Date — API trả "YYYY-MM-DD" như dữ liệu Firestore trước đây. */
const DATE_ONLY = new Set([
  'enrollmentDate', 'dropDate', 'dateOfBirth', 'startDate', 'endDate', 'sessionDate', 'effectiveFrom', 'effectiveTo',
  'validFrom', 'validTo', 'appliedFrom', 'appliedTo', 'dueDate', 'paymentDate', 'invoiceDate', 'dates',
  'date', // holidays: trường tương thích ngược = startDate
])

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

function convert(value: unknown, key: string): unknown {
  if (value instanceof Date) {
    if (DATE_ONLY.has(key)) return ymd(value)
    // SePay gửi giờ địa phương không kèm múi giờ; cột Timestamp(0) lưu nguyên giá trị đó.
    if (key === 'transactionDate') return `${ymd(value)} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
    return value.toISOString()
  }
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value)) return value.map(v => convert(v, key))
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = convert(v, k)
    return out
  }
  return value
}

/** Đổi Date/BigInt trong kết quả Prisma sang chuỗi/số như API Firestore cũ trả về. */
export function api<T>(value: T): any {
  return convert(value, '')
}

/** "YYYY-MM-DD" từ client → Date cho cột @db.Date; giá trị rỗng → null. */
export function toDay(value: unknown): Date | null {
  if (value == null || value === '') return null
  const s = String(value).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Object.assign(new Error(`Ngày không hợp lệ: ${value}`), { status: 400 })
  return new Date(s + 'T00:00:00Z')
}

// ─── Học riêng ────────────────────────────────────────────────
// Firestore và frontend dùng classId = "private"; PostgreSQL dùng NULL.

export const PRIVATE = 'private'
export const toClassId = (v: unknown): string | null => (v == null || v === '' || v === PRIVATE ? null : String(v))
export const fromClassId = (v: string | null): string => v ?? PRIVATE
