import { Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/db'
import { runInScope, type Scope } from '../lib/scope'
import { AuthRequest, AuthPayload } from '../types'

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret'

// Token sống 7 ngày; đọc lại trạng thái tài khoản để khoá / đổi vai trò / đổi cơ sở có hiệu lực ngay
// (cache ngắn, xoá khi tài khoản, phân công hoặc cơ sở thay đổi).
const ACCOUNT_TTL = 30_000
interface Account { isActive: boolean; role: AuthPayload['role']; allowedBranchIds: string[]; workingBranchId: string | null; at: number }
const accounts = new Map<string, Account>()
export const forgetAccount = (userId: string) => { accounts.delete(userId) }
export const forgetAllAccounts = () => { accounts.clear() }

async function currentAccount(userId: string) {
  const cached = accounts.get(userId)
  if (cached && Date.now() - cached.at < ACCOUNT_TTL) return cached
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true, defaultBranchId: true, branches: { select: { branchId: true } } } })
  if (!user) { accounts.delete(userId); return null }
  const allowed = await allowedBranchIds(user.role, user.branches.map(b => b.branchId))
  const entry: Account = {
    isActive: user.isActive, role: user.role, allowedBranchIds: allowed,
    workingBranchId: user.defaultBranchId && allowed.includes(user.defaultBranchId) ? user.defaultBranchId : allowed[0] ?? null,
    at: Date.now(),
  }
  accounts.set(userId, entry)
  return entry
}

/** Cơ sở đang hoạt động mà tài khoản được làm việc: ADMIN mọi cơ sở, người khác các cơ sở được phân công (cũ nhất trước) */
export async function allowedBranchIds(role: AuthPayload['role'], assigned: string[]) {
  const branches = await prisma.branch.findMany({
    where: { isActive: true, ...(role === 'ADMIN' ? {} : { id: { in: assigned } }) }, orderBy: { createdAt: 'asc' }, select: { id: true },
  })
  return branches.map(b => b.id)
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
    req.branchId = account.workingBranchId
    runInScope(requestScope(req, account), next)
  }, next)
}

/**
 * Phạm vi: đúng một cơ sở làm việc của tài khoản (chưa có cơ sở nào được phép = không thấy dữ liệu);
 * năm học theo X-School-Year-Id (bỏ trống = năm đang chạy).
 */
function requestScope(req: AuthRequest, account: Account): Scope {
  const year = req.headers['x-school-year-id']
  return {
    branchIds: account.workingBranchId ? [account.workingBranchId] : [],
    allowedBranchIds: account.allowedBranchIds,
    schoolYearId: (Array.isArray(year) ? year[0] : year)?.trim() || null,
  }
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
