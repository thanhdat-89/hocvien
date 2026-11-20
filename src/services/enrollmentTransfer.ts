import { prisma, newId, toDay, toClassId } from '../lib/db'
import { enrollmentDoc, enrollmentInclude } from '../lib/docs'
import { recountClassActiveStudents } from '../lib/classSync'
import type { ClassEnrollment } from '../types/models'
import { calculateTuitionForStudent, estimateClassTuition } from './tuitionCalculator'
import { isDate, lastDayOf, monthKey, normalizeDays, type MonthImpact } from './enrollmentWeekdays'
import { gradeOf } from './schoolYearRollover'

// Chuyển lớp trong cùng khối = nghỉ lớp cũ (đến hết ngày liền trước) + đăng ký lớp mới (từ ngày bắt đầu), ghi trong một lần.
// Học phí lớp cũ:
//   - phiếu chưa thu/chưa xuất HĐ: tính lại theo ngày nghỉ (không còn buổi thì xoá);
//   - phiếu đã thu/đã xuất HĐ: giữ nguyên; phần tiền các buổi lớp cũ không học nữa có thể cấn trừ
//     vào học phí lớp mới tháng sau (người dùng chọn có/không) bằng một khoản giảm trừ số tiền cố định.
// Học phí lớp mới: theo đơn giá lớp mới; tháng nào lớp cũ đã có phiếu thì lập luôn phiếu lớp mới.

const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }) }
const dayBefore = (date: string) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
const vnDate = (date: string) => date.split('-').reverse().join('/')

export interface TransferInput {
  toClassId?: unknown
  /** Ngày bắt đầu học lớp mới; lớp cũ học đến hết ngày liền trước. */
  startDate?: unknown
  /** Buổi học trong tuần ở lớp mới; bỏ trống/đủ = học đủ. */
  days?: unknown
  /** Có cấn trừ phần đã thu của lớp cũ vào lớp mới không — bắt buộc khi có khoản cấn trừ. */
  applyCredit?: unknown
}

type Outcome = MonthImpact['outcome'] | 'create'
export interface TransferMonth extends Omit<MonthImpact, 'outcome'> { outcome: Outcome }

export interface TransferCredit {
  /** Số tiền lớp cũ đã thu/xuất HĐ cho các buổi sau ngày chuyển. */
  amount: number
  sessions: number
  /** Tháng cấn trừ vào học phí lớp mới. */
  month: number
  year: number
  /** Ước tính học phí lớp mới tháng cấn trừ (trước cấn trừ) — để cảnh báo khi khoản cấn trừ lớn hơn. */
  nextMonthAmount: number
}

async function prepareTransfer(studentId: string, enrollmentId: string, input: TransferInput) {
  const row = await prisma.classEnrollment.findFirst({ where: { id: enrollmentId, studentId }, include: { ...enrollmentInclude, class: true } })
  if (!row) return fail('Không tìm thấy ghi danh', 404)
  const old: ClassEnrollment = enrollmentDoc(row)
  if (old.status !== 'ACTIVE') fail('Lớp này học viên đã nghỉ', 409)

  if (typeof input.toClassId !== 'string' || !input.toClassId) fail('Chưa chọn lớp chuyển đến')
  const toClassId = input.toClassId as string
  if (toClassId === old.classId) fail('Lớp chuyển đến trùng lớp đang học')
  const target = await prisma.class.findUnique({ where: { id: toClassId } })
  if (!target) return fail('Không tìm thấy lớp chuyển đến', 404)
  if (target.status !== 'ACTIVE') fail(`Lớp ${target.name} không còn hoạt động`)
  if (target.branchId !== row.class.branchId) fail('Chỉ chuyển được sang lớp cùng cơ sở')
  const fromGrade = gradeOf(row.class), toGrade = gradeOf(target)
  if (!fromGrade || fromGrade !== toGrade) fail(`Chỉ chuyển được sang lớp cùng khối${fromGrade ? ` ${fromGrade}` : ''}`)
  const already = await prisma.classEnrollment.findFirst({ where: { studentId, classId: toClassId, status: 'ACTIVE' }, select: { id: true } })
  if (already) fail(`Học viên đang học lớp ${target.name}`, 409)

  if (!isDate(input.startDate)) fail('Ngày bắt đầu học lớp mới không hợp lệ')
  const startDate = input.startDate as string
  if (startDate <= old.enrollmentDate) fail(`Ngày bắt đầu học lớp mới phải sau ngày đăng ký lớp cũ (${vnDate(old.enrollmentDate)})`)
  const dropDate = dayBefore(startDate)
  const days = await normalizeDays(toClassId, startDate, input.days)

  const newEnrollment = {
    id: '__transfer__', classId: toClassId, studentId, enrollmentDate: startDate, status: 'ACTIVE',
    createdAt: new Date().toISOString(), weekdayPlans: days.length ? [{ effectiveFrom: startDate, days }] : [],
  } as unknown as ClassEnrollment
  return {
    old, oldClassName: row.class.name, target, startDate, dropDate, days,
    dropOld: (list: ClassEnrollment[]) => list.map(e => e.id === enrollmentId ? { ...e, status: 'DROPPED', dropDate } as ClassEnrollment : e),
    addNew: (list: ClassEnrollment[]) => [...list, newEnrollment],
  }
}

type Prepared = Awaited<ReturnType<typeof prepareTransfer>>

async function classRecords(studentId: string, classId: string, fromMonth: string) {
  const records = (await prisma.tuitionRecord.findMany({
    where: { studentId, classId },
    select: { id: true, billingMonth: true, billingYear: true, status: true, paidAmount: true, finalAmount: true, _count: { select: { payments: true } } },
  })).filter(r => monthKey(r.billingMonth, r.billingYear) >= fromMonth)
  const invoiced = records.length ? await prisma.misaInvoice.findMany({
    where: { OR: [{ id: { in: records.map(r => r.id) } }, { recordIds: { hasSome: records.map(r => r.id) } }] },
    select: { id: true, recordIds: true },
  }) : []
  const invoicedIds = new Set(invoiced.flatMap(i => [i.id, ...i.recordIds]))
  return records.map(r => ({ ...r, locked: r.status === 'PAID' || r.status === 'PARTIAL' || r.paidAmount > 0 || invoicedIds.has(r.id) }))
}

async function evaluateTransfer(studentId: string, p: Prepared) {
  const fromMonth = p.startDate.slice(0, 7)
  const [y, m] = fromMonth.split('-').map(Number)
  const [oldRecords, newRecords] = await Promise.all([
    classRecords(studentId, p.old.classId, fromMonth),
    classRecords(studentId, p.target.id, fromMonth),
  ])

  // Lớp cũ: tháng bắt đầu chuyển + các tháng sau đã có phiếu.
  const oldMonths = new Map<string, [number, number]>([[fromMonth, [m, y]]])
  for (const r of oldRecords) oldMonths.set(monthKey(r.billingMonth, r.billingYear), [r.billingMonth, r.billingYear])

  const oldClass: (TransferMonth & { recordId?: string })[] = []
  let creditAmount = 0, creditSessions = 0
  for (const [key, [month, year]] of [...oldMonths].sort(([a], [b]) => a.localeCompare(b))) {
    const [before, after] = await Promise.all([
      estimateClassTuition(studentId, p.old.classId, month, year),
      estimateClassTuition(studentId, p.old.classId, month, year, p.dropOld),
    ])
    const r = oldRecords.find(x => monthKey(x.billingMonth, x.billingYear) === key)
    const outcome: Outcome = !r ? 'none'
      : r.locked ? 'locked'
      : after.totalSessions === 0 && r._count.payments === 0 ? 'delete'
      : 'recalculate'
    if (r?.locked) {
      creditAmount += Math.max(0, r.finalAmount - after.finalAmount)
      creditSessions += Math.max(0, before.totalSessions - after.totalSessions)
    }
    oldClass.push({
      month, year, recordId: r?.id, outcome,
      before: { sessions: before.totalSessions, amount: before.finalAmount },
      after: { sessions: after.totalSessions, amount: after.finalAmount },
      record: r ? { status: r.status, finalAmount: r.finalAmount, locked: r.locked } : null,
    })
  }

  const creditKey = monthKey(m === 12 ? 1 : m + 1, m === 12 ? y + 1 : y)
  const [cy, cm] = creditKey.split('-').map(Number)

  // Lớp mới: các tháng của lớp cũ ở trên (+ tháng cấn trừ nếu có) và các tháng lớp mới đã có phiếu (học lại lớp cũ từng học).
  const newMonths = new Map(oldMonths)
  for (const r of newRecords) newMonths.set(monthKey(r.billingMonth, r.billingYear), [r.billingMonth, r.billingYear])
  if (creditAmount > 0) newMonths.set(creditKey, [cm, cy])
  const newClass: (TransferMonth & { recordId?: string })[] = []
  let nextMonthAmount = 0
  for (const [key, [month, year]] of [...newMonths].sort(([a], [b]) => a.localeCompare(b))) {
    const [before, after] = await Promise.all([
      newRecords.length ? estimateClassTuition(studentId, p.target.id, month, year) : Promise.resolve(null),
      estimateClassTuition(studentId, p.target.id, month, year, p.addNew),
    ])
    if (key === creditKey) nextMonthAmount = after.finalAmount
    const r = newRecords.find(x => monthKey(x.billingMonth, x.billingYear) === key)
    const oldHadRecord = oldRecords.some(x => monthKey(x.billingMonth, x.billingYear) === key)
    const outcome: Outcome = r ? (r.locked ? 'locked' : 'recalculate')
      : oldHadRecord && after.totalSessions > 0 ? 'create'
      : 'none'
    newClass.push({
      month, year, recordId: r?.id, outcome,
      before: { sessions: before?.totalSessions ?? 0, amount: before?.finalAmount ?? 0 },
      after: { sessions: after.totalSessions, amount: after.finalAmount },
      record: r ? { status: r.status, finalAmount: r.finalAmount, locked: r.locked } : null,
    })
  }

  const credit: TransferCredit | null = creditAmount > 0
    ? { amount: creditAmount, sessions: creditSessions, month: cm, year: cy, nextMonthAmount }
    : null
  return { oldClass, newClass, credit }
}

const strip = ({ recordId: _id, ...rest }: TransferMonth & { recordId?: string }): TransferMonth => rest

/** Xem trước chuyển lớp: học phí hai lớp theo tháng và khoản cấn trừ (nếu có). Không ghi gì. */
export async function previewTransfer(studentId: string, enrollmentId: string, input: TransferInput) {
  const p = await prepareTransfer(studentId, enrollmentId, input)
  const { oldClass, newClass, credit } = await evaluateTransfer(studentId, p)
  return {
    startDate: p.startDate, dropDate: p.dropDate,
    oldClass: { id: p.old.classId, name: p.oldClassName, months: oldClass.map(strip) },
    newClass: { id: p.target.id, name: p.target.name, months: newClass.map(strip) },
    credit,
  }
}

/** Chuyển lớp: nghỉ lớp cũ + đăng ký lớp mới (+ cấn trừ nếu được chọn) trong một transaction, rồi tính lại học phí. */
export async function transferEnrollment(studentId: string, enrollmentId: string, input: TransferInput, userId?: string) {
  const p = await prepareTransfer(studentId, enrollmentId, input)
  const { oldClass, newClass, credit } = await evaluateTransfer(studentId, p)
  if (credit && typeof input.applyCredit !== 'boolean') {
    fail(`Lớp cũ đã thu ${credit.amount.toLocaleString('vi-VN')}đ cho các buổi sau ngày chuyển. Hãy chọn có cấn trừ vào học phí lớp mới hay không.`)
  }
  const applyCredit = !!credit && input.applyCredit === true
  const note = `Chuyển từ lớp ${p.oldClassName} sang lớp ${p.target.name} từ ${vnDate(p.startDate)}`

  const created = await prisma.$transaction(async tx => {
    const oldNotes = p.old.notes ? `${p.old.notes}\n${note}` : note
    await tx.classEnrollment.update({ where: { id: enrollmentId }, data: { status: 'DROPPED', dropDate: toDay(p.dropDate)!, notes: oldNotes } })
    const enrollment = await tx.classEnrollment.create({
      data: { id: newId(), classId: p.target.id, studentId, enrollmentDate: toDay(p.startDate)!, status: 'ACTIVE', notes: note },
    })
    if (p.days.length) {
      await tx.enrollmentWeekdayPlan.create({ data: { id: newId(), enrollmentId: enrollment.id, effectiveFrom: toDay(p.startDate)!, days: p.days } })
    }
    if (applyCredit && credit) {
      const name = `Cấn trừ chuyển lớp từ ${p.oldClassName} - ${p.target.name}`
      const promotionId = newId()
      await tx.promotion.create({ data: { id: promotionId, name, type: 'FIXED_AMOUNT', value: credit.amount, isActive: false } })
      await tx.studentPromotion.create({
        data: {
          id: newId(), studentId, classId: toClassId(p.target.id), className: p.target.name,
          promotionId, promotionName: name, promotionType: 'FIXED_AMOUNT', promotionValue: credit.amount,
          appliedFrom: toDay(`${monthKey(credit.month, credit.year)}-01`)!, appliedTo: toDay(lastDayOf(credit.month, credit.year))!,
          approvedById: userId ?? null,
          notes: `${credit.sessions} buổi lớp ${p.oldClassName} đã thu sau ngày chuyển ${vnDate(p.startDate)}`,
        },
      })
    }
    await recountClassActiveStudents(p.old.classId, tx)
    await recountClassActiveStudents(p.target.id, tx)
    return enrollment
  })

  for (const i of oldClass) {
    if (!i.recordId) continue
    if (i.outcome === 'delete') await prisma.tuitionRecord.delete({ where: { id: i.recordId } })
    else if (i.outcome === 'recalculate') await calculateTuitionForStudent(studentId, p.old.classId, i.month, i.year)
  }
  for (const i of newClass) {
    if (i.outcome === 'create' || i.outcome === 'recalculate') await calculateTuitionForStudent(studentId, p.target.id, i.month, i.year)
  }

  const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { id: created.id }, include: enrollmentInclude })
  return { enrollment: enrollmentDoc(enrollment), creditApplied: applyCredit ? credit!.amount : 0 }
}

