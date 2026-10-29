import { Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/db'
import { runInScope, type Scope } from '../lib/scope'
import { AuthRequest, AuthPayload } from '../types'

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret'

// Token sống 7 ngày; đọc lại trạng thái tài khoản để khoá / đổi vai trò / đổi cơ sở có hiệu lực ngay
// (cache ngắn, xoá khi /api/users hoặc Cài đặt → Cơ sở sửa).
const ACCOUNT_TTL = 30_000
const accounts = new Map<string, { isActive: boolean; role: AuthPayload['role']; branchIds: string[]; at: number }>()
export const forgetAccount = (userId: string) => { accounts.delete(userId) }

async function currentAccount(userId: string) {
  const cached = accounts.get(userId)
  if (cached && Date.now() - cached.at < ACCOUNT_TTL) return cached
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true, branches: { select: { branchId: true } } } })
  if (!user) { accounts.delete(userId); return null }
  const entry = { isActive: user.isActive, role: user.role, branchIds: user.branches.map(b => b.branchId), at: Date.now() }
  accounts.set(userId, entry)
  return entry
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Thiếu token xác thực' })
    return
  }

  const token = header.slice(7)
  let payload: AuthPayload
  try {
    payload = jwt.verify(token, JWT_SECRET) as AuthPayload
  } catch {
    res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn' })
    return
  }
  currentAccount(payload.userId).then(account => {
    if (!account?.isActive) {
      res.status(401).json({ message: 'Tài khoản đã bị khoá' })
      return
    }
    req.user = { userId: payload.userId, role: account.role }
    const scope = requestScope(req, account)
    if (!scope) { res.status(403).json({ message: 'Không có quyền với cơ sở này' }); return }
    runInScope(scope, next)
  }, next)
}

/**
 * Phạm vi cơ sở: header X-Branch-Id (bỏ trống / "all" = mọi cơ sở được phép), X-School-Year-Id (bỏ trống = năm đang chạy).
 * ADMIN xem mọi cơ sở; người khác chỉ các cơ sở được phân công. null = chọn cơ sở ngoài quyền.
 */
function requestScope(req: AuthRequest, account: { role: AuthPayload['role']; branchIds: string[] }): Scope | null {
  const header = (name: string) => { const v = req.headers[name]; return (Array.isArray(v) ? v[0] : v)?.trim() || '' }
  const branch = header('x-branch-id'), schoolYearId = header('x-school-year-id') || null
  const admin = account.role === 'ADMIN'
  if (!branch || branch === 'all') return { branchIds: admin ? null : account.branchIds, schoolYearId }
  if (!admin && !account.branchIds.includes(branch)) return null
  return { branchIds: [branch], schoolYearId }
}

export function requireRole(...roles: AuthPayload['role'][]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: 'Không có quyền truy cập' })
      return
    }
    next()
  }
}
