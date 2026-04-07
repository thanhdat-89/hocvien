import { Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AuthRequest, AuthPayload } from '../types'

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret'

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Thiếu token xác thực' })
    return
  }

  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload
    req.user = payload
    next()
  } catch {
    res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn' })
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
