import { prisma, newId } from '../lib/db'
import { classDoc, classInclude } from '../lib/docs'
import { createError } from '../middleware/errorHandler'
import { classRateForMonth } from './classChange'
import { recountClassActiveStudents } from '../lib/classSync'

// ─── Chuyển năm học ───────────────────────────────────────────
// Mỗi lớp đang hoạt động của năm nguồn (trong phạm vi cơ sở của request):
//   promote = lớp mới ở năm đích, giữ giáo viên, lịch, học phí và chuyển học viên đang học sang;
//   empty   = lớp mới cùng cấu hình, chưa có học viên;   skip = không mở lại.
// Mọi lớp xử lý đều kết thúc ngày trước khi năm đích bắt đầu: lịch dừng ở mốc, buổi chưa học sau mốc bị xoá. Lớp vẫn
// Đang hoạt động tới mốc (cron còn sinh buổi tới ngày cuối), chỉ chuyển Đã kết thúc ngay nếu mốc đã qua. Học viên đang học tăng khối;
// học viên lớp 12 được chọn chuyển sang Đã tốt nghiệp. Ghi trong một transaction.

export type RolloverAction = 'promote' | 'empty' | 'skip'
export interface RolloverClassInput { classId: string; action: RolloverAction; name?: string; gradeLevel?: number | null }
export interface RolloverInput { targetYearId: string; classes: RolloverClassInput[]; bumpGrades?: boolean; graduateIds?: string[] }

const DAY = 86400000
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Khối của lớp: gradeLevel, nếu trống thì số sau "Toán" / "Lớp" trong tên (như frontend lib/classGrade) */
export function gradeOf(cls: { gradeLevel: number | null; name: string }) {
  if (cls.gradeLevel && cls.gradeLevel >= 1 && cls.gradeLevel <= 12) return cls.gradeLevel
  const match = cls.name.match(/(?:^|\s)(?:toán|lớp)\s*(\d{1,2})(?!\d)/i)
  const grade = match ? Number(match[1]) : NaN
  return grade >= 1 && grade <= 12 ? grade : null
}

/** "Toán 8A" (khối 8) → "Toán 9A"; không thấy số khối trong tên thì giữ nguyên */
export function nextClassName(name: string, grade: number | null) {
  if (!grade || grade >= 12) return name
  const pattern = new RegExp(`(^|\\D)${grade}(?=\\D|$)`)
  return pattern.test(name) ? name.replace(pattern, `$1${grade + 1}`) : name
}

async function years(sourceYearId: string, targetYearId: string) {
  const [source, target] = await Promise.all([
    prisma.schoolYear.findUnique({ where: { id: sourceYearId } }),
    prisma.schoolYear.findUnique({ where: { id: targetYearId } }),
  ])
  if (!source || !target) throw createError('Không tìm thấy năm học', 404)
  if (target.status === 'CLOSED') throw createError('Năm đích đã đóng', 409)
  if (target.startDate <= source.startDate) throw createError('Năm đích phải sau năm nguồn', 400)
  return { source, target, cutoff: new Date(target.startDate.getTime() - DAY) }
}

/** Lớp còn hoạt động của năm nguồn, chưa kết thúc trước năm mới (lớp đã xử lý ở lần chuyển trước có endDate ≤ mốc) */
async function sourceClasses(sourceYearId: string, cutoff: Date) {
  return prisma.class.findMany({
    where: { schoolYearId: sourceYearId, status: 'ACTIVE', OR: [{ endDate: null }, { endDate: { gt: cutoff } }] },
    include: {
      ...classInclude, branch: { select: { name: true } }, promotedTo: { select: { id: true, name: true } },
      schedules: { where: { effectiveTo: null } },
      enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true, customTuitionRate: true, student: { select: { status: true } } } },
    },
    orderBy: { name: 'asc' },
  })
}

/** Phiếu học phí của lớp cũ trong / sau tháng năm đích bắt đầu: kết thúc lớp sẽ lệch học phí, cần đối chiếu trước */
async function billedAfter(classIds: string[], start: Date) {
  const period = start.getUTCFullYear() * 100 + start.getUTCMonth() + 1
  const rows = await prisma.tuitionRecord.findMany({ where: { classId: { in: classIds } }, select: { classId: true, billingYear: true, billingMonth: true } })
  return new Set(rows.filter(r => r.billingYear * 100 + r.billingMonth >= period).map(r => r.classId!))
}

export async function previewRollover(sourceYearId: string, targetYearId: string) {
  const { target, cutoff } = await years(sourceYearId, targetYearId)
  const classes = await sourceClasses(sourceYearId, cutoff)
  const billed = await billedAfter(classes.map(c => c.id), target.startDate)
  const graduating = await prisma.student.findMany({
    where: { status: 'ACTIVE', gradeLevel: { gte: 12 } }, select: { id: true, fullName: true, gradeLevel: true }, orderBy: { fullName: 'asc' },
  })
  return {
    cutoff: ymd(cutoff),
    classes: classes.map(c => {
      const students = c.enrollments.filter(e => e.student.status === 'ACTIVE').length
      const grade = gradeOf(c)
      return {
        id: c.id, name: c.name, branchName: c.branch.name, gradeLevel: grade, teacherName: c.teacher?.fullName ?? null,
        students, schedules: c.schedules.length, tuitionRate: classRateForMonth(classDoc(c), cutoff.getUTCMonth() + 1, cutoff.getUTCFullYear()),
        suggestedName: nextClassName(c.name, grade), suggestedGrade: grade && grade < 12 ? grade + 1 : grade,
        // Lớp 12 thường không mở lại; lớp đã chuyển hoặc đã có phiếu sau mốc thì không xử lý được
        suggestedAction: (grade ?? 0) >= 12 ? 'skip' : 'promote',
        blocked: c.promotedTo ? `Đã chuyển thành lớp ${c.promotedTo.name}` : billed.has(c.id) ? 'Đã có phiếu học phí từ tháng năm mới bắt đầu' : null,
      }
    }).sort((a, b) => (a.gradeLevel ?? 99) - (b.gradeLevel ?? 99) || a.name.localeCompare(b.name, 'vi')),
    graduating,
  }
}

export async function applyRollover(sourceYearId: string, input: RolloverInput) {
  const { target, cutoff } = await years(sourceYearId, input.targetYearId)
  const classes = await sourceClasses(sourceYearId, cutoff)
  const byId = new Map(classes.map(c => [c.id, c]))
  const requested = new Map(input.classes.map(c => [c.classId, c]))
  if (requested.size !== input.classes.length) throw createError('Mỗi lớp chỉ chọn một lần', 400)
  const missing = classes.filter(c => !c.promotedTo && !requested.has(c.id))
  if (missing.length) throw createError(`Chưa chọn cách xử lý cho lớp: ${missing.map(c => c.name).join(', ')}`, 400)
  for (const item of input.classes) {
    const cls = byId.get(item.classId)
    if (!cls) throw createError('Lớp không thuộc năm nguồn hoặc không còn hoạt động', 404)
    if (cls.promotedTo) throw createError(`Lớp ${cls.name} đã được chuyển năm`, 409)
    if (!['promote', 'empty', 'skip'].includes(item.action)) throw createError('Cách xử lý lớp không hợp lệ', 400)
    if (item.action !== 'skip' && !String(item.name ?? cls.name).trim()) throw createError('Tên lớp mới không được trống', 400)
  }
  const billed = await billedAfter(input.classes.map(c => c.classId), target.startDate)
  if (billed.size) throw createError(`Lớp đã có phiếu học phí từ tháng năm mới bắt đầu, cần đối chiếu trước: ${[...billed].map(id => byId.get(id)!.name).join(', ')}`, 409)

  const graduateIds = [...new Set(input.graduateIds ?? [])]
  const ended = ymd(cutoff) < new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
  const result = await prisma.$transaction(async tx => {
    const created: { from: string; id: string; name: string; students: number }[] = []
    for (const item of input.classes) {
      const cls = byId.get(item.classId)!
      if (item.action !== 'skip') {
        const id = newId()
        const doc = classDoc(cls)
        await tx.class.create({ data: {
          id, name: String(item.name ?? cls.name).trim(), branchId: cls.branchId, schoolYearId: target.id, promotedFromId: cls.id,
          gradeLevel: item.gradeLevel === undefined ? cls.gradeLevel : item.gradeLevel, subjectId: cls.subjectId, teacherId: cls.teacherId,
          room: cls.room, maxStudents: cls.maxStudents, sessionsPerMonth: cls.sessionsPerMonth, notes: cls.notes,
          tuitionRate: classRateForMonth(doc, cutoff.getUTCMonth() + 1, cutoff.getUTCFullYear()) || null,
          startDate: target.startDate, status: 'ACTIVE',
        } })
        // Lịch giữ nguyên thứ, giờ; buổi học được cron sinh dần từ ngày đầu năm học
        if (cls.schedules.length) await tx.schedule.createMany({ data: cls.schedules.map(s => ({
          id: newId(), classId: id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, effectiveFrom: target.startDate,
        })) })
        const movers = item.action === 'promote'
          ? cls.enrollments.filter(e => e.student.status === 'ACTIVE' && !graduateIds.includes(e.studentId)) : []
        for (const e of movers) {
          await tx.classEnrollment.create({ data: { id: newId(), classId: id, studentId: e.studentId, enrollmentDate: target.startDate, status: 'ACTIVE', customTuitionRate: e.customTuitionRate } })
        }
        await recountClassActiveStudents(id, tx)
        created.push({ from: cls.id, id, name: String(item.name ?? cls.name).trim(), students: movers.length })
      }
      // Kết thúc lớp cũ trước ngày năm mới bắt đầu
      await tx.class.update({ where: { id: cls.id }, data: { endDate: cutoff, ...(ended ? { status: 'CLOSED' as const } : {}) } })
      await tx.schedule.updateMany({ where: { classId: cls.id, OR: [{ effectiveTo: null }, { effectiveTo: { gt: cutoff } }] }, data: { effectiveTo: cutoff } })
      await tx.session.deleteMany({ where: { classId: cls.id, status: 'SCHEDULED', sessionDate: { gt: cutoff } } })
    }
    const graduated = graduateIds.length
      ? (await tx.student.updateMany({ where: { id: { in: graduateIds }, status: 'ACTIVE' }, data: { status: 'GRADUATED' } })).count : 0
    const bumped = input.bumpGrades === false ? 0
      : (await tx.student.updateMany({ where: { status: 'ACTIVE', gradeLevel: { gte: 1, lt: 12 } }, data: { gradeLevel: { increment: 1 } } })).count
    return { created, closed: input.classes.length, graduated, bumped }
  }, { timeout: 60_000 })
  return { ...result, cutoff: ymd(cutoff), targetYear: target.name }
}
