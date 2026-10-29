import { Prisma } from '@prisma/client'
import { prisma, newId } from '../lib/db'

// ─── Cảnh báo cho quản trị (chuông thông báo) ─────────────────
// Việc cần người xử lý: chuyển khoản chưa khớp phiếu, hoá đơn MISA lỗi, nhắc học phí quá số lần...
// Gắn cơ sở theo học viên (data.studentId) hoặc lớp (data.classId) liên quan; không xác định được thì hiện ở mọi cơ sở.

export type AlertType = 'sepay_unmatched' | 'misa_invoice_failed' | 'overdue_reminder_cap' | 'class_audit'

export async function studentBranchId(studentId: unknown): Promise<string | null> {
  if (typeof studentId !== 'string' || !studentId) return null
  return (await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } }))?.branchId ?? null
}

async function alertBranchId(data: Record<string, unknown>) {
  const fromStudent = await studentBranchId(data.studentId)
  if (fromStudent || typeof data.classId !== 'string' || !data.classId) return fromStudent
  return (await prisma.class.findUnique({ where: { id: data.classId }, select: { branchId: true } }))?.branchId ?? null
}

export async function raiseAlert(type: AlertType, message: string, data: Record<string, unknown>) {
  await prisma.adminAlert.create({ data: {
    id: newId(), type, message, read: false, data: data as Prisma.InputJsonValue, branchId: await alertBranchId(data),
  } })
}

type Anomaly = { type: string; classId: string; studentId?: string; count?: number; calculatedAmount?: number; recordedAmount?: number }
const money = (n?: number) => `${Number(n || 0).toLocaleString('vi-VN')}đ`

/**
 * Bất thường của lần kiểm tra lớp hằng ngày → cảnh báo. Mỗi bất thường chỉ báo một lần trong tháng
 * (kiểm tra chạy mỗi sáng, bất thường chưa sửa vẫn còn đó). Trả về số cảnh báo mới.
 */
export async function alertClassAudit(period: string, anomalies: Anomaly[]) {
  if (!anomalies.length) return 0
  const [classes, students, existing] = await Promise.all([
    prisma.class.findMany({ where: { id: { in: anomalies.map(a => a.classId) } }, select: { id: true, name: true } }),
    prisma.student.findMany({ where: { id: { in: anomalies.flatMap(a => a.studentId ? [a.studentId] : []) } }, select: { id: true, fullName: true } }),
    prisma.adminAlert.findMany({ where: { type: 'class_audit', data: { path: ['period'], equals: period } }, select: { data: true } }),
  ])
  const className = new Map(classes.map(c => [c.id, c.name])), studentName = new Map(students.map(s => [s.id, s.fullName]))
  const seen = new Set(existing.map(a => (a.data as { key?: string }).key))
  const [year, month] = period.split('-').map(Number)
  let created = 0
  for (const a of anomalies) {
    const key = `${a.type}:${a.classId}:${a.studentId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const cls = className.get(a.classId) ?? 'Lớp đã xoá'
    const message = a.type === 'MISSING_MONTH_SESSIONS' ? `Lớp ${cls} có lịch học nhưng chưa có buổi nào trong tháng ${month}/${year} (${a.count} học viên).`
      : a.type === 'WRONG_WEEKDAY' ? `Lớp ${cls} có ${a.count} buổi tháng ${month}/${year} không đúng thứ trong lịch học.`
      : a.type === 'TUITION_RECORD_DIFFERS' ? `Phiếu học phí T${month}/${year} của ${studentName.get(a.studentId!) ?? 'học viên'} (lớp ${cls}) là ${money(a.recordedAmount)}, tính lại theo buổi học được ${money(a.calculatedAmount)}.`
      : `Lớp ${cls}: bất thường ${a.type} tháng ${month}/${year}.`
    await raiseAlert('class_audit', message, { ...a, period, key })
    created++
  }
  return created
}

/** Cảnh báo là phụ: lỗi ghi cảnh báo không được làm hỏng luồng chính (webhook, tạo hoá đơn) */
export function raiseAlertSafely(type: AlertType, message: string, data: Record<string, unknown>) {
  raiseAlert(type, message, data).catch(err => console.error('[alert] không ghi được cảnh báo:', err))
}
