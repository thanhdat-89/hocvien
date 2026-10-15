import { db, C, toDocs } from '../lib/firebase'
import { getTuitionScheduleSummary } from './tuitionScheduleSummary'

/** Read-only checks for missing or misplaced class sessions and already-issued fee differences. */
export async function auditClassTuition(month: number, year: number) {
  const period = `${year}-${String(month).padStart(2, '0')}`
  const from = `${period}-01`
  const to = `${period}-${new Date(year, month, 0).getDate()}`
  const [classes, enrollments, schedules, sessions, rows] = await Promise.all([
    db.collection(C.CLASSES).where('status', '==', 'ACTIVE').get(),
    db.collection(C.ENROLLMENTS).where('status', '==', 'ACTIVE').get(),
    db.collection(C.SCHEDULES).get(),
    db.collection(C.SESSIONS).where('sessionDate', '>=', from).where('sessionDate', '<=', to).get(),
    getTuitionScheduleSummary(month, year),
  ])
  const classDocs = toDocs<any>(classes)
  const enrollmentDocs = toDocs<any>(enrollments)
  const scheduleDocs = toDocs<any>(schedules)
  const sessionDocs = toDocs<any>(sessions)
  const bySchedule = new Map(scheduleDocs.map(schedule => [schedule.id, schedule]))
  const anomalies: { type: string; classId: string; studentId?: string; count?: number; calculatedAmount?: number; recordedAmount?: number }[] = []
  for (const cls of classDocs) {
    if (cls.startDate && cls.startDate > to) continue
    const students = enrollmentDocs.filter(e => e.classId === cls.id && (!e.enrollmentDate || e.enrollmentDate <= to))
    if (!students.length) continue
    const hasSchedule = scheduleDocs.some(s => s.classId === cls.id && s.effectiveFrom <= to && (!s.effectiveTo || s.effectiveTo >= from))
    const classSessions = sessionDocs.filter(s => s.classId === cls.id && s.status !== 'CANCELLED')
    if (hasSchedule && classSessions.length === 0) anomalies.push({ type: 'MISSING_MONTH_SESSIONS', classId: cls.id, count: students.length })
    const misplaced = classSessions.filter(session => {
      const schedule = bySchedule.get(session.scheduleId)
      if (!schedule) return false
      const weekday = new Date(`${session.sessionDate}T00:00:00Z`).getUTCDay()
      const expected = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].indexOf(schedule.dayOfWeek)
      return expected !== weekday
    })
    if (misplaced.length) anomalies.push({ type: 'WRONG_WEEKDAY', classId: cls.id, count: misplaced.length })
  }
  for (const row of rows) {
    if (row.classId === 'private' || !row.tuitionRecord) continue
    if (Number(row.tuitionRecord.finalAmount) !== Number(row.finalAmount)) {
      anomalies.push({ type: 'TUITION_RECORD_DIFFERS', classId: row.classId, studentId: row.studentId,
        calculatedAmount: Number(row.finalAmount), recordedAmount: Number(row.tuitionRecord.finalAmount) })
    }
  }
  return { period, checkedClasses: classDocs.length, checkedRows: rows.length, anomalies }
}
