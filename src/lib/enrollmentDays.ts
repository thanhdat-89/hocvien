// Lịch cố định trong tuần của học viên trong một lớp.
// Ví dụ lớp học T3 + T7 nhưng em chỉ học T3: ghi danh có kế hoạch { effectiveFrom, days: ['TUESDAY'] }.
// Học phí, lịch học cá nhân, cổng phụ huynh đều đếm buổi qua `enrollmentCoversSession` để cùng một quy tắc.

export const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const
export type Weekday = typeof WEEKDAYS[number]

/** Nhãn ngắn kiểu Việt Nam, theo thứ tự hiển thị T2 → CN. */
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MONDAY: 'T2', TUESDAY: 'T3', WEDNESDAY: 'T4', THURSDAY: 'T5', FRIDAY: 'T6', SATURDAY: 'T7', SUNDAY: 'CN',
}

export interface WeekdayPlan { effectiveFrom: string; days: string[] }

interface EnrollmentLike {
  enrollmentDate?: string | null
  dropDate?: string | null
  status?: string
  weekdayPlans?: WeekdayPlan[] | null
}

export const isWeekday = (value: unknown): value is Weekday => typeof value === 'string' && (WEEKDAYS as readonly string[]).includes(value)

/** Thứ của ngày "YYYY-MM-DD" (không phụ thuộc múi giờ máy chủ). */
export const weekdayOf = (date: string): Weekday => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]

/** Các thứ học viên học vào ngày `date`; null = học mọi buổi của lớp. */
export function weekdaysOn(enrollment: EnrollmentLike, date: string): string[] | null {
  let current: WeekdayPlan | undefined
  for (const plan of enrollment.weekdayPlans ?? []) {
    if (plan.effectiveFrom <= date && (!current || plan.effectiveFrom > current.effectiveFrom)) current = plan
  }
  return current && current.days.length ? current.days : null
}

/** Học viên có học buổi của lớp vào ngày này theo lịch cố định không (chưa xét ngày ghi danh/nghỉ). */
export function attendsOn(enrollment: EnrollmentLike, sessionDate: string): boolean {
  const days = weekdaysOn(enrollment, sessionDate)
  return !days || days.includes(weekdayOf(sessionDate))
}

/** Buổi học ngày `sessionDate` có thuộc ghi danh này không: trong khoảng ghi danh và đúng lịch cố định trong tuần. */
export function enrollmentCoversSession(enrollment: EnrollmentLike, sessionDate: string): boolean {
  if (enrollment.enrollmentDate && sessionDate < enrollment.enrollmentDate) return false
  if (enrollment.status === 'DROPPED' && enrollment.dropDate && sessionDate > enrollment.dropDate) return false
  return attendsOn(enrollment, sessionDate)
}
