import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { checkpoint } from '../lib/checkpoint'
import { AuthPayload } from '../types'

/**
 * Tạo điểm khôi phục (pg_dump) TRƯỚC các thao tác xoá / ghi đè hàng loạt. Đặt trước các router, nên tự kiểm token:
 * chỉ request có token hợp lệ mới tạo bản sao lưu (request lạ không làm VPS phải dump); quyền vẫn do router kiểm.
 * Thêm thao tác nguy hiểm mới → thêm một dòng vào RULES.
 */
const RULES: Array<{ method: string; path: RegExp; reason: string }> = [
  { method: 'DELETE', path: /^\/api\/students\/([^/]+)\/hard$/, reason: 'xoa-hoc-vien' },
  { method: 'POST', path: /^\/api\/students\/bulk-delete$/, reason: 'xoa-toan-bo-hoc-vien' },
  { method: 'POST', path: /^\/api\/students\/bulk$/, reason: 'them-hoc-vien-hang-loat' },
  { method: 'POST', path: /^\/api\/students\/private-schedule\/import$/, reason: 'nhap-lich-hoc-rieng' },
  { method: 'POST', path: /^\/api\/students\/([^/]+)\/enroll\/[^/]+\/transfer$/, reason: 'chuyen-lop' },
  { method: 'POST', path: /^\/api\/schedules\/generate-month$/, reason: 'tao-lich-thang' },
  { method: 'POST', path: /^\/api\/schedules\/([^/]+)\/generate$/, reason: 'tao-buoi-tu-lich' },
  { method: 'DELETE', path: /^\/api\/schedules\/([^/]+)$/, reason: 'xoa-lich-hoc' },
  { method: 'DELETE', path: /^\/api\/sessions\/scheduled$/, reason: 'xoa-buoi-hang-loat' },
  { method: 'POST', path: /^\/api\/tuition\/calculate-bulk$/, reason: 'tinh-hoc-phi-hang-loat' },
  { method: 'DELETE', path: /^\/api\/tuition\/payment\/([^/]+)$/, reason: 'xoa-thanh-toan' },
  { method: 'POST', path: /^\/api\/undo\/([^/]+)$/, reason: 'hoan-tac' },
]

export function matchCheckpointRule(method: string, path: string) {
  for (const rule of RULES) {
    if (rule.method !== method) continue
    const m = rule.path.exec(path)
    if (m) return { reason: rule.reason, scopeKey: m[1] ?? 'tat-ca' }
  }
  return null
}

export function checkpointGuard(req: Request, _res: Response, next: NextFunction): void {
  const path = (req.originalUrl || req.url).split('?')[0]
  const hit = matchCheckpointRule(req.method, path)
  if (!hit) return next()

  const header = req.headers.authorization
  let payload: AuthPayload
  try {
    if (!header?.startsWith('Bearer ')) return next()
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'change-this-secret') as AuthPayload
  } catch {
    return next()   // token sai → router trả 401, không cần sao lưu
  }
  checkpoint(payload.userId?.slice(0, 12) ?? 'unknown', hit.reason, hit.scopeKey).then(() => next(), next)
}
