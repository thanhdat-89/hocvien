import { createHash } from 'node:crypto'
import { db, C } from '../lib/firebase'

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
  const ref = db.collection(C.CLASSES).doc(classId)
  const current = await ref.get()
  if (!current.exists) fail('Không tìm thấy lớp học', 404)
  if (current.data()?.name !== name) await ref.update({ name })
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

  const classRef = db.collection(C.CLASSES).doc(classId)
  const [classDoc, schedulesSnap, sessionsSnap, recordsSnap] = await Promise.all([
    classRef.get(),
    db.collection(C.SCHEDULES).where('classId', '==', classId).get(),
    db.collection(C.SESSIONS).where('classId', '==', classId).get(),
    db.collection(C.TUITION_RECORDS).where('classId', '==', classId).get(),
  ])
  if (!classDoc.exists) fail('Không tìm thấy lớp học', 404)
  const cls = classDoc.data()!
  if (cls.status !== 'ACTIVE') fail('Chỉ có thể sửa lớp đang hoạt động', 409)
  const effectiveDate = input.scope === 'schedule' ? input.effectiveDate! : vietnamDate()
  const currentSchedules = schedulesSnap.docs.filter(doc => {
    const s = doc.data()
    const today = vietnamDate()
    return s.effectiveFrom <= today && (!s.effectiveTo || s.effectiveTo >= today)
  })
  const oldSchedules = schedulesSnap.docs.filter(doc => {
    const s = doc.data()
    return s.effectiveFrom <= effectiveDate && (!s.effectiveTo || s.effectiveTo >= effectiveDate)
  })
  const oldDays = currentSchedules.map(doc => {
    const s = doc.data()
    return `${s.dayOfWeek}:${s.startTime}-${s.endTime}`
  }).sort()
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
  const protectedRecords = recordsSnap.docs.filter(doc => {
    const record = doc.data()
    const period = `${record.billingYear}-${String(record.billingMonth).padStart(2, '0')}`
    return (scheduleChanged && period >= effectiveDate.slice(0, 7)) || (rateChanged && period >= rateEffectiveMonth)
  })
  if (protectedRecords.length) fail(`Đã có ${protectedRecords.length} phiếu học phí ở kỳ bị ảnh hưởng. Không thể tự sửa lịch hoặc đơn giá; cần đối chiếu phiếu trước.`, 409)

  const oldScheduleIds = new Set(oldSchedules.map(doc => doc.id))
  const toRemove = scheduleChanged ? sessionsSnap.docs.filter(doc => {
    const s = doc.data()
    return oldScheduleIds.has(s.scheduleId) && s.status === 'SCHEDULED' && s.sessionDate >= effectiveDate
  }) : []
  const existingDates = toRemove.map(doc => doc.data().sessionDate as string).sort()
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
    const holidaySnap = await db.collection(C.HOLIDAYS).get()
    for (const doc of holidaySnap.docs) {
      const h = doc.data()
      if (Array.isArray(h.dates)) h.dates.forEach((date: string) => holidays.add(date))
      else if (h.startDate && h.endDate) {
        for (let date = h.startDate; date <= h.endDate; date = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) holidays.add(date)
      } else if (h.date) holidays.add(h.date)
    }
  }
  const removedIds = new Set(toRemove.map(doc => doc.id))
  const remaining = new Set(sessionsSnap.docs.filter(doc => !removedIds.has(doc.id))
    .map(doc => `${doc.data().sessionDate}:${doc.data().startTime}`))
  const toCreate = scheduleChanged ? scheduleDates(requestedDays, effectiveDate, toDate, holidays)
    .filter(item => !remaining.has(`${item.date}:${item.slot.startTime}`)) : []
  if (scheduleChanged && toCreate.length === 0) {
    fail('Lịch mới không tạo được buổi học thay thế; giữ nguyên lịch cũ', 409)
  }

  const fingerprint = createHash('sha256').update(JSON.stringify({
    classUpdatedAt: cls.updatedAt, schedules: schedulesSnap.docs.map(doc => [doc.id, doc.data().effectiveFrom, doc.data().effectiveTo]),
    sessions: sessionsSnap.docs.map(doc => [doc.id, doc.data().status, doc.data().sessionDate]),
    records: recordsSnap.docs.map(doc => [doc.id, doc.data().status]),
    input: { ...input, previewToken: undefined },
  })).digest('hex')
  return { classRef, cls, oldSchedules, toRemove, toCreate, scheduleChanged, rateChanged, requestedDays,
    rate, rateEffectiveMonth, token: fingerprint,
    summary: { scheduleChanged, rateChanged, removeSessions: toRemove.length, createSessions: toCreate.length,
      protectedSessions: sessionsSnap.docs.filter(doc => doc.data().status === 'COMPLETED').length,
      effectiveDate, rateEffectiveMonth } }
}

export async function applyClassChange(classId: string, input: ClassChangeInput) {
  const plan = await prepareClassChange(classId, input)
  if (!input.previewToken || input.previewToken !== plan.token) fail('Dữ liệu lớp đã thay đổi; vui lòng xem lại tác động trước khi lưu', 409)
  const writes = 1 + (plan.scheduleChanged ? plan.oldSchedules.length + plan.toRemove.length + plan.requestedDays.length + plan.toCreate.length : 0)
  if (writes > 450) fail('Số buổi cần đổi quá lớn; vui lòng liên hệ quản trị để xử lý riêng', 409)
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { updatedAt: now }
  if (plan.rateChanged) {
    const history = Array.isArray(plan.cls.tuitionRateHistory) ? plan.cls.tuitionRateHistory : [
      { effectiveMonth: '2000-01', rate: Number(plan.cls.tuitionRate ?? 0) },
    ]
    updates.tuitionRate = plan.rate
    updates.tuitionRateHistory = [...history, { effectiveMonth: plan.rateEffectiveMonth, rate: plan.rate }]
    updates.tuitionRateEffectiveMonth = plan.rateEffectiveMonth
  }
  const newScheduleRefs = plan.requestedDays.map(() => db.collection(C.SCHEDULES).doc())
  const scheduleRefByDay = new Map(plan.requestedDays.map((day, index) => [day.dayOfWeek, newScheduleRefs[index]]))
  await db.runTransaction(async transaction => {
    const fresh = await transaction.get(plan.classRef)
    if (fresh.data()?.updatedAt !== plan.cls.updatedAt) fail('Lớp vừa được thay đổi; vui lòng tải lại', 409)
    transaction.update(plan.classRef, updates)
    if (plan.scheduleChanged) {
      for (const old of plan.oldSchedules) transaction.update(old.ref, { effectiveTo: dayBefore(input.effectiveDate!) })
      for (const old of plan.toRemove) transaction.delete(old.ref)
      for (let i = 0; i < plan.requestedDays.length; i++) {
        const day = plan.requestedDays[i]
        transaction.set(newScheduleRefs[i], { classId, className: plan.cls.name, ...day,
          effectiveFrom: input.effectiveDate, createdAt: now })
      }
      for (const item of plan.toCreate) {
        const ref = db.collection(C.SESSIONS).doc()
        transaction.set(ref, { classId, className: plan.cls.name, scheduleId: scheduleRefByDay.get(item.slot.dayOfWeek)!.id,
          sessionDate: item.date, startTime: item.slot.startTime, endTime: item.slot.endTime,
          teacherId: plan.cls.teacherId || null, teacherName: plan.cls.teacherName || null,
          status: 'SCHEDULED', createdAt: now, updatedAt: now })
      }
    }
  })
  return plan.summary
}
