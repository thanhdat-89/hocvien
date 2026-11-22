import { prisma } from '../lib/db'
import { classDoc, classInclude, enrollmentDoc, enrollmentInclude } from '../lib/docs'
import { enrollmentCoversSession } from '../lib/enrollmentDays'
import { classRateForMonth } from './classChange'
import { calculateTuitionForStudent } from './tuitionCalculator'

const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }) }

export type SessionToggle = 'cancel' | 'restore'

/**
 * Ảnh hưởng học phí khi huỷ hoặc khôi phục một buổi của lớp:
 * học viên có buổi này trong học phí, tổng tiền trước giảm giá, và phiếu học phí của tháng đó.
 * Phiếu đã thu tiền hoặc đã có hoá đơn MISA thì khoá (không được tự tính lại).
 */
export async function sessionChangeImpact(sessionId: string, action: SessionToggle) {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true, classId: true, sessionDate: true, status: true } })
  if (!session) fail('Không tìm thấy buổi học', 404)
  const { classId, status } = session!
  if (action === 'cancel' && status === 'CANCELLED') fail('Buổi học đã bị huỷ', 409)
  if (action === 'restore' && status !== 'CANCELLED') fail('Buổi học chưa bị huỷ', 409)

  const date = session!.sessionDate.toISOString().slice(0, 10)
  const [year, month] = date.split('-').map(Number)
  const [clsRow, enrollmentRows] = await Promise.all([
    prisma.class.findUniqueOrThrow({ where: { id: classId }, include: classInclude }),
    prisma.classEnrollment.findMany({ where: { classId }, include: enrollmentInclude }),
  ])
  const cls = classDoc(clsRow)
  if (action === 'restore' && cls.status !== 'ACTIVE') fail('Lớp đã kết thúc, không khôi phục buổi được', 409)

  // Mỗi học viên tính một lần, theo lần ghi danh có bao gồm buổi này
  const byStudent = new Map<string, number>()
  for (const e of enrollmentRows.map(enrollmentDoc)) {
    if (byStudent.has(e.studentId) || !enrollmentCoversSession(e, date)) continue
    byStudent.set(e.studentId, Number(e.customTuitionRate) || classRateForMonth(cls, month, year))
  }
  const studentIds = [...byStudent.keys()]

  const records = studentIds.length ? await prisma.tuitionRecord.findMany({
    where: { classId, billingMonth: month, billingYear: year, studentId: { in: studentIds } },
    select: { id: true, studentId: true, status: true, paidAmount: true },
  }) : []
  const recordIds = records.map(r => r.id)
  const invoiced = new Set<string>()
  if (recordIds.length) {
    for (const inv of await prisma.misaInvoice.findMany({
      where: { OR: [{ id: { in: recordIds } }, { recordIds: { hasSome: recordIds } }] }, select: { id: true, recordIds: true },
    })) [inv.id, ...inv.recordIds].forEach(id => invoiced.add(id))
  }
  const isLocked = (r: typeof records[number]) => r.status === 'PAID' || r.status === 'PARTIAL' || Number(r.paidAmount) > 0 || invoiced.has(r.id)

  return {
    classId, month, year, date,
    studentCount: studentIds.length,
    amount: [...byStudent.values()].reduce((sum, rate) => sum + rate, 0),
    lockedRecords: records.filter(isLocked).length,
    recalcStudentIds: records.filter(r => !isLocked(r)).map(r => r.studentId),
  }
}

const lockedMessage = (impact: { month: number; year: number; lockedRecords: number }, action: SessionToggle) =>
  `Tháng ${impact.month}/${impact.year} đã có ${impact.lockedRecords} phiếu học phí đã thu tiền hoặc đã xuất hoá đơn. `
  + `${action === 'cancel' ? 'Huỷ' : 'Khôi phục'} buổi sẽ làm lệch số tiền trên phiếu; cần đối chiếu phiếu trước.`

/** Huỷ hoặc khôi phục buổi, rồi tính lại các phiếu chưa thu tiền của tháng đó. Chặn nếu có phiếu đã khoá. */
export async function toggleSession(sessionId: string, action: SessionToggle, cancelReason?: string) {
  const impact = await sessionChangeImpact(sessionId, action)
  if (impact.lockedRecords) fail(lockedMessage(impact, action), 409)

  // Đổi trạng thái có điều kiện để hai người bấm cùng lúc không ghi đè nhau
  const { count } = await prisma.session.updateMany({
    where: { id: sessionId, status: action === 'cancel' ? { not: 'CANCELLED' } : 'CANCELLED' },
    data: action === 'cancel'
      ? { status: 'CANCELLED', cancelReason: cancelReason?.trim() || null }
      : { status: 'SCHEDULED', cancelReason: null },
  })
  if (!count) fail('Buổi học vừa được người khác thay đổi, hãy tải lại', 409)

  let recalculated = 0
  const failedStudents: string[] = []
  for (const studentId of impact.recalcStudentIds) {
    try {
      await calculateTuitionForStudent(studentId, impact.classId, impact.month, impact.year)
      recalculated++
    } catch (err) {
      console.error('[session toggle] tính lại học phí lỗi', { sessionId, studentId, err })
      failedStudents.push(studentId)
    }
  }
  return { ...impact, recalculated, failedStudents }
}
