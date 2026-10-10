import { db, C, toDocs } from '../lib/firebase'
import type { TuitionRecord, Payment } from '../types/models'

/** Shared calculation for the tuition page and automated exports. */
export async function getTuitionScheduleSummary(month: number, year: number, sourceDb: Pick<FirebaseFirestore.Firestore, 'collection'> = db) {
  const m = month
  const y = year
  const monthStr = `${y}-${String(m).padStart(2, '0')}`
  const fromDate = `${monthStr}-01`
  const toDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`

  // 1. Lấy tất cả enrollments: ACTIVE hoặc DROPPED nhưng dropDate >= fromDate
  const enrollmentsSnap = await sourceDb.collection(C.ENROLLMENTS).get()
  const allEnrollments = toDocs<any>(enrollmentsSnap)
  const relevantEnrollments = allEnrollments.filter(e => {
    if (e.status === 'ACTIVE') return true
    if (e.status === 'DROPPED' && e.dropDate && e.dropDate >= fromDate) return true
    return false
  })


  // 2. Unique classIds, studentIds
  const classIds = [...new Set(relevantEnrollments.map((e: any) => e.classId as string))]
  const studentIds = [...new Set(relevantEnrollments.map((e: any) => e.studentId as string))]

  // 3. Fetch classes
  const classDocs = await Promise.all(classIds.map(id => sourceDb.collection(C.CLASSES).doc(id).get()))
  const classMap: Record<string, any> = {}
  for (const doc of classDocs) {
    if (doc.exists) classMap[doc.id] = { id: doc.id, ...doc.data() }
  }

  // 4. Fetch students
  const studentDocs = await Promise.all(studentIds.map(id => sourceDb.collection(C.STUDENTS).doc(id).get()))
  const studentMap: Record<string, any> = {}
  for (const doc of studentDocs) {
    if (doc.exists) studentMap[doc.id] = { id: doc.id, ...doc.data() }
  }

  // 5. Fetch sessions per class — dùng composite index (classId, sessionDate)
  //    để chỉ lấy sessions trong tháng, không cần filter in-memory
  const sessionsByClass: Record<string, any[]> = {}
  await Promise.all(classIds.map(async (classId) => {
    const snap = await sourceDb.collection(C.SESSIONS)
      .where('classId', '==', classId)
      .where('sessionDate', '>=', fromDate)
      .where('sessionDate', '<=', toDate)
      .get()
    sessionsByClass[classId] = toDocs<any>(snap)
  }))

  // 6. Fetch promotions per unique (studentId, classId) — song song thay vì tuần tự
  const uniquePairs = new Map<string, { studentId: string; classId: string }>()
  for (const e of relevantEnrollments) {
    const key = `${e.studentId}-${e.classId}`
    if (!uniquePairs.has(key)) uniquePairs.set(key, { studentId: e.studentId, classId: e.classId })
  }
  const promotionMap: Record<string, any[]> = {}
  await Promise.all(Array.from(uniquePairs.entries()).map(async ([key, { studentId, classId }]) => {
    const snap = await sourceDb.collection(C.STUDENT_PROMOTIONS)
      .where('studentId', '==', studentId)
      .where('classId', '==', classId)
      .get()
    promotionMap[key] = toDocs<any>(snap).filter((p: any) =>
      (!p.appliedFrom || p.appliedFrom <= toDate) && (!p.appliedTo || p.appliedTo >= fromDate)
    )
  }))

  // 7. Tính từng enrollment
  const rows: any[] = []
  const buildPrimaryParent = (stu: any) => stu.primaryParentName
    ? {
        fullName: stu.primaryParentName as string,
        phone: (stu.primaryParentPhone as string | null) ?? null,
        zalo: (stu.primaryParentZalo as string | null) ?? null,
      }
    : null

  for (const enrollment of relevantEnrollments) {
    const cls = classMap[enrollment.classId]
    const student = studentMap[enrollment.studentId]
    if (!cls || !student) continue

    const ratePerSession: number = (enrollment.customTuitionRate as number) || (cls.tuitionRate as number) || 0

    const classSessions = sessionsByClass[enrollment.classId] ?? []
    const sessions = classSessions.filter((sess: any) => {
      if (!sess.sessionDate || !sess.sessionDate.startsWith(monthStr)) return false
      if (sess.status === 'CANCELLED') return false
      if (enrollment.enrollmentDate && sess.sessionDate < enrollment.enrollmentDate) return false
      if (enrollment.status === 'DROPPED' && enrollment.dropDate && sess.sessionDate > enrollment.dropDate) return false
      return true
    })

    const totalSessions = sessions.length
    if (totalSessions === 0) continue

    const baseAmount = totalSessions * ratePerSession
    const promos = promotionMap[`${enrollment.studentId}-${enrollment.classId}`] ?? []
    let discountAmount = 0
    for (const sp of promos) {
      if (sp.promotionType === 'PERCENTAGE') discountAmount += (baseAmount * sp.promotionValue) / 100
      else if (sp.promotionType === 'FIXED_AMOUNT') discountAmount += sp.promotionValue
      else if (sp.promotionType === 'FREE_SESSIONS') discountAmount += sp.promotionValue * ratePerSession
    }
    discountAmount = Math.min(discountAmount, baseAmount)

    rows.push({
      studentId: enrollment.studentId,
      studentName: student.fullName,
      gradeLevel: student.gradeLevel ?? null,
      primaryParent: buildPrimaryParent(student),
      classId: enrollment.classId,
      className: cls.name,
      totalSessions,
      ratePerSession,
      discountAmount,
      baseAmount,
      finalAmount: baseAmount - discountAmount,
    })
  }

  // Học riêng — dùng range query thay vì fetch all rồi filter
  const privateSnap = await sourceDb.collection(C.PRIVATE_SCHEDULES)
    .where('sessionDate', '>=', fromDate)
    .where('sessionDate', '<=', toDate)
    .get()
  const allPrivate = toDocs<any>(privateSnap).filter((ps: any) => ps.status !== 'CANCELLED')

  // Group by studentId
  const privateByStudent: Record<string, any[]> = {}
  for (const ps of allPrivate) {
    if (!privateByStudent[ps.studentId]) privateByStudent[ps.studentId] = []
    privateByStudent[ps.studentId].push(ps)
  }

  // Thêm rows học riêng — cần studentName
  const privateStudentIds = Object.keys(privateByStudent).filter(sid => !studentMap[sid])
  if (privateStudentIds.length > 0) {
    const extraDocs = await Promise.all(privateStudentIds.map(id => sourceDb.collection(C.STUDENTS).doc(id).get()))
    for (const doc of extraDocs) {
      if (doc.exists) studentMap[doc.id] = { id: doc.id, ...doc.data() }
    }
  }

  // Fetch promotions cho học riêng (classId === 'private') của các students liên quan
  const privatePromoMap: Record<string, any[]> = {}
  const allPrivateStudentIds = Object.keys(privateByStudent)
  await Promise.all(allPrivateStudentIds.map(async (sid) => {
    const snap = await sourceDb.collection(C.STUDENT_PROMOTIONS)
      .where('studentId', '==', sid)
      .where('classId', '==', 'private')
      .get()
    privatePromoMap[sid] = toDocs<any>(snap).filter((p: any) =>
      (!p.appliedFrom || p.appliedFrom <= toDate) && (!p.appliedTo || p.appliedTo >= fromDate)
    )
  }))

  for (const [sid, sessions] of Object.entries(privateByStudent)) {
    const student = studentMap[sid]
    if (!student) continue
    const totalAmount = sessions.reduce((sum, ps) => sum + (ps.ratePerSession || 0), 0)
    const totalSessions = sessions.length
    const avgRate = totalSessions > 0 ? Math.round(totalAmount / totalSessions) : 0

    let discountAmount = 0
    for (const p of (privatePromoMap[sid] ?? [])) {
      if (p.promotionType === 'PERCENTAGE') discountAmount += (totalAmount * p.promotionValue) / 100
      else if (p.promotionType === 'FIXED_AMOUNT') discountAmount += p.promotionValue
    }
    discountAmount = Math.min(discountAmount, totalAmount)

    rows.push({
      studentId: sid,
      studentName: student.fullName,
      gradeLevel: student.gradeLevel ?? null,
      primaryParent: buildPrimaryParent(student),
      classId: 'private',
      className: 'Học riêng',
      totalSessions,
      ratePerSession: avgRate,
      discountAmount,
      baseAmount: totalAmount,
      finalAmount: totalAmount - discountAmount,
    })
  }

  // ─── Enrich rows với tuitionRecord + payment status ───────
  const recordsSnap = await sourceDb.collection(C.TUITION_RECORDS)
    .where('billingMonth', '==', m)
    .where('billingYear', '==', y)
    .get()
  const recordsByKey = new Map<string, TuitionRecord>()
  recordsSnap.forEach(doc => {
    const d = { id: doc.id, ...(doc.data() as any) } as TuitionRecord
    recordsByKey.set(`${d.studentId}-${d.classId}`, d)
  })

  const recordIds = Array.from(recordsByKey.values()).map(r => r.id)
  const paidByRecord = new Map<string, number>()
  for (let i = 0; i < recordIds.length; i += 10) {
    const chunk = recordIds.slice(i, i + 10)
    if (chunk.length === 0) continue
    const paySnap = await sourceDb.collection(C.PAYMENTS)
      .where('tuitionRecordId', 'in', chunk).get()
    paySnap.forEach(p => {
      const data = p.data() as Payment
      paidByRecord.set(data.tuitionRecordId, (paidByRecord.get(data.tuitionRecordId) || 0) + (data.amount || 0))
    })
  }

  rows.forEach(row => {
    const rec = recordsByKey.get(`${row.studentId}-${row.classId}`)
    if (rec) {
      const paid = paidByRecord.get(rec.id) || 0
      row.tuitionRecord = {
        id: rec.id,
        finalAmount: rec.finalAmount,
        status: rec.status,
        paidAmount: paid,
        remainingAmount: Math.max(0, rec.finalAmount - paid),
      }
    } else {
      row.tuitionRecord = null
    }
  })

  rows.sort((a, b) => a.studentName.localeCompare(b.studentName, 'vi'))
  return rows
}
