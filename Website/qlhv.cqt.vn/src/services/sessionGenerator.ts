import { prisma, newId, toDay } from '../lib/db'

const DAY_OF_WEEK_MAP: Record<string, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
  THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Tập ngày nghỉ lễ "YYYY-MM-DD" của một cơ sở (theo danh sách `dates`, hoặc khoảng startDate–endDate). */
async function holidayDates(branchId: string): Promise<Set<string>> {
  const set = new Set<string>()
  for (const h of await prisma.holiday.findMany({ where: { branches: { some: { branchId } } } })) {
    if (h.dates.length) { h.dates.forEach(d => set.add(ymd(d))); continue }
    for (const cur = new Date(h.startDate); cur <= h.endDate; cur.setUTCDate(cur.getUTCDate() + 1)) set.add(ymd(cur))
  }
  return set
}

/**
 * Generate sessions từ 1 schedule cho khoảng [fromDate, toDate]
 * Bỏ qua ngày lễ; buổi đã có (cùng lớp, ngày, giờ bắt đầu) được unique index bỏ qua.
 */
export async function generateSessionsFromSchedule(
  scheduleId: string,
  fromDate: Date,
  toDate: Date
): Promise<number> {
  const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId }, include: { class: true } })
  if (!schedule) throw new Error('Không tìm thấy lịch học')

  const holidaySet = await holidayDates(schedule.class.branchId)
  const targetDow = DAY_OF_WEEK_MAP[schedule.dayOfWeek]
  const sessionDates: string[] = []

  const current = new Date(fromDate)
  while (current.getUTCDay() !== targetDow) current.setUTCDate(current.getUTCDate() + 1)

  while (current <= toDate) {
    const dateStr = ymd(current)
    if (!holidaySet.has(dateStr)) sessionDates.push(dateStr)
    current.setUTCDate(current.getUTCDate() + 7)
  }

  if (sessionDates.length === 0) return 0

  const { count } = await prisma.session.createMany({
    data: sessionDates.map(dateStr => ({
      id: newId(),
      classId: schedule.classId,
      teacherId: schedule.class.teacherId,
      scheduleId: schedule.id,
      sessionDate: toDay(dateStr)!,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      status: 'SCHEDULED' as const,
    })),
    skipDuplicates: true,
  })
  return count
}

/**
 * Generate sessions cho tất cả schedules của 1 lớp trong 1 tháng
 */
export async function generateSessionsForClassMonth(
  classId: string,
  year: number,
  month: number
): Promise<number> {
  const fromDate = new Date(Date.UTC(year, month - 1, 1))
  const toDate = new Date(Date.UTC(year, month, 0))

  const schedules = await prisma.schedule.findMany({
    where: {
      classId,
      effectiveFrom: { lte: toDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: fromDate } }],
    },
  })

  let total = 0
  for (const s of schedules) {
    const start = s.effectiveFrom > fromDate ? s.effectiveFrom : fromDate
    const end = s.effectiveTo && s.effectiveTo < toDate ? s.effectiveTo : toDate
    total += await generateSessionsFromSchedule(s.id, start, end)
  }
  return total
}
