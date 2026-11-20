import { prisma, newId, toDay, type Tx } from '../lib/db'
import { enrollmentDoc, enrollmentInclude, scheduleDoc, scheduleInclude, vietnamToday } from '../lib/docs'
import { recountClassActiveStudents } from '../lib/classSync'
import { isWeekday, WEEKDAY_LABELS, WEEKDAYS, type Weekday, type WeekdayPlan } from '../lib/enrollmentDays'
import type { ClassEnrollment } from '../types/models'
import { calculateTuitionForStudent, estimateClassTuition } from './tuitionCalculator'

const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }) }
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const label = (days: string[]) => days.map(d => WEEKDAY_LABELS[d as Weekday] ?? d).join(', ')
const monthKey = (month: number, year: number) => `${year}-${String(month).padStart(2, '0')}`

/** Các thứ lớp có lịch học vào/sau ngày `from` — chỉ được chọn trong số này. */
async function classWeekdaysFrom(classId: string, from: string, tx: Tx = prisma): Promise<Weekday[]> {
  const schedules = (await tx.schedule.findMany({ where: { classId }, include: scheduleInclude })).map(scheduleDoc)
  const days = new Set(schedules.filter((s: any) => !s.effectiveTo || s.effectiveTo >= from).map((s: any) => s.dayOfWeek as string))
  return WEEKDAYS.filter(d => days.has(d))
}

/**
 * Chuẩn hoá danh sách thứ học viên chọn. Trả [] khi học đủ mọi buổi của lớp
 * (để lớp thêm buổi sau này thì học viên học đủ vẫn được tính đủ).
 */
async function normalizeDays(classId: string, from: string, input: unknown, tx: Tx = prisma): Promise<Weekday[]> {
  if (input == null) return []
  if (!Array.isArray(input) || !input.every(isWeekday)) fail('Ngày học trong tuần không hợp lệ')
  const chosen = new Set(input as Weekday[])
  const classDays = await classWeekdaysFrom(classId, from, tx)
  const outside = [...chosen].filter(d => !classDays.includes(d))
  if (outside.length) fail(`Lớp không có buổi học vào ${label(outside)}`)
  if (classDays.length && chosen.size === 0) fail('Cần chọn ít nhất một buổi học trong tuần')
  if (classDays.every(d => chosen.has(d))) return []
  return WEEKDAYS.filter(d => chosen.has(d))
}

/** Đặt lịch cố định ngay khi ghi danh (trong transaction tạo ghi danh). */
export async function createInitialWeekdayPlan(tx: Tx, enrollment: { id: string; classId: string; enrollmentDate: Date }, input: unknown) {
  const from = enrollment.enrollmentDate.toISOString().slice(0, 10)
  const days = await normalizeDays(enrollment.classId, from, input, tx)
  if (!days.length) return
  await tx.enrollmentWeekdayPlan.create({ data: { id: newId(), enrollmentId: enrollment.id, effectiveFrom: enrollment.enrollmentDate, days } })
}

// ─── Đổi buổi học / nghỉ lớp: cùng một quy trình xem trước → kiểm tra khoá → ghi ───────────────

export type EnrollmentChange =
  | { action: 'weekdays'; days?: unknown; effectiveFrom?: unknown }
  | { action: 'drop'; dropDate?: unknown }

/** Ảnh hưởng tới học phí một tháng (số tiền đã trừ khuyến mãi). */
export interface MonthImpact {
  month: number
  year: number
  before: { sessions: number; amount: number }
  after: { sessions: number; amount: number }
  /** Phiếu đang có: không có = chưa lập phiếu (sẽ tính theo lịch mới khi lập). */
  record: { status: string; finalAmount: number; locked: boolean } | null
  /** none: không đổi · recalculate: phiếu chưa thu được tính lại · delete: phiếu chưa thu bị xoá (không còn buổi) · locked: đã thu/xuất HĐ */
  outcome: 'none' | 'recalculate' | 'delete' | 'locked'
}

interface Prepared {
  enrollment: ClassEnrollment
  /** Ngày bắt đầu có hiệu lực: ngày áp dụng lịch mới, hoặc ngày sau ngày nghỉ. */
  fromDate: string
  adjust: (enrollments: ClassEnrollment[]) => ClassEnrollment[]
  /** Đổi buổi: tháng đã thu/xuất HĐ luôn chặn. Nghỉ lớp: chỉ chặn khi tháng đó bị bớt buổi. */
  lockAnyAffectedMonth: boolean
  write: (tx: Tx) => Promise<void>
  /** Phiếu chưa thu không còn buổi nào thì xoá (chỉ khi nghỉ lớp). */
  deleteEmpty: boolean
}

async function prepare(studentId: string, enrollmentId: string, change: EnrollmentChange): Promise<Prepared> {
  const row = await prisma.classEnrollment.findFirst({ where: { id: enrollmentId, studentId }, include: enrollmentInclude })
  if (!row) return fail('Không tìm thấy ghi danh', 404)
  const enrollment: ClassEnrollment = enrollmentDoc(row)
  if (enrollment.status !== 'ACTIVE') fail('Lớp này học viên đã nghỉ', 409)
  const replace = (patch: Partial<ClassEnrollment>) => (list: ClassEnrollment[]) =>
    list.map(e => e.id === enrollmentId ? { ...e, ...patch } : e)

  if (change.action === 'drop') {
    if (change.dropDate != null && change.dropDate !== '' && !isDate(change.dropDate)) fail('Ngày nghỉ không hợp lệ')
    const dropDate = (change.dropDate as string | undefined) || vietnamToday()
    if (dropDate < enrollment.enrollmentDate) fail(`Ngày nghỉ không được trước ngày đăng ký (${enrollment.enrollmentDate})`)
    const next = new Date(`${dropDate}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1)
    return {
      enrollment,
      fromDate: next.toISOString().slice(0, 10),
      adjust: replace({ status: 'DROPPED', dropDate } as Partial<ClassEnrollment>),
      lockAnyAffectedMonth: false,
      deleteEmpty: true,
      write: async tx => {
        await tx.classEnrollment.update({ where: { id: enrollmentId }, data: { status: 'DROPPED', dropDate: toDay(dropDate)! } })
        await recountClassActiveStudents(enrollment.classId, tx)
      },
    }
  }

  if (change.effectiveFrom != null && change.effectiveFrom !== '' && !isDate(change.effectiveFrom)) fail('Ngày áp dụng không hợp lệ')
  const requested = (change.effectiveFrom as string | undefined) || enrollment.enrollmentDate
  // Áp dụng trước ngày ghi danh cũng như áp dụng từ ngày ghi danh.
  const effectiveFrom = requested < enrollment.enrollmentDate ? enrollment.enrollmentDate : requested
  const days = await normalizeDays(enrollment.classId, effectiveFrom, change.days)
  // Lịch mới thay mọi kế hoạch từ ngày áp dụng trở đi; học đủ và không có lịch riêng trước đó → không cần dòng nào.
  const earlier = ((enrollment as any).weekdayPlans ?? [] as WeekdayPlan[])
    .filter((p: WeekdayPlan) => p.effectiveFrom < effectiveFrom && p.effectiveFrom >= enrollment.enrollmentDate)
  const plans: WeekdayPlan[] = days.length || earlier.length ? [...earlier, { effectiveFrom, days }] : earlier
  return {
    enrollment,
    fromDate: effectiveFrom,
    adjust: replace({ weekdayPlans: plans } as Partial<ClassEnrollment>),
    lockAnyAffectedMonth: true,
    deleteEmpty: false,
    write: async tx => {
      await tx.enrollmentWeekdayPlan.deleteMany({
        where: { enrollmentId, OR: [{ effectiveFrom: { gte: toDay(effectiveFrom)! } }, { effectiveFrom: { lt: toDay(enrollment.enrollmentDate)! } }] },
      })
      if (days.length || earlier.length) {
        await tx.enrollmentWeekdayPlan.create({ data: { id: newId(), enrollmentId, effectiveFrom: toDay(effectiveFrom)!, days } })
      }
    },
  }
}

/** Tính ảnh hưởng tới từng tháng (tháng bắt đầu hiệu lực + các tháng sau đã có phiếu) và lý do bị chặn nếu có. */
async function evaluate(studentId: string, p: Prepared) {
  const classId = p.enrollment.classId
  const fromMonth = p.fromDate.slice(0, 7)
  const records = (await prisma.tuitionRecord.findMany({
    where: { studentId, classId },
    select: { id: true, billingMonth: true, billingYear: true, status: true, paidAmount: true, finalAmount: true, _count: { select: { payments: true } } },
  })).filter(r => monthKey(r.billingMonth, r.billingYear) >= fromMonth)
  const invoiced = records.length ? await prisma.misaInvoice.findMany({
    where: { OR: [{ id: { in: records.map(r => r.id) } }, { recordIds: { hasSome: records.map(r => r.id) } }] },
    select: { id: true, recordIds: true },
  }) : []
  const invoicedIds = new Set(invoiced.flatMap(i => [i.id, ...i.recordIds]))
  const isLocked = (r: typeof records[number]) =>
    r.status === 'PAID' || r.status === 'PARTIAL' || r.paidAmount > 0 || invoicedIds.has(r.id)

  const [y, m] = fromMonth.split('-').map(Number)
  const months = new Map<string, { month: number; year: number }>([[fromMonth, { month: m, year: y }]])
  for (const r of records) months.set(monthKey(r.billingMonth, r.billingYear), { month: r.billingMonth, year: r.billingYear })

  const impacts: (MonthImpact & { recordId?: string })[] = []
  for (const [key, { month, year }] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
    const [before, after] = await Promise.all([
      estimateClassTuition(studentId, classId, month, year),
      estimateClassTuition(studentId, classId, month, year, p.adjust),
    ])
    const r = records.find(x => monthKey(x.billingMonth, x.billingYear) === key)
    const locked = !!r && isLocked(r)
    const changed = before.totalSessions !== after.totalSessions || before.finalAmount !== after.finalAmount
    const blocks = locked && (p.lockAnyAffectedMonth || changed)
    const outcome: MonthImpact['outcome'] = !r ? 'none'
      : locked ? (blocks ? 'locked' : 'none')
      : p.deleteEmpty && after.totalSessions === 0 && r._count.payments === 0 ? 'delete'
      : 'recalculate'
    impacts.push({
      month, year, recordId: r?.id,
      before: { sessions: before.totalSessions, amount: before.finalAmount },
      after: { sessions: after.totalSessions, amount: after.finalAmount },
      record: r ? { status: r.status, finalAmount: r.finalAmount, locked } : null,
      outcome,
    })
  }

  const blockedMonths = impacts.filter(i => i.outcome === 'locked')
  const blocked = blockedMonths.length
    ? `Học phí ${blockedMonths.map(i => `T${i.month}/${i.year}`).join(', ')} của lớp này đã thu hoặc đã xuất hoá đơn. `
      + (p.deleteEmpty ? 'Hãy chọn ngày nghỉ sau buổi học cuối của các tháng đó.' : 'Hãy chọn ngày áp dụng sau các tháng đó.')
    : null
  return { impacts, blocked }
}

const publicImpact = ({ recordId: _id, ...rest }: MonthImpact & { recordId?: string }): MonthImpact => rest

/** Xem trước đổi buổi học / nghỉ lớp: không ghi gì. */
export async function previewEnrollmentChange(studentId: string, enrollmentId: string, change: EnrollmentChange) {
  const p = await prepare(studentId, enrollmentId, change)
  const { impacts, blocked } = await evaluate(studentId, p)
  const suggestedDate = blocked ? await suggestDate(studentId, enrollmentId, change, impacts) : null
  return { fromDate: p.fromDate, months: impacts.map(publicImpact), blocked, suggestedDate }
}

const lastDayOf = (month: number, year: number) => `${monthKey(month, year)}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`
const firstDayAfter = (month: number, year: number) => month === 12 ? `${year + 1}-01-01` : `${monthKey(month + 1, year)}-01`

/**
 * Ngày gợi ý khi bị chặn vì tháng đã thu/xuất hoá đơn: nghỉ lớp → ngày cuối của tháng bị chặn sau cùng
 * (học hết tháng đó rồi nghỉ); đổi buổi → ngày đầu tháng kế tiếp. Thử lại nếu tháng sau đó cũng đã thu.
 */
async function suggestDate(studentId: string, enrollmentId: string, change: EnrollmentChange, impacts: MonthImpact[]) {
  let blockedMonths = impacts.filter(i => i.outcome === 'locked')
  for (let tries = 0; tries < 12 && blockedMonths.length; tries++) {
    const last = blockedMonths[blockedMonths.length - 1]
    const date = change.action === 'drop' ? lastDayOf(last.month, last.year) : firstDayAfter(last.month, last.year)
    const next: EnrollmentChange = change.action === 'drop' ? { ...change, dropDate: date } : { ...change, effectiveFrom: date }
    // Ngày gợi ý không hợp lệ (vd lớp đổi lịch, không còn thứ đã chọn) → không gợi ý.
    const result = await prepare(studentId, enrollmentId, next).then(p => evaluate(studentId, p), () => null)
    if (!result) return null
    if (!result.blocked) return date
    blockedMonths = result.impacts.filter(i => i.outcome === 'locked')
  }
  return null
}

async function applyChange(studentId: string, enrollmentId: string, change: EnrollmentChange) {
  const p = await prepare(studentId, enrollmentId, change)
  const { impacts, blocked } = await evaluate(studentId, p)
  if (blocked) fail(blocked, 409)
  await prisma.$transaction(tx => p.write(tx))

  let recalculatedRecords = 0, deletedRecords = 0
  for (const i of impacts) {
    if (!i.recordId) continue
    if (i.outcome === 'delete') {
      await prisma.tuitionRecord.delete({ where: { id: i.recordId } })
      deletedRecords++
    } else if (i.outcome === 'recalculate') {
      await calculateTuitionForStudent(studentId, p.enrollment.classId, i.month, i.year)
      recalculatedRecords++
    }
  }
  const updated = await prisma.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: enrollmentInclude })
  return { enrollment: enrollmentDoc(updated), recalculatedRecords, deletedRecords }
}

/**
 * Đổi lịch cố định trong tuần của học viên ở một lớp, áp dụng từ `effectiveFrom` trở đi.
 * Các tháng trước giữ nguyên. Tháng bị ảnh hưởng đã thu tiền/đã xuất hoá đơn → từ chối;
 * phiếu chưa thu của các tháng đó được tính lại theo lịch mới.
 */
export const setEnrollmentWeekdays = (studentId: string, enrollmentId: string, body: { days?: unknown; effectiveFrom?: unknown }) =>
  applyChange(studentId, enrollmentId, { action: 'weekdays', days: body.days, effectiveFrom: body.effectiveFrom })

/**
 * Cho học viên nghỉ lớp từ sau `dropDate` (buổi ngày nghỉ vẫn tính). Tháng đã thu/xuất hoá đơn mà bị bớt buổi → từ chối;
 * phiếu chưa thu được tính lại, phiếu không còn buổi nào thì xoá.
 */
export const dropEnrollment = (studentId: string, enrollmentId: string, body: { dropDate?: unknown }) =>
  applyChange(studentId, enrollmentId, { action: 'drop', dropDate: body.dropDate })
