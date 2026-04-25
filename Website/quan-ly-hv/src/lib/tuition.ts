import { db, C, toDocs } from './firebase'
import type { ClassEnrollment } from '../types/models'

export interface TuitionSummaryRow {
  monthKey: string
  month: number
  year: number
  classId: string
  className: string
  totalSessions: number
  ratePerSession: number
  discountAmount: number
  baseAmount: number
  finalAmount: number
}

export interface StudentPromoSummary {
  id: string
  classId: string
  className: string
  promotionType: string
  promotionValue: number
  appliedFrom: string
  appliedTo?: string
}

export async function computeTuitionSummary(studentId: string): Promise<TuitionSummaryRow[]> {
  const enrollSnap = await db.collection(C.ENROLLMENTS)
    .where('studentId', '==', studentId)
    .get()
  const enrollments = toDocs<ClassEnrollment>(enrollSnap)

  const classIds = [...new Set(enrollments.map(e => e.classId))]
  const classDocs = await Promise.all(classIds.map(id => db.collection(C.CLASSES).doc(id).get()))
  const classMap: Record<string, any> = {}
  classDocs.forEach(d => { if (d.exists) classMap[d.id] = { id: d.id, ...d.data() } })

  const rows: Record<string, {
    monthKey: string; month: number; year: number
    classId: string; className: string
    totalSessions: number; ratePerSession: number
    discountAmount: number
  }> = {}

  await Promise.all(enrollments.map(async (enroll) => {
    const fromDate = enroll.enrollmentDate ?? '2000-01-01'
    const toDate = enroll.status === 'DROPPED' && (enroll as any).dropDate
      ? (enroll as any).dropDate
      : '9999-12-31'

    const sessSnap = await db.collection(C.SESSIONS)
      .where('classId', '==', enroll.classId)
      .get()
    const sessions = toDocs<any>(sessSnap).filter((s: any) =>
      s.sessionDate >= fromDate && s.sessionDate <= toDate && s.status !== 'CANCELLED'
    )

    const cls = classMap[enroll.classId] ?? {}
    const rate = (enroll as any).customTuitionRate || cls.tuitionRate || 0

    const today = new Date().toISOString().slice(0, 10)
    const promoSnap = await db.collection(C.STUDENT_PROMOTIONS)
      .where('studentId', '==', studentId)
      .where('classId', '==', enroll.classId)
      .get()
    const promos = toDocs<any>(promoSnap).filter(p =>
      (!p.appliedTo || p.appliedTo >= fromDate) && (!p.appliedFrom || p.appliedFrom <= today)
    )

    const monthCounts: Record<string, number> = {}
    sessions.forEach((s: any) => {
      const mk = s.sessionDate.slice(0, 7)
      monthCounts[mk] = (monthCounts[mk] ?? 0) + 1
    })

    Object.entries(monthCounts).forEach(([mk, count]) => {
      const [y, m] = mk.split('-')
      const baseAmt = count * rate

      let discount = 0
      for (const p of promos) {
        if (p.promotionType === 'PERCENTAGE') discount += (baseAmt * p.promotionValue) / 100
        else if (p.promotionType === 'FIXED_AMOUNT') discount += p.promotionValue
        else if (p.promotionType === 'FREE_SESSIONS') discount += p.promotionValue * rate
      }
      discount = Math.min(discount, baseAmt)

      const key = `${mk}__${enroll.classId}`
      if (!rows[key]) {
        rows[key] = {
          monthKey: mk, month: Number(m), year: Number(y),
          classId: enroll.classId, className: enroll.className || cls.name || '',
          totalSessions: 0, ratePerSession: rate, discountAmount: 0,
        }
      }
      rows[key].totalSessions += count
      rows[key].discountAmount += discount
    })
  }))

  // Học riêng
  const privateSnap = await db.collection(C.PRIVATE_SCHEDULES)
    .where('studentId', '==', studentId)
    .get()
  const privateSessions = toDocs<any>(privateSnap).filter((s: any) => s.status !== 'CANCELLED')

  const privatePromoSnap = await db.collection(C.STUDENT_PROMOTIONS)
    .where('studentId', '==', studentId)
    .where('classId', '==', 'private')
    .get()
  const privatePromos = toDocs<any>(privatePromoSnap)

  const privateMonthCounts: Record<string, { count: number; totalAmount: number }> = {}
  for (const ps of privateSessions) {
    const mk = ps.sessionDate.slice(0, 7)
    if (!privateMonthCounts[mk]) privateMonthCounts[mk] = { count: 0, totalAmount: 0 }
    privateMonthCounts[mk].count += 1
    privateMonthCounts[mk].totalAmount += ps.ratePerSession || 0
  }

  for (const [mk, { count, totalAmount }] of Object.entries(privateMonthCounts)) {
    const [y, m] = mk.split('-')
    const avgRate = count > 0 ? Math.round(totalAmount / count) : 0
    const today = new Date().toISOString().slice(0, 10)
    const monthFrom = `${mk}-01`
    const activePrivatePromos = privatePromos.filter(p =>
      (!p.appliedTo || p.appliedTo >= monthFrom) && (!p.appliedFrom || p.appliedFrom <= today)
    )
    let privateDiscount = 0
    for (const p of activePrivatePromos) {
      if (p.promotionType === 'PERCENTAGE') privateDiscount += (totalAmount * p.promotionValue) / 100
      else if (p.promotionType === 'FIXED_AMOUNT') privateDiscount += p.promotionValue
    }
    privateDiscount = Math.min(privateDiscount, totalAmount)

    rows[`${mk}__private`] = {
      monthKey: mk, month: Number(m), year: Number(y),
      classId: 'private', className: 'Học riêng',
      totalSessions: count, ratePerSession: avgRate, discountAmount: privateDiscount,
    }
  }

  return Object.values(rows)
    .map(r => {
      if (r.classId === 'private') {
        const base = privateSessions
          .filter((ps: any) => ps.sessionDate.startsWith(r.monthKey) && ps.status !== 'CANCELLED')
          .reduce((sum: number, ps: any) => sum + (ps.ratePerSession || 0), 0)
        return { ...r, baseAmount: base, finalAmount: Math.max(0, base - r.discountAmount) }
      }
      return {
        ...r,
        baseAmount: r.totalSessions * r.ratePerSession,
        finalAmount: Math.max(0, r.totalSessions * r.ratePerSession - r.discountAmount),
      }
    })
    .sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month)
}

export async function loadStudentPromotions(studentId: string): Promise<StudentPromoSummary[]> {
  const snap = await db.collection(C.STUDENT_PROMOTIONS)
    .where('studentId', '==', studentId)
    .get()
  return toDocs<any>(snap).map(p => ({
    id: p.id,
    classId: p.classId,
    className: p.className ?? (p.classId === 'private' ? 'Học riêng' : ''),
    promotionType: p.promotionType,
    promotionValue: p.promotionValue,
    appliedFrom: p.appliedFrom,
    appliedTo: p.appliedTo,
  }))
}
