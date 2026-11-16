import { prisma } from '../lib/db'
import {
  classDoc, classInclude, enrollmentDoc, enrollmentInclude, privateSessionDoc, privateSessionInclude,
  sessionDoc, sessionInclude, studentPromotionDoc, studentPromotionInclude, tuitionRecordDoc, tuitionRecordInclude,
} from '../lib/docs'
import type { TuitionRecord } from '../types/models'
import { classRateForMonth } from './classChange'

/** Dữ liệu đầu vào dạng tài liệu Firestore cũ — tách khỏi phép tính để test truyền thẳng mảng. */
export interface TuitionScheduleData {
  enrollments: any[]
  classes: any[]
  /** { id, fullName, gradeLevel, primaryParentName, primaryParentPhone, primaryParentZalo } */
  students: any[]
  sessions: any[]
  promotions: any[]
  privateSessions: any[]
  records: (TuitionRecord & { id: string })[]
  paidByRecord: Map<string, number>
}

/** Đọc PostgreSQL cho một tháng, trả đúng hình dạng mà phép tính bên dưới mong đợi. */
export async function loadTuitionScheduleData(month: number, year: number): Promise<TuitionScheduleData> {
  const from = new Date(Date.UTC(year, month - 1, 1)), to = new Date(Date.UTC(year, month, 0))
  const enrollments = (await prisma.classEnrollment.findMany({ include: enrollmentInclude })).map(enrollmentDoc)
  const classIds = [...new Set(enrollments.map((e: any) => e.classId as string))]
  const [classes, students, sessions, promotions, privateSessions, records, paid] = await Promise.all([
    prisma.class.findMany({ where: { id: { in: classIds } }, include: classInclude }).then(rows => rows.map(classDoc)),
    // Phụ huynh liên hệ chính (ưu tiên isPrimaryContact, nếu không có lấy người đầu tiên) — thay cho primaryParent* denorm cũ.
    prisma.student.findMany({
      select: { id: true, fullName: true, gradeLevel: true, parents: { orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }], take: 1 } },
    }).then(rows => rows.map(({ parents, ...s }) => ({
      ...s, primaryParentName: parents[0]?.fullName || null, primaryParentPhone: parents[0]?.phone ?? null, primaryParentZalo: parents[0]?.zalo ?? null,
    }))),
    prisma.session.findMany({ where: { classId: { in: classIds }, sessionDate: { gte: from, lte: to } }, include: sessionInclude }).then(rows => rows.map(sessionDoc)),
    prisma.studentPromotion.findMany({ include: studentPromotionInclude }).then(rows => rows.map(studentPromotionDoc)),
    prisma.privateSession.findMany({ where: { sessionDate: { gte: from, lte: to } }, include: privateSessionInclude }).then(rows => rows.map(privateSessionDoc)),
    prisma.tuitionRecord.findMany({ where: { billingMonth: month, billingYear: year }, include: tuitionRecordInclude }).then(rows => rows.map(tuitionRecordDoc)),
    prisma.payment.groupBy({ by: ['tuitionRecordId'], where: { tuitionRecord: { billingMonth: month, billingYear: year } }, _sum: { amount: true } }),
  ])
  return { enrollments, classes, students, sessions, promotions, privateSessions, records,
    paidByRecord: new Map(paid.map(p => [p.tuitionRecordId, p._sum.amount ?? 0])) }
}

/** Shared calculation for the tuition page and automated exports. */
export async function getTuitionScheduleSummary(month: number, year: number) {
  return buildTuitionScheduleSummary(await loadTuitionScheduleData(month, year), month, year)
}

export function buildTuitionScheduleSummary(data: TuitionScheduleData, month: number, year: number) {
  const m = month
  const y = year
  const monthStr = `${y}-${String(m).padStart(2, '0')}`
  const fromDate = `${monthStr}-01`
  const toDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`

  // 1. Lấy tất cả enrollments: ACTIVE hoặc DROPPED nhưng dropDate >= fromDate
  const relevantEnrollments = data.enrollments.filter(e => {
    if (e.status === 'ACTIVE') return true
    if (e.status === 'DROPPED' && e.dropDate && e.dropDate >= fromDate) return true
    return false
  })

  // 3. Classes / 4. Students
  const classMap: Record<string, any> = {}
  for (const cls of data.classes) classMap[cls.id] = cls
  const studentMap: Record<string, any> = {}
  for (const stu of data.students) studentMap[stu.id] = stu

  // 5. Sessions trong tháng theo lớp
  const sessionsByClass: Record<string, any[]> = {}
  for (const sess of data.sessions) (sessionsByClass[sess.classId] ??= []).push(sess)

  const promotionMap: Record<string, any[]> = {}
  for (const p of data.promotions) {
    if ((p.appliedFrom && p.appliedFrom > toDate) || (p.appliedTo && p.appliedTo < fromDate)) continue
    const key = `${p.studentId}-${p.classId}`
    if (!promotionMap[key]) promotionMap[key] = []
    promotionMap[key].push(p)
  }

  // One monthly row per student/class, even after dropping and re-enrolling.
  const enrollmentGroups = new Map<string, any[]>()
  for (const enrollment of relevantEnrollments) {
    const key = `${enrollment.studentId}-${enrollment.classId}`
    const group = enrollmentGroups.get(key) ?? []
    group.push(enrollment)
    enrollmentGroups.set(key, group)
  }

  // 7. Tính từng học viên/lớp; các khoảng đăng ký có thể chồng ngày.
  const rows: any[] = []
  const buildPrimaryParent = (stu: any) => stu.primaryParentName
    ? {
        fullName: stu.primaryParentName as string,
        phone: (stu.primaryParentPhone as string | null) ?? null,
        zalo: (stu.primaryParentZalo as string | null) ?? null,
      }
    : null

  for (const group of enrollmentGroups.values()) {
    // Prefer the current enrollment when two enrollment intervals cover a session.
    group.sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE')
      || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      || String(a.id).localeCompare(String(b.id)))
    const enrollment = group[0]
    const cls = classMap[enrollment.classId]
    const student = studentMap[enrollment.studentId]
    if (!cls || !student) continue

    const classSessions = sessionsByClass[enrollment.classId] ?? []
    const sessions = classSessions.flatMap((sess: any) => {
      if (!sess.sessionDate || !sess.sessionDate.startsWith(monthStr) || sess.status === 'CANCELLED') return []
      const covering = group.find(e => (!e.enrollmentDate || sess.sessionDate >= e.enrollmentDate)
        && (e.status !== 'DROPPED' || !e.dropDate || sess.sessionDate <= e.dropDate))
      if (!covering) return []
      return [{ ...sess, rate: Number(covering.customTuitionRate) || classRateForMonth(cls, m, y) }]
    })

    const totalSessions = sessions.length
    if (totalSessions === 0) continue

    const baseAmount = sessions.reduce((sum, session) => sum + session.rate, 0)
    const ratePerSession = baseAmount / totalSessions
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

  // Học riêng trong tháng
  const allPrivate = data.privateSessions.filter((ps: any) => ps.status !== 'CANCELLED')

  // Group by studentId
  const privateByStudent: Record<string, any[]> = {}
  for (const ps of allPrivate) {
    if (!privateByStudent[ps.studentId]) privateByStudent[ps.studentId] = []
    privateByStudent[ps.studentId].push(ps)
  }

  for (const [sid, sessions] of Object.entries(privateByStudent)) {
    const student = studentMap[sid]
    if (!student) continue
    const totalAmount = sessions.reduce((sum, ps) => sum + (ps.ratePerSession || 0), 0)
    const totalSessions = sessions.length
    const avgRate = totalSessions > 0 ? Math.round(totalAmount / totalSessions) : 0

    let discountAmount = 0
    for (const p of (promotionMap[`${sid}-private`] ?? [])) {
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
  const recordsByKey = new Map<string, TuitionRecord>()
  for (const d of data.records) recordsByKey.set(`${d.studentId}-${d.classId}`, d)

  rows.forEach(row => {
    const rec = recordsByKey.get(`${row.studentId}-${row.classId}`)
    if (rec) {
      const paid = data.paidByRecord.get(rec.id) || 0
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
