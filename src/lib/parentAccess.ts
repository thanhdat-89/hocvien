import { createHmac, timingSafeEqual } from 'node:crypto'

// Khoá trang chia sẻ phụ huynh (cqt.vn/hoc-vien/<id>) bằng SĐT Zalo phụ huynh.
// Token do server ký HMAC, lưu ở localStorage trình duyệt phụ huynh → thiết bị cũ không phải nhập lại.
// Token phụ huynh gắn với dấu vân tay của SĐT đã xác minh: admin đổi / xoá số đó trong qlhv → token tự hết hiệu lực.

const PARENT_TTL_MS = 365 * 24 * 3600_000
const ADMIN_TTL_MS = 30 * 24 * 3600_000

export type ParentAccessRole = 'parent' | 'admin'
export interface ParentAccessToken { sid: string; role: ParentAccessRole; ph?: string; exp: number }

const key = () => createHmac('sha256', process.env.PARENT_TOKEN_SECRET || process.env.JWT_SECRET || 'change-this-secret')
  .update('cqt-parent-access-v1').digest()

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')
const sign = (data: string) => createHmac('sha256', key()).update(data).digest('base64url')

/** SĐT Việt Nam 10 số bắt đầu bằng 0; chấp nhận +84 / 84, khoảng trắng, dấu chấm, gạch. Không hợp lệ → null. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  let digits = String(raw).replace(/[\s.\-()]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  if (/^84\d{9}$/.test(digits)) digits = '0' + digits.slice(2)
  return /^0\d{9}$/.test(digits) ? digits : null
}

/** Mọi SĐT hợp lệ (phone, zalo) của các phụ huynh một học viên. */
export function studentPhones(parents: Array<{ phone?: string | null; zalo?: string | null }>): Set<string> {
  const set = new Set<string>()
  for (const p of parents) for (const v of [p.phone, p.zalo]) {
    const n = normalizePhone(v)
    if (n) set.add(n)
  }
  return set
}

export const phoneTag = (phone: string) => sign('phone:' + phone).slice(0, 22)

export function signParentToken(sid: string, role: ParentAccessRole, phone?: string, now = Date.now()): string {
  const payload: ParentAccessToken = role === 'admin'
    ? { sid: '*', role, exp: now + ADMIN_TTL_MS }
    : { sid, role, ph: phoneTag(phone!), exp: now + PARENT_TTL_MS }
  const body = b64(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

export function verifyParentToken(token: unknown, now = Date.now()): ParentAccessToken | null {
  if (typeof token !== 'string') return null
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = Buffer.from(sign(body))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as ParentAccessToken
    return typeof payload.exp === 'number' && payload.exp > now ? payload : null
  } catch { return null }
}

/** Token còn mở được trang của học viên này không (SĐT gắn token vẫn còn trong hồ sơ). */
export function tokenGrants(payload: ParentAccessToken | null, studentId: string, phones: Set<string>): boolean {
  if (!payload) return false
  if (payload.role === 'admin') return payload.sid === '*'
  if (payload.sid !== studentId || !payload.ph) return false
  for (const p of phones) if (phoneTag(p) === payload.ph) return true
  return false
}

export function isAdminPassword(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw) return false
  const expected = Buffer.from(process.env.PARENT_ADMIN_PASSWORD || 'cqt.vn')
  const given = Buffer.from(raw.trim())
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Bỏ dấu, chữ thường, gộp khoảng trắng: "Nguyễn  Đức An" → "nguyen duc an". */
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Mỗi từ của câu tìm phải là đầu của một từ trong tên: "an" khớp "Nguyễn Văn An", "nguyen an". */
export function nameMatches(fullName: string, query: string): boolean {
  const words = foldName(fullName).split(' ')
  const terms = foldName(query).split(' ').filter(Boolean)
  return terms.length > 0 && terms.every(t => words.some(w => w.startsWith(t)))
}

// ─── Giới hạn tần suất trong bộ nhớ (backend chạy MỘT tiến trình PM2) ───────
const buckets = new Map<string, { count: number; resetAt: number }>()

/** Ghi nhận một lượt; trả về true nếu đã VƯỢT giới hạn. */
export function hitLimit(bucketKey: string, max: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(bucketKey)
  if (!b || b.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs })
    if (buckets.size > 20_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
    return false
  }
  b.count++
  return b.count > max
}

/** Đã vượt giới hạn chưa, không tính thêm lượt. */
export function isLimited(bucketKey: string, max: number, now = Date.now()): boolean {
  const b = buckets.get(bucketKey)
  return !!b && b.resetAt > now && b.count >= max
}

export function clearLimit(bucketKey: string) { buckets.delete(bucketKey) }
export function resetAllLimits() { buckets.clear() }
