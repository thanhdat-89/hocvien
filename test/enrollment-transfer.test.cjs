const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed, routeHandler } = require('./helpers/pg.cjs')
const router = require('../dist/routes/students').default
const { calculateTuitionForStudent } = require('../dist/services/tuitionCalculator')

before(reset)
after(() => prisma.$disconnect())

const enroll = routeHandler(router, '/:id/enroll', 'post')
const transfer = routeHandler(router, '/:id/enroll/:enrollmentId/transfer', 'post')
const preview = routeHandler(router, '/:id/enroll/:enrollmentId/preview', 'post')

async function classWith(id, name, rate, slots, dates) {
  const cls = await seed.klass({ id, name, tuitionRate: rate })
  for (const dayOfWeek of slots) await seed.schedule({ classId: id, dayOfWeek, startTime: '18:00', endTime: '19:30', effectiveFrom: '2026-09-01' })
  for (const d of dates) await seed.session({ classId: id, sessionDate: d, status: 'SCHEDULED' })
  return cls
}

test('chuyển lớp giữa tháng đã thu: giữ phiếu lớp cũ, lập phiếu lớp mới, cấn trừ tháng sau khi được chọn', async () => {
  const student = await seed.student({ id: 'st' })
  // Lớp cũ T6 + CN, 150.000đ: 11/2026 có 1, 6, 8, 13, 15, 20, 22, 27, 29; 12/2026 có 4, 6.
  const a = await classWith('ca', 'Toán 8 - CQT02', 150000, ['FRIDAY', 'SUNDAY'],
    ['2026-11-01', '2026-11-06', '2026-11-08', '2026-11-13', '2026-11-15', '2026-11-20', '2026-11-22', '2026-11-27', '2026-11-29', '2026-12-04', '2026-12-06'])
  // Lớp mới T3 + T7, 180.000đ: 11/2026 có 17, 21, 24, 28 sau ngày chuyển; 12/2026 có 1, 5, 8, 12.
  await classWith('cb', 'Toán 8 - CQT03', 180000, ['TUESDAY', 'SATURDAY'],
    ['2026-11-03', '2026-11-07', '2026-11-10', '2026-11-14', '2026-11-17', '2026-11-21', '2026-11-24', '2026-11-28', '2026-12-01', '2026-12-05', '2026-12-08', '2026-12-12'])
  await classWith('cc', 'Toán 9 - CQT01', 150000, ['MONDAY'], [])

  const e = (await enroll({ params: { id: student.id }, body: { classId: a.id, enrollmentDate: '2026-10-01' } })).body
  const nov = (await calculateTuitionForStudent(student.id, a.id, 11, 2026)).tuitionRecord
  await calculateTuitionForStudent(student.id, a.id, 12, 2026)
  await seed.payment({ tuitionRecordId: nov.id, studentId: student.id, amount: 1350000, receivedByName: 'Thu ngân' })
  await prisma.tuitionRecord.update({ where: { id: nov.id }, data: { status: 'PAID', paidAmount: 1350000 } })

  const params = { id: student.id, enrollmentId: e.id }
  await assert.rejects(transfer({ params, body: { toClassId: 'cc', startDate: '2026-11-16' } }), /cùng khối 8/)
  await assert.rejects(transfer({ params, body: { toClassId: 'cb', startDate: '2026-11-16', days: ['MONDAY'] } }), /không có buổi học vào T2/)

  const p = (await preview({ params, body: { action: 'transfer', toClassId: 'cb', startDate: '2026-11-16' } })).body
  assert.equal(p.dropDate, '2026-11-15')
  assert.deepEqual(p.oldClass.months.map(m => [m.month, m.after.sessions, m.outcome]), [[11, 5, 'locked'], [12, 0, 'delete']])
  assert.deepEqual(p.newClass.months.map(m => [m.month, m.after.sessions, m.after.amount, m.outcome]), [[11, 4, 720000, 'create'], [12, 4, 720000, 'create']], 'phiếu 12 lớp cũ bị xoá thì lập phiếu 12 lớp mới thay')
  assert.deepEqual(p.credit, { amount: 600000, sessions: 4, month: 12, year: 2026, nextMonthAmount: 720000 })

  // Có khoản cấn trừ mà chưa chọn có/không → hỏi lại, chưa ghi gì.
  await assert.rejects(transfer({ params, body: { toClassId: 'cb', startDate: '2026-11-16' } }), /cấn trừ/)
  assert.equal((await prisma.classEnrollment.findUnique({ where: { id: e.id } })).status, 'ACTIVE')

  const res = (await transfer({ params, body: { toClassId: 'cb', startDate: '2026-11-16', applyCredit: true } })).body
  assert.equal(res.creditApplied, 600000)
  const old = await prisma.classEnrollment.findUnique({ where: { id: e.id } })
  assert.equal(old.status, 'DROPPED')
  assert.equal(old.dropDate.toISOString().slice(0, 10), '2026-11-15')
  assert.match(old.notes, /Chuyển từ lớp Toán 8 - CQT02 sang lớp Toán 8 - CQT03 từ 16\/11\/2026/)

  const records = await prisma.tuitionRecord.findMany({ where: { studentId: student.id }, orderBy: [{ classId: 'asc' }, { billingMonth: 'asc' }] })
  assert.deepEqual(records.map(r => [r.classId, r.billingMonth, r.totalSessions, r.finalAmount, r.status]),
    [['ca', 11, 9, 1350000, 'PAID'], ['cb', 11, 4, 720000, 'PENDING'], ['cb', 12, 4, 120000, 'PENDING']],
    'phiếu đã thu giữ nguyên; phiếu 12 lớp cũ bị xoá; tháng 12 lớp mới trừ 600.000đ lớp cũ đã thu')
  const counts = await prisma.class.findMany({ where: { id: { in: ['ca', 'cb'] } }, orderBy: { id: 'asc' }, select: { activeStudentCount: true } })
  assert.deepEqual(counts.map(c => c.activeStudentCount), [0, 1])
})

test('chuyển lớp không cấn trừ và từ chối lớp đang học', async () => {
  const student = await seed.student({ id: 'st2' })
  const e = (await enroll({ params: { id: student.id }, body: { classId: 'ca', enrollmentDate: '2026-10-01' } })).body
  const nov = (await calculateTuitionForStudent(student.id, 'ca', 11, 2026)).tuitionRecord
  await prisma.tuitionRecord.update({ where: { id: nov.id }, data: { status: 'PAID', paidAmount: 1350000 } })
  await enroll({ params: { id: student.id }, body: { classId: 'cc', enrollmentDate: '2026-10-01' } })
  const params = { id: student.id, enrollmentId: e.id }
  await transfer({ params, body: { toClassId: 'cb', startDate: '2026-11-16', days: ['SATURDAY'], applyCredit: false } })
  assert.equal(await prisma.studentPromotion.count({ where: { studentId: student.id } }), 0)
  const rec = await prisma.tuitionRecord.findFirst({ where: { studentId: student.id, classId: 'cb', billingMonth: 11 } })
  assert.equal(rec.totalSessions, 2, 'chỉ học T7 ở lớp mới: 21, 28')
})
