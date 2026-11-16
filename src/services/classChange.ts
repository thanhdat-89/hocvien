import { createHash } from 'node:crypto'
import { prisma, newId, toDay } from '../lib/db'
import { classDoc, classInclude, scheduleDoc, scheduleInclude, sessionDoc, sessionInclude } from '../lib/docs'

type Day = 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY'
type Slot = { dayOfWeek: Day; startTime: string; endTime: string }
export type ClassChangeInput = {
  scope: 'schedule' | 'rate'
  tuitionRate?: number
  rateEffectiveMonth?: string
  effectiveDate?: string
  days?: Slot[]
  previewToken?: string
}

const weekdays: Day[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const isDate = (value: string) => datePattern.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const vietnamDate = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
const monthAfter = (date: string) => {
  const [year, month] = date.slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 7)
}
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }) }

/** A configured future rate never rewrites the price of an earlier billing month. */
export function classRateForMonth(cls: any, month: number, year: number): number {
  const period = `${year}-${String(month).padStart(2, '0')}`
  const history = Array.isArray(cls.tuitionRateHistory) ? cls.tuitionRateHistory : []
  const applicable = history.filter((item: any) => item.effectiveMonth <= period)
    .sort((a: any, b: any) => b.effectiveMonth.localeCompare(a.effectiveMonth))[0]
  return Number(applicable?.rate ?? cls.tuitionRate ?? 0)
}

/** The document ID remains the permanent class key; renaming writes only the display label. */
export async function renameClass(classId: string, value: unknown) {
  const name = String(value ?? '').trim()
  if (!name || name.length > 120) fail('Tên lớp phải có từ 1 đến 120 ký tự')
  const current = await prisma.class.findUnique({ where: { id: classId }, select: { name: true } })
  if (!current) fail('Không tìm thấy lớp học', 404)
  if (current!.name !== name) await prisma.class.update({ where: { id: classId }, data: { name } })
  return { id: classId, name }
}

const scheduleDates = (days: Slot[], fromDate: string, toDate: string, holidays: Set<string>) => {
  const result: { date: string; slot: Slot }[] = []
  for (const slot of days) {
    const day = new Date(`${fromDate}T00:00:00Z`)
    while (day.toISOString().slice(0, 10) <= toDate) {
      const date = day.toISOString().slice(0, 10)
      if (day.getUTCDay() === weekdays.indexOf(slot.dayOfWeek) && !holidays.has(date)) result.push({ date, slot })
      day.setUTCDate(day.getUTCDate() + 1)
    }
  }
  return result
}

export async function prepareClassChange(classId: string, input: ClassChangeInput) {
  if (input.scope !== 'schedule' && input.scope !== 'rate') fail('Loại thay đổi không hợp lệ')
  if ('name' in input || 'teacherId' in input) fail('Chỉ được sửa đúng phần thông tin đã chọn')
  if (input.scope === 'schedule' && ('tuitionRate' in input || 'rateEffectiveMonth' in input)) fail('Sửa lịch không thay đổi học phí')
  if (input.scope === 'rate' && ('days' in input || 'effectiveDate' in input)) fail('Sửa học phí không thay đổi lịch')
  if (input.scope === 'schedule' && !isDate(input.effectiveDate || '')) fail('Ngày áp dụng lịch không hợp lệ')
  if (input.scope === 'schedule' && (!Array.isArray(input.days) || input.days.length > 7)) fail('Lịch học không hợp lệ')
  const requestedDays = input.scope === 'schedule' ? input.days! : []
  const seen = new Set<string>()
  for (const slot of requestedDays) {
    if (!weekdays.includes(slot.dayOfWeek) || !isTime(slot.startTime)
      || !isTime(slot.endTime) || slot.startTime >= slot.endTime || seen.has(slot.dayOfWeek)) {
      fail('Ngày hoặc giờ học không hợp lệ')
    }
    seen.add(slot.dayOfWeek)
  }

  // Đọc dạng tài liệu (ngày là chuỗi) để giữ nguyên logic so sánh bên dưới; sắp theo id để fingerprint ổn định.
  const [classRow, schedules, sessions, records] = await Promise.all([
    prisma.class.findUnique({ where: { id: classId }, include: classInclude }),
    prisma.schedule.findMany({ where: { classId }, include: scheduleInclude, orderBy: { id: 'asc' } }).then(rows => rows.map(scheduleDoc)),
    prisma.session.findMany({ where: { classId }, include: sessionInclude, orderBy: { id: 'asc' } }).then(rows => rows.map(sessionDoc)),
    prisma.tuitionRecord.findMany({ where: { classId }, select: { id: true, status: true, billingYear: true, billingMonth: true }, orderBy: { id: 'asc' } }),
  ])
  if (!classRow) fail('Không tìm thấy lớp học', 404)
  const cls = classDoc(classRow!)
  if (cls.status !== 'ACTIVE') fail('Chỉ có thể sửa lớp đang hoạt động', 409)
  const effectiveDate = input.scope === 'schedule' ? input.effectiveDate! : vietnamDate()
  const currentSchedules = schedules.filter(s => {
    const today = vietnamDate()
    return s.effectiveFrom <= today && (!s.effectiveTo || s.effectiveTo >= today)
  })
  const oldSchedules = schedules.filter(s => s.effectiveFrom <= effectiveDate && (!s.effectiveTo || s.effectiveTo >= effectiveDate))
  const oldDays = currentSchedules.map(s => `${s.dayOfWeek}:${s.startTime}-${s.endTime}`).sort()
  const newDays = requestedDays.map(slot => `${slot.dayOfWeek}:${slot.startTime}-${slot.endTime}`).sort()
  const scheduleChanged = input.scope === 'schedule' && JSON.stringify(oldDays) !== JSON.stringify(newDays)
  if (scheduleChanged && requestedDays.length === 0) fail('Lớp đang hoạt động cần ít nhất một ngày học; hãy kết thúc lớp nếu ngừng dạy', 409)
  const rate = input.scope === 'rate' ? Number(input.tuitionRate) : Number(cls.tuitionRate ?? 0)
  if (!Number.isFinite(rate) || rate < 0) fail('Đơn giá học phí không hợp lệ')
  const rateChanged = input.scope === 'rate' && rate !== Number(cls.tuitionRate ?? 0)
  const nextMonth = monthAfter(vietnamDate())
  const rateEffectiveMonth = input.rateEffectiveMonth || nextMonth
  if (rateChanged && (!monthPattern.test(rateEffectiveMonth) || rateEffectiveMonth < nextMonth)) {
    fail(`Đơn giá mới chỉ được áp dụng từ tháng ${nextMonth} trở đi`)
  }
  if (scheduleChanged && effectiveDate <= vietnamDate()) fail('Lịch mới phải áp dụng từ ngày mai trở đi')

  const existingHistory: { effectiveMonth: string; rate: number }[] = Array.isArray(cls.tuitionRateHistory) ? cls.tuitionRateHistory : []
  if (rateChanged && existingHistory.some(item => item.effectiveMonth >= rateEffectiveMonth)) {
    fail('Đã có thay đổi đơn giá ở tháng này hoặc tháng sau; vui lòng đối chiếu trước', 409)
  }
  const protectedRecords = records.filter(record => {
    const period = `${record.billingYear}-${String(record.billingMonth).padStart(2, '0')}`
    return (scheduleChanged && period >= effectiveDate.slice(0, 7)) || (rateChanged && period >= rateEffectiveMonth)
  })
  if (protectedRecords.length) fail(`Đã có ${protectedRecords.length} phiếu học phí ở kỳ bị ảnh hưởng. Không thể tự sửa lịch hoặc đơn giá; cần đối chiếu phiếu trước.`, 409)

  const oldScheduleIds = new Set(oldSchedules.map(s => s.id))
  const toRemove = scheduleChanged ? sessions.filter(s =>
    oldScheduleIds.has(s.scheduleId) && s.status === 'SCHEDULED' && s.sessionDate >= effectiveDate
  ) : []
  const existingDates = toRemove.map(s => s.sessionDate as string).sort()
  const lastExisting = existingDates[existingDates.length - 1]
  const [year, month] = effectiveDate.slice(0, 7).split('-').map(Number)
  const horizon = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)
  const plannedEnd = lastExisting && lastExisting > horizon ? lastExisting : horizon
  const toDate = cls.endDate && cls.endDate < plannedEnd ? cls.endDate : plannedEnd
  if (scheduleChanged && toDate < effectiveDate) fail('Lớp kết thúc trước ngày áp dụng lịch mới', 409)
  if (scheduleChanged && toDate > new Date(Date.parse(`${effectiveDate}T00:00:00Z`) + 184 * 86400000).toISOString().slice(0, 10)) {
    fail('Lịch đã được tạo quá 6 tháng tới; cần xử lý riêng trước khi đổi', 409)
  }

  const holidays = new Set<string>()
  if (scheduleChanged) {
    for (const h of await prisma.holiday.findMany({ where: { branches: { some: { branchId: cls.branchId } } } })) {
      if (h.dates.length) h.dates.forEach(date => holidays.add(date.toISOString().slice(0, 10)))
      else for (let date = new Date(h.startDate); date <= h.endDate; date.setUTCDate(date.getUTCDate() + 1)) holidays.add(date.toISOString().slice(0, 10))
    }
  }
  const removedIds = new Set(toRemove.map(s => s.id))
  const remaining = new Set(sessions.filter(s => !removedIds.has(s.id))
    .map(s => `${s.sessionDate}:${s.startTime}`))
  const toCreate = scheduleChanged ? scheduleDates(requestedDays, effectiveDate, toDate, holidays)
    .filter(item => !remaining.has(`${item.date}:${item.slot.startTime}`)) : []
  if (scheduleChanged && toCreate.length === 0) {
    fail('Lịch mới không tạo được buổi học thay thế; giữ nguyên lịch cũ', 409)
  }

  const fingerprint = createHash('sha256').update(JSON.stringify({
    classUpdatedAt: cls.updatedAt, schedules: schedules.map(s => [s.id, s.effectiveFrom, s.effectiveTo]),
    sessions: sessions.map(s => [s.id, s.status, s.sessionDate]),
    records: records.map(r => [r.id, r.status]),
    input: { ...input, previewToken: undefined },
  })).digest('hex')
  return { classId, cls, oldSchedules, toRemove, toCreate, scheduleChanged, rateChanged, requestedDays,
    rate, rateEffectiveMonth, token: fingerprint,
    summary: { scheduleChanged, rateChanged, removeSessions: toRemove.length, createSessions: toCreate.length,
      protectedSessions: sessions.filter(s => s.status === 'COMPLETED').length,
      effectiveDate, rateEffectiveMonth } }
}

export async function applyClassChange(classId: string, input: ClassChangeInput) {
  const plan = await prepareClassChange(classId, input)
  if (!input.previewToken || input.previewToken !== plan.token) fail('Dữ liệu lớp đã thay đổi; vui lòng xem lại tác động trước khi lưu', 409)
  const writes = 1 + (plan.scheduleChanged ? plan.oldSchedules.length + plan.toRemove.length + plan.requestedDays.length + plan.toCreate.length : 0)
  if (writes > 450) fail('Số buổi cần đổi quá lớn; vui lòng liên hệ quản trị để xử lý riêng', 409)
  const newScheduleIds = plan.requestedDays.map(() => newId())
  const scheduleIdByDay = new Map(plan.requestedDays.map((day, index) => [day.dayOfWeek, newScheduleIds[index]]))
  await prisma.$transaction(async tx => {
    // Khoá dòng lớp: hai lần lưu đồng thời không thể cùng vượt qua kiểm tra updatedAt.
    const [fresh] = await tx.$queryRaw<{ updatedAt: Date }[]>`SELECT "updatedAt" FROM classes WHERE id = ${classId} FOR UPDATE`
    if (fresh?.updatedAt.toISOString() !== plan.cls.updatedAt) fail('Lớp vừa được thay đổi; vui lòng tải lại', 409)
    await tx.class.update({
      where: { id: classId },
      data: { updatedAt: new Date(), ...(plan.rateChanged ? { tuitionRate: plan.rate } : {}) },
    })
    if (plan.rateChanged) {
      // Lần đổi giá đầu tiên ghi thêm mốc 2000-01 = giá cũ, như tuitionRateHistory trên Firestore.
      const history = Array.isArray(plan.cls.tuitionRateHistory) ? [] : [
        { classId, effectiveMonth: '2000-01', rate: Number(plan.cls.tuitionRate ?? 0) },
      ]
      await tx.classTuitionRate.createMany({ data: [...history, { classId, effectiveMonth: plan.rateEffectiveMonth, rate: plan.rate }] })
    }
    if (plan.scheduleChanged) {
      await tx.schedule.updateMany({ where: { id: { in: plan.oldSchedules.map(s => s.id) } }, data: { effectiveTo: toDay(dayBefore(input.effectiveDate!)) } })
      await tx.session.deleteMany({ where: { id: { in: plan.toRemove.map(s => s.id) } } })
      await tx.schedule.createMany({
        data: plan.requestedDays.map((day, i) => ({ id: newScheduleIds[i], classId, ...day, effectiveFrom: toDay(input.effectiveDate)! })),
      })
      await tx.session.createMany({
        data: plan.toCreate.map(item => ({
          id: newId(), classId, scheduleId: scheduleIdByDay.get(item.slot.dayOfWeek)!,
          sessionDate: toDay(item.date)!, startTime: item.slot.startTime, endTime: item.slot.endTime,
          teacherId: plan.cls.teacherId || null, status: 'SCHEDULED' as const,
        })),
      })
    }
  })
  return plan.summary
}
