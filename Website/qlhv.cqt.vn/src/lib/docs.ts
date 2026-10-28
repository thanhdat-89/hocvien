import type { Prisma } from '@prisma/client'
import { api, fromClassId } from './db'

// ─── Đọc PostgreSQL ra đúng hình dạng tài liệu Firestore cũ ──────────────
// Logic nghiệp vụ (tính học phí, đối soát, đổi lịch) và frontend vẫn nhận các trường denormalized
// (className, studentName, teacherName...), classId "private" cho học riêng, ngày dạng chuỗi.
// Mỗi model có một `include` và một hàm chuyển; route chỉ cần `findMany({ include }).then(rows => rows.map(fn))`.

const name = { select: { name: true } } as const
const fullName = { select: { fullName: true } } as const

// ─── Lớp ─────────────────────────────────────────────────────

export const classInclude = {
  subject: name,
  teacher: fullName,
  rateHistory: { orderBy: { effectiveMonth: 'asc' } },
} satisfies Prisma.ClassInclude

export function classDoc({ subject, teacher, rateHistory, ...c }: Prisma.ClassGetPayload<{ include: typeof classInclude }>) {
  const history = rateHistory.map(r => ({ effectiveMonth: r.effectiveMonth, rate: r.rate }))
  return api({
    ...c,
    subjectName: subject?.name,
    teacherName: teacher?.fullName,
    // Không có lịch sử → để trống như Firestore; classRateForMonth sẽ dùng tuitionRate.
    tuitionRateHistory: history.length ? history : undefined,
    tuitionRateEffectiveMonth: history[history.length - 1]?.effectiveMonth,
  })
}

// ─── Ghi danh, lịch, buổi học ────────────────────────────────

export const enrollmentInclude = { class: name, student: fullName } satisfies Prisma.ClassEnrollmentInclude

export function enrollmentDoc({ class: cls, student, ...e }: Prisma.ClassEnrollmentGetPayload<{ include: typeof enrollmentInclude }>) {
  return api({ ...e, className: cls.name, studentName: student.fullName })
}

export const scheduleInclude = { class: name } satisfies Prisma.ScheduleInclude

export function scheduleDoc({ class: cls, ...s }: Prisma.ScheduleGetPayload<{ include: typeof scheduleInclude }>) {
  return api({ ...s, className: cls.name })
}

export const sessionInclude = { class: name, teacher: fullName } satisfies Prisma.SessionInclude

export function sessionDoc({ class: cls, teacher, ...s }: Prisma.SessionGetPayload<{ include: typeof sessionInclude }>) {
  return api({ ...s, className: cls.name, teacherName: teacher?.fullName ?? null })
}

export const privateSessionInclude = { student: fullName } satisfies Prisma.PrivateSessionInclude

export function privateSessionDoc({ student, ...p }: Prisma.PrivateSessionGetPayload<{ include: typeof privateSessionInclude }>) {
  return api({ ...p, studentName: student.fullName })
}

export const studentAttendanceInclude = {
  session: { select: { sessionDate: true } }, class: name, student: fullName,
} satisfies Prisma.StudentAttendanceInclude

export function studentAttendanceDoc({ session, class: cls, student, ...a }: Prisma.StudentAttendanceGetPayload<{ include: typeof studentAttendanceInclude }>) {
  return api({ ...a, sessionDate: session.sessionDate, className: cls.name, studentName: student.fullName })
}

// ─── Khuyến mãi, học phí, thanh toán ─────────────────────────

const PRIVATE_NAME = 'Học riêng'
// Phiếu học phí và khuyến mãi giữ tên lớp lúc lập (ảnh chụp chứng từ); các màn hình vận hành dùng tên hiện tại.

export const studentPromotionInclude = { student: fullName, class: name } satisfies Prisma.StudentPromotionInclude

export function studentPromotionDoc({ student, class: cls, ...p }: Prisma.StudentPromotionGetPayload<{ include: typeof studentPromotionInclude }>) {
  return api({ ...p, classId: fromClassId(p.classId), studentName: student.fullName, className: p.className ?? cls?.name ?? PRIVATE_NAME })
}

export const tuitionRecordInclude = { student: fullName, class: name } satisfies Prisma.TuitionRecordInclude

export function tuitionRecordDoc({ student, class: cls, ...r }: Prisma.TuitionRecordGetPayload<{ include: typeof tuitionRecordInclude }>) {
  return api({ ...r, classId: fromClassId(r.classId), studentName: student.fullName, className: r.className ?? cls?.name ?? PRIVATE_NAME })
}

export const paymentInclude = {
  student: fullName, tuitionRecord: { select: { classId: true } },
} satisfies Prisma.PaymentInclude

export function paymentDoc({ student, tuitionRecord, ...p }: Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>) {
  return api({ ...p, studentName: student.fullName, classId: fromClassId(tuitionRecord.classId) })
}

// ─── Điểm tháng ──────────────────────────────────────────────

export const monthlyScoreInclude = { student: fullName } satisfies Prisma.MonthlyScoreInclude

export function monthlyScoreDoc({ student, ...row }: Prisma.MonthlyScoreGetPayload<{ include: typeof monthlyScoreInclude }>) {
  return api({ ...row, classId: fromClassId(row.classId), studentName: student.fullName })
}
