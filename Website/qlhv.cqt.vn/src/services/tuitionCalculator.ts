import { prisma, newId, toDay, toClassId, type Tx } from '../lib/db'
import {
  classDoc, classInclude, enrollmentDoc, enrollmentInclude, privateSessionDoc, privateSessionInclude,
  sessionDoc, sessionInclude, studentPromotionDoc, studentPromotionInclude, tuitionRecordDoc, tuitionRecordInclude,
} from '../lib/docs'
import type { ClassEnrollment, StudentPromotion, TuitionRecord } from '../types/models'
import { classRateForMonth } from './classChange'

type TuitionRecordDoc = TuitionRecord & { id: string; paidAmount?: number; remainingAmount?: number }

const loadRecord = (id: string): Promise<TuitionRecordDoc> =>
  prisma.tuitionRecord.findUniqueOrThrow({ where: { id }, include: tuitionRecordInclude }).then(tuitionRecordDoc)

/** Phiếu của học viên × lớp (hoặc học riêng) × tháng — duy nhất nhờ unique index. */
const findRecord = (studentId: string, classId: string, month: number, year: number) =>
  prisma.tuitionRecord.findFirst({ where: { studentId, classId: toClassId(classId), billingMonth: month, billingYear: year } })

/** Khuyến mãi của học viên cho lớp (hoặc học riêng) có hiệu lực trong khoảng [fromDate, toDate]. */
async function activePromotions(studentId: string, classId: string, fromDate: string, toDate: string): Promise<StudentPromotion[]> {
  const rows = await prisma.studentPromotion.findMany({
    where: { studentId, classId: toClassId(classId), appliedFrom: { lte: toDay(toDate)! } },
    include: studentPromotionInclude,
  })
  return rows.map(studentPromotionDoc).filter((p: StudentPromotion) => !p.appliedTo || p.appliedTo >= fromDate)
}

/**
 * Ghi phiếu (tạo mới hoặc cập nhật) rồi tính lại trạng thái từ thanh toán thực tế.
 * Giảm giá theo % làm tròn đến đồng — cột tiền là số nguyên VND.
 */
async function saveRecord(existingId: string | null, data: {
  studentId: string; classId: string; className: string; month: number; year: number
  totalSessions: number; chargedSessions: number; baseAmount: number; discountAmount: number
}) {
  const discountAmount = Math.round(data.discountAmount)
  const fields = {
    className: data.className,
    totalSessions: data.totalSessions, chargedSessions: data.chargedSessions,
    baseAmount: Math.round(data.baseAmount), discountAmount, finalAmount: Math.round(data.baseAmount) - discountAmount,
    status: 'PENDING' as const,
    dueDate: toDay(`${data.year}-${String(data.month).padStart(2, '0')}-25`),
  }
  let recordId: string
  if (existingId) {
    recordId = existingId
    await prisma.tuitionRecord.update({ where: { id: recordId }, data: fields })
  } else {
    recordId = newId()
    await prisma.tuitionRecord.create({
      data: {
        id: recordId, studentId: data.studentId, classId: toClassId(data.classId),
        billingMonth: data.month, billingYear: data.year, remainingAmount: fields.finalAmount, ...fields,
      },
    })
  }

  // Recompute status từ payments thực tế (PENDING/PARTIAL/PAID)
  await refreshTuitionStatus(recordId)
  return { tuitionRecord: await loadRecord(recordId), isNew: !existingId }
}

/**
 * Tính học phí cho 1 học viên / 1 lớp / 1 tháng
 */
export async function calculateTuitionForStudent(
  studentId: string,
  classId: string,
  month: number,
  year: number
): Promise<{ tuitionRecord: TuitionRecordDoc; isNew: boolean }> {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  const fromDate = `${monthStr}-01`
  const toDate = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`

  if (classId === 'private') {
    return calculatePrivateTuition(studentId, month, year, fromDate, toDate)
  }

  // Enrollment để lấy customTuitionRate
  // Firestore .limit(1) trả tài liệu đầu tiên theo ID — giữ cùng lựa chọn khi học viên nghỉ rồi ghi danh lại.
  const enrollmentRow = await prisma.classEnrollment.findFirst({ where: { classId, studentId }, include: enrollmentInclude, orderBy: { id: 'asc' } })
  if (!enrollmentRow) throw new Error(`Học viên ${studentId} không đăng ký lớp ${classId}`)
  const enrollment: ClassEnrollment = enrollmentDoc(enrollmentRow)

  // Đơn giá: ưu tiên customTuitionRate → class.tuitionRate → subject.tuitionRatePerSession
  const classRow = await prisma.class.findUnique({ where: { id: classId }, include: { ...classInclude, subject: true } })
  const classData = classRow ? classDoc(classRow) : {}
  let ratePerSession = enrollment.customTuitionRate ?? 0
  if (!ratePerSession) {
    if (classRateForMonth(classData, month, year)) {
      ratePerSession = classRateForMonth(classData, month, year)
    } else if (classRow?.subject) {
      ratePerSession = Number(classRow.subject.tuitionRatePerSession || 0)
    }
  }

  // Sessions không CANCELLED trong tháng (theo lịch dự kiến)
  const sessions = (await prisma.session.findMany({
    where: { classId, sessionDate: { gte: toDay(fromDate)!, lte: toDay(toDate)! } },
    include: sessionInclude,
  })).map(sessionDoc)
  const validSessions = sessions.filter((data: any) => {
    if (data.status === 'CANCELLED') return false
    if (enrollment.enrollmentDate && data.sessionDate < enrollment.enrollmentDate) return false
    if (enrollment.status === 'DROPPED' && enrollment.dropDate && data.sessionDate > enrollment.dropDate) return false
    return true
  })
  const totalSessions = validSessions.length
  const chargedSessions = totalSessions

  const baseAmount = chargedSessions * ratePerSession

  // Khuyến mãi đang hiệu lực
  const activePromos = await activePromotions(studentId, classId, fromDate, toDate)

  let discountAmount = 0
  for (const sp of activePromos) {
    if (sp.promotionType === 'PERCENTAGE') {
      discountAmount += (baseAmount * sp.promotionValue) / 100
    } else if (sp.promotionType === 'FIXED_AMOUNT') {
      discountAmount += sp.promotionValue
    } else if (sp.promotionType === 'FREE_SESSIONS') {
      discountAmount += sp.promotionValue * ratePerSession
    }
  }
  discountAmount = Math.min(discountAmount, baseAmount)

  // Kiểm tra đã có phiếu chưa
  const existing = await findRecord(studentId, classId, month, year)
  if (existing) {
    // Phiếu đã thu tiền hoặc đã có hoá đơn MISA: giữ nguyên, không tính lại.
    if (existing.status === 'PAID' || existing.status === 'PARTIAL' || existing.paidAmount > 0) {
      return { tuitionRecord: await loadRecord(existing.id), isNew: false }
    }
    const invoice = await prisma.misaInvoice.findFirst({
      where: { OR: [{ id: existing.id }, { recordIds: { has: existing.id } }] }, select: { id: true },
    })
    if (invoice) return { tuitionRecord: await loadRecord(existing.id), isNew: false }
  }

  return saveRecord(existing?.id ?? null, {
    studentId, classId, className: classRow?.name ?? '', month, year,
    totalSessions, chargedSessions, baseAmount, discountAmount,
  })
}

/**
 * Tính học phí cho học viên Học riêng (classId='private') 1 tháng.
 * Tổng tiền = sum(ratePerSession) của các buổi không CANCELLED trong tháng.
 */
async function calculatePrivateTuition(
  studentId: string,
  month: number,
  year: number,
  fromDate: string,
  toDate: string,
): Promise<{ tuitionRecord: TuitionRecordDoc; isNew: boolean }> {
  const validSessions = (await prisma.privateSession.findMany({
    where: { studentId, sessionDate: { gte: toDay(fromDate)!, lte: toDay(toDate)! } },
    include: privateSessionInclude,
  })).map(privateSessionDoc).filter((s: any) => s.status !== 'CANCELLED')

  if (validSessions.length === 0) {
    throw new Error(`Học viên ${studentId} không có buổi học riêng nào trong T${month}/${year}`)
  }

  const totalSessions = validSessions.length
  const baseAmount = validSessions.reduce((sum: number, s: any) => sum + (Number(s.ratePerSession) || 0), 0)
  const avgRate = totalSessions > 0 ? Math.round(baseAmount / totalSessions) : 0

  // Khuyến mãi cho học riêng (classId='private')
  const activePromos = await activePromotions(studentId, 'private', fromDate, toDate)

  let discountAmount = 0
  for (const sp of activePromos) {
    if (sp.promotionType === 'PERCENTAGE') {
      discountAmount += (baseAmount * sp.promotionValue) / 100
    } else if (sp.promotionType === 'FIXED_AMOUNT') {
      discountAmount += sp.promotionValue
    } else if (sp.promotionType === 'FREE_SESSIONS') {
      discountAmount += sp.promotionValue * avgRate
    }
  }
  discountAmount = Math.min(discountAmount, baseAmount)

  const existing = await findRecord(studentId, 'private', month, year)
  return saveRecord(existing?.id ?? null, {
    studentId, classId: 'private', className: 'Học riêng', month, year,
    totalSessions, chargedSessions: totalSessions, baseAmount, discountAmount,
  })
}

/**
 * Tính học phí cho tất cả học viên active trong 1 lớp / 1 tháng
 */
export async function calculateTuitionForClass(
  classId: string, month: number, year: number
): Promise<{ created: number; updated: number; recordIds: string[]; newRecordIds: string[] }> {
  let studentIds: string[]

  if (classId === 'private') {
    const sessions = await prisma.privateSession.findMany({
      where: {
        status: { not: 'CANCELLED' },
        sessionDate: { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) },
      },
      select: { studentId: true }, distinct: ['studentId'],
    })
    studentIds = sessions.map(s => s.studentId)
  } else {
    const enrollments = await prisma.classEnrollment.findMany({ where: { classId, status: 'ACTIVE' }, select: { studentId: true } })
    studentIds = enrollments.map(e => e.studentId)
  }

  let created = 0, updated = 0
  const recordIds: string[] = []
  const newRecordIds: string[] = []
  for (const sid of studentIds) {
    try {
      const { isNew, tuitionRecord } = await calculateTuitionForStudent(sid, classId, month, year)
      if (isNew) { created++; newRecordIds.push(tuitionRecord.id) } else updated++
      recordIds.push(tuitionRecord.id)
    } catch (e) {
      console.error('[calculateTuitionForClass] failed for student', sid, classId, e)
    }
  }
  return { created, updated, recordIds: recordIds.filter(Boolean), newRecordIds: newRecordIds.filter(Boolean) }
}

/**
 * Tính tổng tiền đã thanh toán và còn nợ cho 1 phiếu học phí
 */
export async function getPaymentStatus(tuitionRecordId: string, tx: Tx = prisma) {
  const [record, paid] = await Promise.all([
    tx.tuitionRecord.findUnique({ where: { id: tuitionRecordId }, select: { finalAmount: true, status: true } }),
    tx.payment.aggregate({ where: { tuitionRecordId }, _sum: { amount: true } }),
  ])

  if (!record) throw new Error('Không tìm thấy phiếu học phí')

  const totalPaid = paid._sum.amount ?? 0
  const remaining = record.finalAmount - totalPaid

  return { finalAmount: record.finalAmount, totalPaid, remaining, status: record.status }
}

/**
 * Ghi một khoản thu và tính lại trạng thái phiếu trong cùng transaction, sau khi khoá dòng phiếu.
 * `amount = 'remaining'`: thu đủ phần còn nợ — bấm "đã đóng" hai lần liền không tạo hai khoản thu.
 * Trả về khoản thu đã tạo, hoặc null khi phiếu đã đủ tiền.
 */
export async function recordPayment(tuitionRecordId: string, input: {
  amount: number | 'remaining'; paymentDate?: string; method?: string; notes?: string; receivedById?: string; receivedByName: string
}) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM tuition_records WHERE id = ${tuitionRecordId} FOR UPDATE`
    const record = await tx.tuitionRecord.findUniqueOrThrow({ where: { id: tuitionRecordId }, select: { studentId: true } })
    const amount = input.amount === 'remaining' ? (await getPaymentStatus(tuitionRecordId, tx)).remaining : input.amount
    if (amount <= 0) { await refreshTuitionStatus(tuitionRecordId, tx); return null }
    const receivedBy = input.receivedById
      ? await tx.user.findUnique({ where: { id: input.receivedById }, select: { id: true } }) : null
    const payment = await tx.payment.create({
      data: {
        id: newId(), tuitionRecordId, studentId: record.studentId, amount,
        paymentDate: toDay(input.paymentDate || new Date().toISOString().slice(0, 10))!,
        method: (input.method || 'CASH') as 'CASH',
        receivedById: receivedBy?.id ?? null, receivedByName: input.receivedByName, notes: input.notes,
      },
    })
    await refreshTuitionStatus(tuitionRecordId, tx)
    return payment
  })
}

/** Xoá mọi khoản thu của phiếu (bỏ xác nhận đã đóng) và tính lại trạng thái — một transaction. */
export async function clearPayments(tuitionRecordId: string) {
  await prisma.$transaction(async tx => {
    await tx.payment.deleteMany({ where: { tuitionRecordId } })
    await refreshTuitionStatus(tuitionRecordId, tx)
  })
}

/**
 * Cập nhật trạng thái phiếu dựa trên tổng tiền đã trả
 */
export async function refreshTuitionStatus(tuitionRecordId: string, tx: Tx = prisma): Promise<void> {
  const { finalAmount, totalPaid } = await getPaymentStatus(tuitionRecordId, tx)

  let status: TuitionRecord['status'] = 'PENDING'
  if (totalPaid >= finalAmount) status = 'PAID'
  else if (totalPaid > 0) status = 'PARTIAL'

  await tx.tuitionRecord.update({
    where: { id: tuitionRecordId },
    data: { status, paidAmount: totalPaid, remainingAmount: Math.max(0, finalAmount - totalPaid) },
  })
}
