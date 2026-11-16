const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const { prisma, reset, seed, day, newId, context } = require('./helpers/pg.cjs')
const { runInScope } = require('../dist/lib/scope')
const { previewRollover, applyRollover, nextClassName, gradeOf } = require('../dist/services/schoolYearRollover')

beforeEach(reset)

async function fixture() {
  const { branchId, schoolYearId } = await context()
  const target = await prisma.schoolYear.create({ data: { id: newId(), name: '2027–2028', startDate: day('2027-07-01'), endDate: day('2028-06-30') } })
  const g8 = await seed.klass({ name: 'Toán 8A', gradeLevel: 8, tuitionRate: 150000, teacherId: (await prisma.teacher.create({ data: { id: newId(), fullName: 'Cô Lan' } })).id })
  await prisma.schedule.create({ data: { id: newId(), classId: g8.id, dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:30', effectiveFrom: day('2026-07-01') } })
  const a = await seed.student({ gradeLevel: 8 }), b = await seed.student({ gradeLevel: 8 })
  await seed.enrollment({ classId: g8.id, studentId: a.id, customTuitionRate: 120000 })
  await seed.enrollment({ classId: g8.id, studentId: b.id })
  const before = await seed.session({ classId: g8.id, sessionDate: '2027-06-28' })
  const after = await seed.session({ classId: g8.id, sessionDate: '2027-07-05' })
  const g12 = await seed.klass({ name: 'Toán 12 - CQT01' }) // khối suy từ tên
  const senior = await seed.student({ gradeLevel: 12 })
  await seed.enrollment({ classId: g12.id, studentId: senior.id })
  const g9 = await seed.klass({ name: 'Toán 9B', gradeLevel: 9 })
  return { branchId, schoolYearId, target, g8, g12, g9, a, b, senior, before, after }
}
const inBranch = (branchId, fn) => runInScope({ branchIds: [branchId], schoolYearId: null }, fn)

test('gợi ý tên lớp năm sau theo khối', () => {
  assert.equal(nextClassName('Toán 8A', 8), 'Toán 9A')
  assert.equal(nextClassName('Toán lớp 9', 9), 'Toán lớp 10')
  assert.equal(nextClassName('Toán 18 nâng cao', 8), 'Toán 18 nâng cao', 'không đổi số khác khối')
  assert.equal(nextClassName('Toán 12', 12), 'Toán 12')
  // Tên lớp thật trên hệ thống, chưa điền khối
  assert.equal(gradeOf({ gradeLevel: null, name: 'Toán 10 - CQT01' }), 10)
  assert.equal(nextClassName('Toán 10 - CQT01', 10), 'Toán 11 - CQT01')
  assert.equal(nextClassName('Toán 9 - CQT02', 9), 'Toán 10 - CQT02')
  assert.equal(gradeOf({ gradeLevel: null, name: 'Luyện đề' }), null)
})

test('xem trước: lên lớp mặc định, lớp 12 mặc định không mở lại, liệt kê học viên lớp 12', async () => {
  const f = await fixture()
  const preview = await inBranch(f.branchId, () => previewRollover(f.schoolYearId, f.target.id))
  assert.equal(preview.cutoff, '2027-06-30')
  const g8 = preview.classes.find(c => c.id === f.g8.id)
  assert.deepEqual([g8.suggestedName, g8.suggestedGrade, g8.suggestedAction, g8.students, g8.tuitionRate, g8.blocked], ['Toán 9A', 9, 'promote', 2, 150000, null])
  assert.equal(preview.classes.find(c => c.id === f.g12.id).suggestedAction, 'skip')
  assert.deepEqual(preview.graduating.map(s => s.id), [f.senior.id])
})

test('chuyển năm: lớp mới giữ nhóm học sinh, lịch, học phí; lớp cũ kết thúc trước năm mới; học viên lên khối', async () => {
  const f = await fixture()
  const result = await inBranch(f.branchId, () => applyRollover(f.schoolYearId, {
    targetYearId: f.target.id, graduateIds: [f.senior.id],
    classes: [
      { classId: f.g8.id, action: 'promote', name: 'Toán 9A', gradeLevel: 9 },
      { classId: f.g12.id, action: 'skip' },
      { classId: f.g9.id, action: 'empty', name: 'Toán 10B', gradeLevel: 10 },
    ],
  }))
  assert.deepEqual([result.created.length, result.closed, result.graduated, result.bumped], [2, 3, 1, 2])

  const next = await prisma.class.findUniqueOrThrow({ where: { promotedFromId: f.g8.id }, include: { schedules: true, enrollments: true } })
  assert.deepEqual([next.name, next.gradeLevel, next.schoolYearId, next.branchId, next.tuitionRate, next.status], ['Toán 9A', 9, f.target.id, f.branchId, 150000, 'ACTIVE'])
  assert.equal(next.activeStudentCount, 2)
  assert.deepEqual(next.schedules.map(s => [s.dayOfWeek, s.startTime, s.effectiveFrom.toISOString().slice(0, 10)]), [['MONDAY', '18:00', '2027-07-01']])
  assert.deepEqual(next.enrollments.map(e => e.customTuitionRate).sort(), [120000, null].sort())
  assert.equal((await prisma.class.findUniqueOrThrow({ where: { promotedFromId: f.g9.id }, include: { enrollments: true } })).enrollments.length, 0)
  assert.equal(await prisma.class.count({ where: { promotedFromId: f.g12.id } }), 0)

  const old = await prisma.class.findUniqueOrThrow({ where: { id: f.g8.id }, include: { schedules: true } })
  // Mốc 30/06/2027 chưa tới: lớp cũ vẫn hoạt động tới ngày cuối, lịch dừng ở mốc
  assert.deepEqual([old.status, old.endDate.toISOString().slice(0, 10), old.schedules[0].effectiveTo.toISOString().slice(0, 10)], ['ACTIVE', '2027-06-30', '2027-06-30'])
  assert.equal(await prisma.session.count({ where: { id: f.after.id } }), 0, 'buổi chưa học sau mốc bị xoá')
  assert.equal(await prisma.session.count({ where: { id: f.before.id } }), 1)

  const students = Object.fromEntries((await prisma.student.findMany()).map(s => [s.id, [s.status, s.gradeLevel]]))
  assert.deepEqual(students[f.a.id], ['ACTIVE', 9])
  assert.deepEqual(students[f.senior.id], ['GRADUATED', 12])
})

test('chuyển năm chặn: chạy lại, thiếu lớp, năm đích đã đóng, lớp đã có phiếu sau mốc, lớp của cơ sở khác', async () => {
  const f = await fixture()
  const all = [{ classId: f.g8.id, action: 'promote' }, { classId: f.g12.id, action: 'skip' }, { classId: f.g9.id, action: 'skip' }]
  const run = (input, branchId = f.branchId) => inBranch(branchId, () => applyRollover(f.schoolYearId, { targetYearId: f.target.id, ...input }))

  await assert.rejects(run({ classes: all.slice(0, 2) }), err => err.status === 400 && /Toán 9B/.test(err.message))
  await seed.tuition({ studentId: f.a.id, classId: f.g8.id, billingMonth: 7, billingYear: 2027, finalAmount: 1 })
  await assert.rejects(run({ classes: all }), err => err.status === 409 && /Toán 8A/.test(err.message))
  await prisma.tuitionRecord.deleteMany()

  const other = (await prisma.branch.create({ data: { id: newId(), name: 'Cơ sở B' } })).id
  await assert.rejects(run({ classes: all }, other), err => err.status === 404, 'lớp ngoài phạm vi cơ sở')

  await run({ classes: all })
  // Lớp đã xử lý (kể cả lớp không mở lại) không xuất hiện lại; chạy lại không tạo trùng
  assert.deepEqual((await inBranch(f.branchId, () => previewRollover(f.schoolYearId, f.target.id))).classes, [])
  await assert.rejects(run({ classes: [{ classId: f.g8.id, action: 'promote' }] }), err => err.status === 404)
  assert.equal(await prisma.class.count({ where: { schoolYearId: f.target.id } }), 1)
  await prisma.schoolYear.update({ where: { id: f.target.id }, data: { status: 'CLOSED' } })
  await assert.rejects(run({ classes: [] }), err => err.status === 409)
})

test('chuyển năm muộn (mốc đã qua) thì lớp cũ kết thúc ngay', async () => {
  const { branchId, schoolYearId } = await context()
  const target = await prisma.schoolYear.create({ data: { id: newId(), name: 'muộn', startDate: day('2026-09-01'), endDate: day('2027-08-31') } })
  await prisma.schoolYear.update({ where: { id: schoolYearId }, data: { startDate: day('2025-09-01') } })
  const cls = await seed.klass({ name: 'Toán 8A' })
  await inBranch(branchId, () => applyRollover(schoolYearId, { targetYearId: target.id, classes: [{ classId: cls.id, action: 'promote' }] }))
  assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: cls.id } })).status, 'CLOSED')
})
