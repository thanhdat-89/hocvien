import { db, C, toDocs } from '../lib/firebase'
import type { ClassEnrollment, StudentPromotion, TuitionRecord, Payment } from '../types/models'

const now = () => new Date().toISOString()

/**
 * Tính học phí cho 1 học viên / 1 lớp / 1 tháng
 */
export async function calculateTuitionForStudent(
  studentId: string,
  classId: string,
  month: number,
  year: number
): Promise<{ tuitionRecord: TuitionRecord & { id: string }; isNew: boolean }> {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  const fromDate = `${monthStr}-01`
  const toDate = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`

  if (classId === 'private') {
    return calculatePrivateTuition(studentId, month, year, fromDate, toDate)
  }

  // Enrollment để lấy customTuitionRate
  const enrollSnap = await db.collection(C.ENROLLMENTS)
    .where('classId', '==', classId)
    .where('studentId', '==', studentId)
    .limit(1)
    .get()

  if (enrollSnap.empty) throw new Error(`Học viên ${studentId} không đăng ký lớp ${classId}`)

  const enrollment = { id: enrollSnap.docs[0].id, ...enrollSnap.docs[0].data() } as ClassEnrollment

  // Đơn giá: ưu tiên customTuitionRate → class.tuitionRate → subject.tuitionRatePerSession
  let ratePerSession = enrollment.customTuitionRate ?? 0
  if (!ratePerSession) {
    const classDoc = await db.collection(C.CLASSES).doc(classId).get()
    const classData = classDoc.data() || {}
    if (classData.tuitionRate) {
      ratePerSession = Number(classData.tuitionRate)
    } else if (classData.subjectId) {
      const subjectDoc = await db.collection(C.SUBJECTS).doc(classData.subjectId as string).get()
      ratePerSession = Number(subjectDoc.data()?.tuitionRatePerSession || 0)
    }
  }

  // Sessions không CANCELLED trong tháng (theo lịch dự kiến)
  const sessionsSnap = await db.collection(C.SESSIONS)
    .where('classId', '==', classId)
    .where('sessionDate', '>=', fromDate)
    .where('sessionDate', '<=', toDate)
    .get()
  const validSessions = sessionsSnap.docs.filter(d => {
    const data = d.data()
    if (data.status === 'CANCELLED') return false
    if (enrollment.enrollmentDate && data.sessionDate < enrollment.enrollmentDate) return false
    if (enrollment.status === 'DROPPED' && (enrollment as any).dropDate
        && data.sessionDate > (enrollment as any).dropDate) return false
    return true
  })
  const totalSessions = validSessions.length
  const chargedSessions = totalSessions

  const baseAmount = chargedSessions * ratePerSession

  // Khuyến mãi đang hiệu lực
  const promoSnap = await db.collection(C.STUDENT_PROMOTIONS)
    .where('studentId', '==', studentId)
    .where('classId', '==', classId)
    .where('appliedFrom', '<=', toDate)
    .get()

  const activePromos = toDocs<StudentPromotion>(promoSnap).filter(p =>
    !p.appliedTo || p.appliedTo >= fromDate
  )

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
  const finalAmount = baseAmount - discountAmount

  // Lấy tên học viên và lớp
  const [studentDoc, classDoc] = await Promise.all([
    db.collection(C.STUDENTS).doc(studentId).get(),
    db.collection(C.CLASSES).doc(classId).get(),
  ])

  // Kiểm tra đã có phiếu chưa
  const existingSnap = await db.collection(C.TUITION_RECORDS)
    .where('studentId', '==', studentId)
    .where('classId', '==', classId)
    .where('billingMonth', '==', month)
    .where('billingYear', '==', year)
    .limit(1)
    .get()

  const isNew = existingSnap.empty

  const recordData = {
    studentId, studentName: studentDoc.data()!.fullName as string,
    classId, className: classDoc.data()!.name as string,
    billingMonth: month, billingYear: year,
    totalSessions, chargedSessions,
    baseAmount, discountAmount, finalAmount,
    status: 'PENDING' as const,
    dueDate: `${year}-${String(month).padStart(2, '0')}-25`,
    updatedAt: now(),
  }

  let recordId: string
  if (isNew) {
    const ref = await db.collection(C.TUITION_RECORDS).add({ ...recordData, createdAt: now() })
    recordId = ref.id
  } else {
    recordId = existingSnap.docs[0].id
    await db.collection(C.TUITION_RECORDS).doc(recordId).update(recordData)
  }

  // Recompute status từ payments thực tế (PENDING/PARTIAL/PAID)
  await refreshTuitionStatus(recordId)

  const doc = await db.collection(C.TUITION_RECORDS).doc(recordId).get()
  return {
    tuitionRecord: { id: doc.id, ...doc.data() } as TuitionRecord & { id: string },
    isNew,
  }
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
): Promise<{ tuitionRecord: TuitionRecord & { id: string }; isNew: boolean }> {
  const sessionsSnap = await db.collection(C.PRIVATE_SCHEDULES)
    .where('studentId', '==', studentId)
    .where('sessionDate', '>=', fromDate)
    .where('sessionDate', '<=', toDate)
    .get()
  const validSessions = sessionsSnap.docs
    .map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(s => s.status !== 'CANCELLED')

  if (validSessions.length === 0) {
    throw new Error(`Học viên ${studentId} không có buổi học riêng nào trong T${month}/${year}`)
  }

  const totalSessions = validSessions.length
  const baseAmount = validSessions.reduce((sum, s) => sum + (Number(s.ratePerSession) || 0), 0)
  const avgRate = totalSessions > 0 ? Math.round(baseAmount / totalSessions) : 0

  // Khuyến mãi cho học riêng (classId='private')
  const promoSnap = await db.collection(C.STUDENT_PROMOTIONS)
    .where('studentId', '==', studentId)
    .where('classId', '==', 'private')
    .where('appliedFrom', '<=', toDate)
    .get()
  const activePromos = toDocs<StudentPromotion>(promoSnap).filter(p =>
    !p.appliedTo || p.appliedTo >= fromDate
  )

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
  const finalAmount = baseAmount - discountAmount

  const studentDoc = await db.collection(C.STUDENTS).doc(studentId).get()

  const existingSnap = await db.collection(C.TUITION_RECORDS)
    .where('studentId', '==', studentId)
    .where('classId', '==', 'private')
    .where('billingMonth', '==', month)
    .where('billingYear', '==', year)
    .limit(1).get()
  const isNew = existingSnap.empty

  const recordData = {
    studentId, studentName: studentDoc.data()!.fullName as string,
    classId: 'private', className: 'Học riêng',
    billingMonth: month, billingYear: year,
    totalSessions, chargedSessions: totalSessions,
    baseAmount, discountAmount, finalAmount,
    status: 'PENDING' as const,
    dueDate: `${year}-${String(month).padStart(2, '0')}-25`,
    updatedAt: now(),
  }

  let recordId: string
  if (isNew) {
    const ref = await db.collection(C.TUITION_RECORDS).add({ ...recordData, createdAt: now() })
    recordId = ref.id
  } else {
    recordId = existingSnap.docs[0].id
    await db.collection(C.TUITION_RECORDS).doc(recordId).update(recordData)
  }
  await refreshTuitionStatus(recordId)

  const doc = await db.collection(C.TUITION_RECORDS).doc(recordId).get()
  return {
    tuitionRecord: { id: doc.id, ...doc.data() } as TuitionRecord & { id: string },
    isNew,
  }
}

/**
 * Tính học phí cho tất cả học viên active trong 1 lớp / 1 tháng
 */
export async function calculateTuitionForClass(
  classId: string, month: number, year: number
): Promise<{ created: number; updated: number }> {
  let studentIds: string[]

  if (classId === 'private') {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`
    const fromDate = `${monthStr}-01`
    const toDate = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`
    const sessionsSnap = await db.collection(C.PRIVATE_SCHEDULES)
      .where('sessionDate', '>=', fromDate)
      .where('sessionDate', '<=', toDate)
      .get()
    const ids = new Set<string>()
    sessionsSnap.docs.forEach(d => {
      const data = d.data() as any
      if (data.status !== 'CANCELLED' && data.studentId) ids.add(data.studentId as string)
    })
    studentIds = Array.from(ids)
  } else {
    const enrollSnap = await db.collection(C.ENROLLMENTS)
      .where('classId', '==', classId)
      .where('status', '==', 'ACTIVE')
      .get()
    studentIds = enrollSnap.docs.map(d => d.data().studentId as string)
  }

  let created = 0, updated = 0
  for (const sid of studentIds) {
    try {
      const { isNew } = await calculateTuitionForStudent(sid, classId, month, year)
      isNew ? created++ : updated++
    } catch (e) {
      console.error('[calculateTuitionForClass] failed for student', sid, classId, e)
    }
  }
  return { created, updated }
}

/**
 * Tính tổng tiền đã thanh toán và còn nợ cho 1 phiếu học phí
 */
export async function getPaymentStatus(tuitionRecordId: string) {
  const [recordDoc, paymentsSnap] = await Promise.all([
    db.collection(C.TUITION_RECORDS).doc(tuitionRecordId).get(),
    db.collection(C.PAYMENTS).where('tuitionRecordId', '==', tuitionRecordId).get(),
  ])

  if (!recordDoc.exists) throw new Error('Không tìm thấy phiếu học phí')

  const record = recordDoc.data() as TuitionRecord
  const payments = toDocs<Payment>(paymentsSnap)
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)
  const remaining = record.finalAmount - totalPaid

  return { finalAmount: record.finalAmount, totalPaid, remaining, status: record.status }
}

/**
 * Cập nhật trạng thái phiếu dựa trên tổng tiền đã trả
 */
export async function refreshTuitionStatus(tuitionRecordId: string): Promise<void> {
  const { finalAmount, totalPaid } = await getPaymentStatus(tuitionRecordId)

  let status: TuitionRecord['status'] = 'PENDING'
  if (totalPaid >= finalAmount) status = 'PAID'
  else if (totalPaid > 0) status = 'PARTIAL'

  await db.collection(C.TUITION_RECORDS).doc(tuitionRecordId).update({
    status, updatedAt: new Date().toISOString(),
  })
}
