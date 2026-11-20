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

const drop = routeHandler(router, '/:id/enroll/:enrollmentId/drop', 'put')
const preview = routeHandler(router, '/:id/enroll/:enrollmentId/preview', 'post')

test('nghỉ lớp giữa tháng: xem trước, chặn tháng đã thu bị bớt buổi, tính lại và xoá phiếu chưa thu', async () => {
  const student = await seed.student({ id: 's2' })
  const cls = await seed.klass({ id: 'c2', name: 'Toán 8 - CQT02', tuitionRate: 150000 })
  await seed.schedule({ classId: cls.id, dayOfWeek: 'FRIDAY', startTime: '18:00', endTime: '19:30', effectiveFrom: '2026-09-01' })
  await seed.schedule({ classId: cls.id, dayOfWeek: 'SUNDAY', startTime: '10:10', endTime: '11:40', effectiveFrom: '2026-09-01' })
  // 11/2026: T6 = 6, 13, 20, 27; CN = 1, 8, 15, 22, 29. 12/2026: T6 = 4, 11; CN = 6, 13.
  for (const d of ['2026-11-01', '2026-11-06', '2026-11-08', '2026-11-13', '2026-11-15', '2026-11-20', '2026-11-22', '2026-11-27', '2026-11-29',
    '2026-12-04', '2026-12-06', '2026-12-11', '2026-12-13']) {
    await seed.session({ classId: cls.id, sessionDate: d, status: 'SCHEDULED' })
  }
  const e = (await enroll({ params: { id: student.id }, body: { classId: cls.id, enrollmentDate: '2026-10-01' } })).body
  const nov = (await calculateTuitionForStudent(student.id, cls.id, 11, 2026)).tuitionRecord
  await calculateTuitionForStudent(student.id, cls.id, 12, 2026)
  assert.equal(nov.totalSessions, 9)

  await assert.rejects(drop({ params: { id: student.id, enrollmentId: e.id }, body: { dropDate: '2026-09-30' } }), /trước ngày đăng ký/)

  // Xem trước nghỉ sau buổi 15/11: tháng 11 còn 5 buổi, tháng 12 không còn buổi → xoá phiếu. Không ghi gì.
  const p = (await preview({ params: { id: student.id, enrollmentId: e.id }, body: { action: 'drop', dropDate: '2026-11-15' } })).body
  assert.equal(p.blocked, null)
  assert.deepEqual(p.months.map(m => [m.month, m.before.sessions, m.after.sessions, m.after.amount, m.outcome]),
    [[11, 9, 5, 750000, 'recalculate'], [12, 4, 0, 0, 'delete']])
  assert.equal((await prisma.classEnrollment.findUnique({ where: { id: e.id } })).status, 'ACTIVE')

  // Tháng 11 đã thu: nghỉ 15/11 bị chặn (bớt buổi), nghỉ 30/11 thì được (tháng 11 giữ đủ 9 buổi).
  await seed.payment({ tuitionRecordId: nov.id, studentId: student.id, amount: 1350000, receivedByName: 'Thu ngân' })
  await prisma.tuitionRecord.update({ where: { id: nov.id }, data: { status: 'PAID', paidAmount: 1350000 } })
  const blocked = (await preview({ params: { id: student.id, enrollmentId: e.id }, body: { action: 'drop', dropDate: '2026-11-15' } })).body
  assert.match(blocked.blocked, /T11\/2026/)
  await assert.rejects(drop({ params: { id: student.id, enrollmentId: e.id }, body: { dropDate: '2026-11-15' } }),
    err => err.status === 409 && /T11\/2026/.test(err.message))

  const res = (await drop({ params: { id: student.id, enrollmentId: e.id }, body: { dropDate: '2026-11-30' } })).body
  assert.equal(res.deletedRecords, 1)
  const records = await prisma.tuitionRecord.findMany({ where: { studentId: student.id } })
  assert.deepEqual(records.map(r => [r.billingMonth, r.totalSessions, r.status]), [[11, 9, 'PAID']])
  const after = await prisma.classEnrollment.findUnique({ where: { id: e.id } })
  assert.equal(after.status, 'DROPPED')
  assert.equal(after.dropDate.toISOString().slice(0, 10), '2026-11-30')
})

test('xem trước đổi buổi: số buổi trước/sau theo tháng', async () => {
  const student = await seed.student({ id: 's3' })
  const e = (await enroll({ params: { id: student.id }, body: { classId: 'c2', enrollmentDate: '2026-10-01' } })).body
  const p = (await preview({ params: { id: student.id, enrollmentId: e.id }, body: { action: 'weekdays', days: ['FRIDAY'], effectiveFrom: '2026-11-15' } })).body
  assert.equal(p.blocked, null)
  // 11/2026 trước 15/11 học đủ (1, 6, 8, 13) + T6 20, 27 = 6; chưa có phiếu nên không tính lại gì.
  assert.deepEqual(p.months.map(m => [m.month, m.before.sessions, m.after.sessions, m.outcome]), [[11, 9, 6, 'none']])
})
