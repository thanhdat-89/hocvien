import { Response, NextFunction } from 'express'
import { AuthRequest } from '../types'
import { db, C } from '../lib/firebase'
import { ActivityHint } from './activityLog'

type Data = Record<string, any>
const object = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const reserved = new Set(['calculate', 'calculate-bulk', 'toggle-paid', 'bulk', 'bulk-delete', 'student-promotions', 'promotions', 'payment'])

async function read(collection: string, id: unknown): Promise<Data> {
  if (!text(id) || text(id).includes('/')) return {}
  const doc = await db.collection(collection).doc(text(id)).get()
  return doc.exists ? { ...doc.data(), id: doc.id } : {}
}

export function describeActivity(resource: string, path: string, method: string, body: Data, context: Data): ActivityHint {
  const verb = method === 'POST' ? 'Thêm' : method === 'DELETE' ? 'Xóa' : 'Sửa'
  const student = text(context.studentName)
  const className = text(context.className)
  const details = [student ? `Học viên ${student}` : '', className ? `Lớp ${className}` : '',
    context.month && context.year ? `tháng ${context.month}/${context.year}` : ''].filter(Boolean)
  let label = resource === 'tuition' ? 'học phí' : resource === 'students' ? 'học viên' : 'lớp học'
  let action: ActivityHint['action'] = method === 'POST' ? 'CREATE' : method === 'DELETE' ? 'DELETE' : 'UPDATE'
  let operation = `${verb} ${label}`
  if (resource === 'students' && path.includes('/private-schedule')) operation = `${verb} lịch học riêng`
  else if (resource === 'students' && path.includes('/enroll')) operation = `${verb} đăng ký lớp học`
  else if (resource === 'classes' && path.includes('/sessions')) operation = `${verb} buổi học`
  else if (resource === 'classes' && path.includes('/schedules')) operation = `${verb} lịch học`
  if (resource === 'tuition' && path.endsWith('/toggle-paid')) {
    action = 'UPDATE'
    operation = body.paid === true ? 'Xác nhận thanh toán đủ học phí' : 'Bỏ xác nhận thanh toán học phí'
  } else if (resource === 'tuition' && /\/payment(?:\/|$)/.test(path)) operation = `${verb} thanh toán học phí`
  else if (resource === 'tuition' && path.includes('/student-promotions')) operation = `${verb} khuyến mãi học phí`
  if (resource === 'students' && !path.includes('/private-schedule') && !path.includes('/enroll') && student) {
    operation = `${verb} học viên ${student}`
    details.shift()
  } else if (resource === 'classes' && className && !path.includes('/sessions') && !path.includes('/schedules')) {
    operation = `${verb} lớp học ${className}`
    details.splice(details.indexOf(`Lớp ${className}`), 1)
  }
  return { action, resourceType: resource, resourceId: text(context.resourceId) || undefined,
    description: [operation, ...details].join(' — ') }
}

// Run after authentication, before mutations so names survive deletion.
// Only capture identifying context; no payment credentials or request snapshots.
export async function activityContext(req: AuthRequest, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) { next(); return }
  const path = req.originalUrl.split('?')[0]
  const [, , resource, first, second] = path.split('/')
  const body = object(req.body)
  let context: Data = { studentName: text(body.studentName), className: text(body.className), month: body.month, year: body.year }
  try {
    const collection = resource === 'students' ? C.STUDENTS : resource === 'classes' ? C.CLASSES : C.TUITION_RECORDS
    let entity: Data = {}
    if (first && !reserved.has(first)) entity = await read(collection, first)
    else if (resource === 'tuition' && first === 'payment' && second) entity = await read(C.PAYMENTS, second)
    else if (resource === 'tuition' && first === 'student-promotions' && second && second !== 'direct') entity = await read(C.STUDENT_PROMOTIONS, second)
    if (entity.tuitionRecordId) entity = { ...await read(C.TUITION_RECORDS, entity.tuitionRecordId), ...entity }
    const studentId = resource === 'students' ? entity.id : entity.studentId || body.studentId
    const classId = resource === 'classes' ? entity.id : entity.classId || body.classId
    const studentName = resource === 'students' ? text(entity.fullName || body.fullName) : text(entity.studentName) || context.studentName
    const className = resource === 'classes' ? text(entity.name || body.name) : text(entity.className) || context.className
    context = { studentName: studentName || text((await read(C.STUDENTS, studentId)).fullName),
      className: className || text((await read(C.CLASSES, classId)).name),
      month: entity.billingMonth || body.month, year: entity.billingYear || body.year, resourceId: entity.id }
  } catch (error) {
    console.error('[activityContext] lookup failed')
    // Audit enrichment failure must not block business operations.
  }
  const originalJson = res.json
  res.json = function(payload: any) {
    if (res.statusCode >= 200 && res.statusCode < 300 && !req.activity?.description) {
      const result = object(payload)
      context.resourceId = context.resourceId || result.id || result.recordId
      if (resource === 'students') context.studentName = text(result.fullName) || context.studentName
      if (resource === 'classes') context.className = text(result.name) || context.className
      req.activity = { ...req.activity, ...describeActivity(resource, path, req.method, body, context) }
    }
    return originalJson.call(this, payload)
  }
  next()
}
