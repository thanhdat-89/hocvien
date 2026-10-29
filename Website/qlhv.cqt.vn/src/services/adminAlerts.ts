import { Prisma } from '@prisma/client'
import { prisma, newId } from '../lib/db'

// ─── Cảnh báo cho quản trị (chuông thông báo) ─────────────────
// Việc cần người xử lý: chuyển khoản chưa khớp phiếu, hoá đơn MISA lỗi, nhắc học phí quá số lần...
// Gắn cơ sở theo học viên liên quan (data.studentId); không xác định được thì hiện ở mọi cơ sở.

export type AlertType = 'sepay_unmatched' | 'misa_invoice_failed' | 'overdue_reminder_cap'

export async function studentBranchId(studentId: unknown): Promise<string | null> {
  if (typeof studentId !== 'string' || !studentId) return null
  return (await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } }))?.branchId ?? null
}

export async function raiseAlert(type: AlertType, message: string, data: Record<string, unknown>) {
  await prisma.adminAlert.create({ data: {
    id: newId(), type, message, read: false, data: data as Prisma.InputJsonValue, branchId: await studentBranchId(data.studentId),
  } })
}

/** Cảnh báo là phụ: lỗi ghi cảnh báo không được làm hỏng luồng chính (webhook, tạo hoá đơn) */
export function raiseAlertSafely(type: AlertType, message: string, data: Record<string, unknown>) {
  raiseAlert(type, message, data).catch(err => console.error('[alert] không ghi được cảnh báo:', err))
}
