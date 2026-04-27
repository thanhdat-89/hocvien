import { Response, NextFunction } from 'express'
import { AuthRequest } from '../types'
import { logActivity, ActivityAction } from '../lib/activityLog'

export interface ActivityHint {
  description?: string
  resourceType?: string
  resourceId?: string
  before?: unknown
  after?: unknown
}

declare module 'express-serve-static-core' {
  interface Request {
    activity?: ActivityHint
  }
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const SKIP_PATTERNS: RegExp[] = [
  /^\/api\/auth\//,
  /^\/api\/public\//,
  /^\/api\/zalo/,
  /^\/api\/materials\/upload-signature$/,
  /^\/api\/notifications\/zalo\//,
  /^\/api\/activity/,
]

const RESOURCE_LABEL: Record<string, string> = {
  students: 'học viên', classes: 'lớp học', schedules: 'lịch học', sessions: 'buổi học',
  attendance: 'điểm danh', tuition: 'học phí', teachers: 'giáo viên', subjects: 'môn học',
  parents: 'phụ huynh', leads: 'lead', reviews: 'nhận xét', 'test-scores': 'điểm kiểm tra',
  tests: 'bài kiểm tra', materials: 'tài liệu', notifications: 'thông báo',
}

function deriveResourceType(path: string): string {
  const m = path.match(/^\/api\/([^/?]+)/)
  return m ? m[1] : 'unknown'
}

function defaultDescription(method: string, action: ActivityAction, resourceType: string): string {
  const label = RESOURCE_LABEL[resourceType] ?? resourceType
  if (action === 'CREATE') return `Thêm ${label}`
  if (action === 'DELETE') return `Xoá ${label}`
  return `Sửa ${label}`
}

export function activityLogMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!MUTATION_METHODS.has(req.method)) return next()
  if (!req.path.startsWith('/api/')) return next()
  if (SKIP_PATTERNS.some(p => p.test(req.path))) return next()

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return
    if (!req.user) return

    const action: ActivityAction =
      req.method === 'POST' ? 'CREATE' :
      req.method === 'DELETE' ? 'DELETE' : 'UPDATE'

    const hint: ActivityHint = req.activity ?? {}
    const resourceType = hint.resourceType ?? deriveResourceType(req.path)
    const description = hint.description ?? defaultDescription(req.method, action, resourceType)

    void logActivity({
      userId: req.user.userId,
      userRole: req.user.role,
      action,
      resourceType,
      resourceId: hint.resourceId,
      description,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      ip: req.ip,
      before: hint.before,
      after: hint.after,
    }).catch(err => console.error('[activityLog] failed:', err))
  })

  next()
}
