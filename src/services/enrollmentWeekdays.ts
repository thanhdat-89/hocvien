import { prisma, newId, toDay, type Tx } from '../lib/db'
import { enrollmentDoc, enrollmentInclude, scheduleDoc, scheduleInclude } from '../lib/docs'
import { isWeekday, WEEKDAY_LABELS, WEEKDAYS, type Weekday } from '../lib/enrollmentDays'
import { calculateTuitionForStudent } from './tuitionCalculator'

const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }) }
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const label = (days: string[]) => days.map(d => WEEKDAY_LABELS[d as Weekday] ?? d).join(', ')

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

/**
 * Đổi lịch cố định trong tuần của học viên ở một lớp, áp dụng từ `effectiveFrom` trở đi.
 * Các tháng trước giữ nguyên. Tháng bị ảnh hưởng đã thu tiền/đã xuất hoá đơn → từ chối;
 * phiếu chưa thu của các tháng đó được tính lại theo lịch mới.
 */
export async function setEnrollmentWeekdays(studentId: string, enrollmentId: string, body: { days?: unknown; effectiveFrom?: unknown }) {
  const enrollment = await prisma.classEnrollment.findFirst({ where: { id: enrollmentId, studentId }, include: enrollmentInclude })
  if (!enrollment) return fail('Không tìm thấy ghi danh', 404)
  const doc = enrollmentDoc(enrollment)
  if (doc.status !== 'ACTIVE') fail('Chỉ đổi lịch được cho lớp đang học', 409)
  if (body.effectiveFrom != null && !isDate(body.effectiveFrom)) fail('Ngày áp dụng không hợp lệ')
  const requested = (body.effectiveFrom as string | undefined) || doc.enrollmentDate
  // Áp dụng trước ngày ghi danh cũng như áp dụng từ ngày ghi danh.
  const effectiveFrom: string = requested < doc.enrollmentDate ? doc.enrollmentDate : requested
  const days = await normalizeDays(doc.classId, effectiveFrom, body.days)

  const fromMonth = effectiveFrom.slice(0, 7)
  const records = (await prisma.tuitionRecord.findMany({
    where: { studentId, classId: doc.classId },
    select: { id: true, billingMonth: true, billingYear: true, status: true, paidAmount: true },
  })).filter(r => `${r.billingYear}-${String(r.billingMonth).padStart(2, '0')}` >= fromMonth)
  const invoiced = records.length ? await prisma.misaInvoice.findMany({
    where: { OR: [{ id: { in: records.map(r => r.id) } }, { recordIds: { hasSome: records.map(r => r.id) } }] },
    select: { id: true, recordIds: true },
  }) : []
  const invoicedIds = new Set(invoiced.flatMap(i => [i.id, ...i.recordIds]))
  const locked = records.filter(r => r.status === 'PAID' || r.status === 'PARTIAL' || r.paidAmount > 0 || invoicedIds.has(r.id))
  if (locked.length) {
    const months = [...new Set(locked.map(r => `T${r.billingMonth}/${r.billingYear}`))].join(', ')
    fail(`Học phí ${months} của lớp này đã thu hoặc đã xuất hoá đơn. Hãy chọn ngày áp dụng sau các tháng đó.`, 409)
  }

  await prisma.$transaction(async tx => {
    // Lịch mới thay mọi kế hoạch từ ngày áp dụng trở đi.
    await tx.enrollmentWeekdayPlan.deleteMany({
      where: { enrollmentId, OR: [{ effectiveFrom: { gte: toDay(effectiveFrom)! } }, { effectiveFrom: { lt: toDay(doc.enrollmentDate)! } }] },
    })
    const earlier = await tx.enrollmentWeekdayPlan.count({ where: { enrollmentId } })
    // Học đủ và không có lịch riêng trước đó → không cần dòng nào (mặc định là học đủ).
    if (days.length || earlier) {
      await tx.enrollmentWeekdayPlan.create({ data: { id: newId(), enrollmentId, effectiveFrom: toDay(effectiveFrom)!, days } })
    }
  })

  for (const r of records) await calculateTuitionForStudent(studentId, doc.classId, r.billingMonth, r.billingYear)

  const updated = await prisma.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: enrollmentInclude })
  return { enrollment: enrollmentDoc(updated), recalculatedRecords: records.length }
}
