import { randomInt } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

// ─── Prisma client (PostgreSQL `qlhv`) ────────────────────────
// Một client cho cả tiến trình; khi chạy dev bằng tsx watch, giữ lại qua các lần nạp lại module.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
export const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

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
