const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed, routeHandler } = require('./helpers/pg.cjs')
const router = require('../dist/routes/students').default
const { calculateTuitionForStudent } = require('../dist/services/tuitionCalculator')

before(reset)
after(() => prisma.$disconnect())

const enroll = routeHandler(router, '/:id/enroll', 'post')
const setWeekdays = routeHandler(router, '/:id/enroll/:enrollmentId/weekdays', 'put')
const schedule = routeHandler(router, '/:id/schedule', 'get')

test('ghi danh học một buổi/tuần: lập phiếu, lịch cá nhân và đổi lịch đều theo buổi đã chọn', async () => {
  const student = await seed.student({ id: 's1' })
  const cls = await seed.klass({ id: 'c1', name: 'Toán 6 - CQT01', tuitionRate: 150000 })
  await seed.schedule({ classId: cls.id, dayOfWeek: 'TUESDAY', startTime: '18:00', endTime: '19:30', effectiveFrom: '2026-09-01' })
  await seed.schedule({ classId: cls.id, dayOfWeek: 'SATURDAY', startTime: '18:00', endTime: '19:30', effectiveFrom: '2026-09-01' })
  // 11/2026: T3 = 3, 10, 17, 24; T7 = 7, 14, 21, 28. 12/2026: T3 = 1, 8, 15, 22, 29; T7 = 5, 12, 19, 26.
  for (const d of ['2026-11-03', '2026-11-07', '2026-11-10', '2026-11-14', '2026-11-17', '2026-11-21', '2026-11-24', '2026-11-28',
    '2026-12-01', '2026-12-05', '2026-12-08', '2026-12-12', '2026-12-15', '2026-12-19', '2026-12-22', '2026-12-26', '2026-12-29']) {
    await seed.session({ classId: cls.id, sessionDate: d, status: 'SCHEDULED' })
  }

  await assert.rejects(enroll({ params: { id: student.id }, body: { classId: cls.id, enrollmentDate: '2026-11-01', weekdays: ['MONDAY'] } }),
    /không có buổi học vào T2/i)
  const created = (await enroll({ params: { id: student.id }, body: { classId: cls.id, enrollmentDate: '2026-11-01', weekdays: ['TUESDAY'] } })).body
  assert.deepEqual(created.weekdays, ['TUESDAY'])

  const nov = (await calculateTuitionForStudent(student.id, cls.id, 11, 2026)).tuitionRecord
  assert.equal(nov.totalSessions, 4)
  assert.equal(nov.finalAmount, 600000)
  const dec = (await calculateTuitionForStudent(student.id, cls.id, 12, 2026)).tuitionRecord
  assert.equal(dec.finalAmount, 750000, 'tháng 12 có 5 buổi T3')

  const novSchedule = (await schedule({ params: { id: student.id }, query: { month: '11', year: '2026' } })).body
  assert.equal(novSchedule.length, 4, 'lịch cá nhân chỉ hiện buổi T3')

  // Tháng 11 đã thu tiền → không được đổi lịch từ tháng 11.
  await seed.payment({ tuitionRecordId: nov.id, studentId: student.id, amount: 600000, receivedByName: 'Thu ngân' })
  await prisma.tuitionRecord.update({ where: { id: nov.id }, data: { status: 'PAID', paidAmount: 600000 } })
  await assert.rejects(setWeekdays({ params: { id: student.id, enrollmentId: created.id }, body: { days: ['TUESDAY', 'SATURDAY'], effectiveFrom: '2026-11-15' } }),
    err => err.status === 409 && /T11\/2026/.test(err.message))

  // Từ 1/12 học đủ: phiếu tháng 12 chưa thu được tính lại, tháng 11 giữ nguyên.
  const res = (await setWeekdays({ params: { id: student.id, enrollmentId: created.id }, body: { days: ['SATURDAY', 'TUESDAY'], effectiveFrom: '2026-12-01' } })).body
  assert.equal(res.recalculatedRecords, 1)
  const after = await prisma.tuitionRecord.findMany({ where: { studentId: student.id }, orderBy: { billingMonth: 'asc' } })
  assert.deepEqual(after.map(r => [r.billingMonth, r.totalSessions, r.finalAmount]), [[11, 4, 600000], [12, 9, 1350000]])
  const plans = await prisma.enrollmentWeekdayPlan.findMany({ where: { enrollmentId: created.id }, orderBy: { effectiveFrom: 'asc' } })
  assert.deepEqual(plans.map(p => p.days), [['TUESDAY'], []], 'chọn đủ mọi buổi được lưu là học đủ')
})
