import { db, C, toDocs } from '../lib/firebase'
import type { Schedule, Session, ClassEnrollment } from '../types/models'

const DAY_OF_WEEK_MAP: Record<string, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
  THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
}

const now = () => new Date().toISOString()

/**
 * Generate sessions từ 1 schedule cho khoảng [fromDate, toDate]
 * Bỏ qua ngày lễ, dùng skipDuplicates qua Firestore batch
 */
export async function generateSessionsFromSchedule(
  scheduleId: string,
  fromDate: Date,
  toDate: Date
): Promise<number> {
  const scheduleDoc = await db.collection(C.SCHEDULES).doc(scheduleId).get()
  if (!scheduleDoc.exists) throw new Error('Không tìm thấy lịch học')

  const schedule = { id: scheduleDoc.id, ...scheduleDoc.data() } as Schedule

  // Lấy thông tin class
  const classDoc = await db.collection(C.CLASSES).doc(schedule.classId).get()
  if (!classDoc.exists) throw new Error('Không tìm thấy lớp học')
  const cls = classDoc.data()!

  // Lấy ngày lễ trong khoảng
  const holidaysSnap = await db.collection(C.HOLIDAYS)
    .where('date', '>=', fromDate.toISOString().slice(0, 10))
    .where('date', '<=', toDate.toISOString().slice(0, 10))
    .get()
  const holidaySet = new Set(holidaysSnap.docs.map(d => d.data().date as string))

  const targetDow = DAY_OF_WEEK_MAP[schedule.dayOfWeek]
  const sessionDates: string[] = []

  const current = new Date(fromDate)
  while (current.getDay() !== targetDow) current.setDate(current.getDate() + 1)

  while (current <= toDate) {
    const dateStr = current.toISOString().slice(0, 10)
    if (!holidaySet.has(dateStr)) sessionDates.push(dateStr)
    current.setDate(current.getDate() + 7)
  }

  if (sessionDates.length === 0) return 0

  // Kiểm tra sessions đã tồn tại (tránh trùng)
  const existing = await db.collection(C.SESSIONS)
    .where('classId', '==', schedule.classId)
    .where('startTime', '==', schedule.startTime)
    .get()
  const existingDates = new Set(existing.docs.map(d => d.data().sessionDate as string))

  const toCreate = sessionDates.filter(d => !existingDates.has(d))
  if (toCreate.length === 0) return 0

  // Batch write (Firestore giới hạn 500 operations/batch)
  const BATCH_SIZE = 490
  let created = 0

  for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
    const batch = db.batch()
    const chunk = toCreate.slice(i, i + BATCH_SIZE)

    for (const dateStr of chunk) {
      const ref = db.collection(C.SESSIONS).doc()
      const sessionData: Record<string, unknown> = {
        classId: schedule.classId,
        className: cls.name as string,
        scheduleId: schedule.id,
        sessionDate: dateStr,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        status: 'SCHEDULED',
        createdAt: now(),
        updatedAt: now(),
      }
      if (cls.teacherId) { sessionData.teacherId = cls.teacherId; sessionData.teacherName = cls.teacherName ?? '' }
      batch.set(ref, sessionData)
    }

    await batch.commit()
    created += chunk.length
  }

  return created
}

/**
 * Generate sessions cho tất cả schedules của 1 lớp trong 1 tháng
 */
export async function generateSessionsForClassMonth(
  classId: string,
  year: number,
  month: number
): Promise<number> {
  const fromDate = new Date(year, month - 1, 1)
  const toDate = new Date(year, month, 0)

  const fromStr = fromDate.toISOString().slice(0, 10)
  const toStr = toDate.toISOString().slice(0, 10)

  const schedulesSnap = await db.collection(C.SCHEDULES)
    .where('classId', '==', classId)
    .get()

  const schedules = toDocs<Schedule>(schedulesSnap).filter(s =>
    s.effectiveFrom <= toStr && (!s.effectiveTo || s.effectiveTo >= fromStr)
  )

  let total = 0
  for (const s of schedules) {
    const start = s.effectiveFrom > fromStr ? new Date(s.effectiveFrom) : fromDate
    const end = s.effectiveTo && s.effectiveTo < toStr ? new Date(s.effectiveTo) : toDate
    total += await generateSessionsFromSchedule(s.id, start, end)
  }
  return total
}

/**
 * Khi session COMPLETED: khởi tạo StudentAttendance + TeacherAttendance mặc định PRESENT
 */
export async function initAttendanceForSession(sessionId: string): Promise<void> {
  const sessionDoc = await db.collection(C.SESSIONS).doc(sessionId).get()
  if (!sessionDoc.exists) throw new Error('Không tìm thấy buổi học')
  const session = { id: sessionDoc.id, ...sessionDoc.data() } as Session

  // Học viên active trong lớp
  const enrollSnap = await db.collection(C.ENROLLMENTS)
    .where('classId', '==', session.classId)
    .get()
  const enrollments = toDocs<ClassEnrollment>(enrollSnap).filter(e => e.status === 'ACTIVE')

  // Kiểm tra điểm danh đã có chưa
  const existingSnap = await db.collection(C.STUDENT_ATTENDANCES)
    .where('sessionId', '==', sessionId)
    .get()
  const existingStudentIds = new Set(existingSnap.docs.map(d => d.data().studentId as string))

  const batch = db.batch()

  for (const e of enrollments) {
    if (existingStudentIds.has(e.studentId)) continue
    existingStudentIds.add(e.studentId) // tránh duplicate khi enroll 2 lần
    const ref = db.collection(C.STUDENT_ATTENDANCES).doc()
    batch.set(ref, {
      sessionId, sessionDate: session.sessionDate,
      classId: session.classId, className: session.className,
      studentId: e.studentId, studentName: e.studentName,
      status: 'PRESENT', createdAt: now(), updatedAt: now(),
    })
  }

  // Teacher attendance (chỉ tạo nếu lớp có giáo viên)
  if (session.teacherId) {
    const existingTeacherSnap = await db.collection(C.TEACHER_ATTENDANCES)
      .where('sessionId', '==', sessionId)
      .where('teacherId', '==', session.teacherId)
      .limit(1).get()

    if (existingTeacherSnap.empty) {
      const ref = db.collection(C.TEACHER_ATTENDANCES).doc()
      batch.set(ref, {
        sessionId, sessionDate: session.sessionDate,
        classId: session.classId, className: session.className,
        teacherId: session.teacherId, teacherName: session.teacherName ?? '',
        status: 'PRESENT', createdAt: now(),
      })
    }
  }

  await batch.commit()
}
