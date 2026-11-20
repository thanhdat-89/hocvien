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

// Lớp cũ T6 + CN, 150.000đ: 11/2026 có 1, 6, 8, 13, 15, 20, 22, 27, 29; 12/2026 có 4, 6.
const OLD_DATES = ['2026-11-01', '2026-11-06', '2026-11-08', '2026-11-13', '2026-11-15', '2026-11-20', '2026-11-22', '2026-11-27', '2026-11-29', '2026-12-04', '2026-12-06']
// Lớp mới T3 + T7: sau 16/11 có 17, 21, 24, 28; 12/2026 có 1, 5, 8, 12.
const NEW_DATES = ['2026-11-03', '2026-11-07', '2026-11-10', '2026-11-14', '2026-11-17', '2026-11-21', '2026-11-24', '2026-11-28', '2026-12-01', '2026-12-05', '2026-12-08', '2026-12-12']

test('setup lớp', async () => {
  await classWith('ca', 'Toán 8 - CQT02', 150000, ['FRIDAY', 'SUNDAY'], OLD_DATES)
  await classWith('cb', 'Toán 8 - CQT03', 180000, ['TUESDAY', 'SATURDAY'], NEW_DATES)
  await classWith('cd', 'Toán 8 - CQT04', 150000, ['TUESDAY', 'SATURDAY'], NEW_DATES)
  await classWith('cc', 'Toán 9 - CQT01', 150000, ['MONDAY'], [])
})

/** Học viên học lớp cũ từ 1/10, đã thu đủ tháng 11 (9 buổi, 1.350.000đ), có phiếu tháng 12 chưa thu. */
async function paidStudent(id) {
  const student = await seed.student({ id })
  const e = (await enroll({ params: { id }, body: { classId: 'ca', enrollmentDate: '2026-10-01' } })).body
  const nov = (await calculateTuitionForStudent(id, 'ca', 11, 2026)).tuitionRecord
  await calculateTuitionForStudent(id, 'ca', 12, 2026)
  await seed.payment({ tuitionRecordId: nov.id, studentId: id, amount: 1350000, receivedByName: 'Thu ngân' })
  await prisma.tuitionRecord.update({ where: { id: nov.id }, data: { status: 'PAID', paidAmount: 1350000 } })
  return { student, params: { id, enrollmentId: e.id } }
}
const recordsOf = async studentId => (await prisma.tuitionRecord.findMany({ where: { studentId }, orderBy: [{ classId: 'asc' }, { billingMonth: 'asc' }] }))
  .map(r => [r.classId, r.billingMonth, r.totalSessions, r.finalAmount, r.status === 'PAID' ? 'PAID' : 'chưa thu'])

test('cùng đơn giá, tổng buổi không đổi: chênh lệch 0, không hỏi điều chỉnh', async () => {
  const { student, params } = await paidStudent('s0')
  await assert.rejects(transfer({ params, body: { toClassId: 'cc', startDate: '2026-11-16' } }), /cùng khối 8/)
  const p = (await preview({ params, body: { action: 'transfer', toClassId: 'cd', startDate: '2026-11-16' } })).body
  assert.deepEqual(p.settlement, { months: [{ month: 11, year: 2026, paid: 1350000, actual: 1350000 }], amount: 0, month: 12, year: 2026, nextMonthBase: 600000 })
  assert.deepEqual(p.newClass.months.map(m => [m.month, m.after.sessions, m.after.amount, m.outcome]), [[11, 4, 0, 'covered'], [12, 4, 600000, 'create']])
  await transfer({ params, body: { toClassId: 'cd', startDate: '2026-11-16' } })
  assert.deepEqual(await recordsOf(student.id), [
    ['ca', 11, 9, 1350000, 'PAID'],
    ['cd', 11, 4, 0, 'PAID'], // buổi lớp mới tháng 11 đã gồm trong phiếu lớp cũ: phiếu 0đ, coi như đã thu
    ['cd', 12, 4, 600000, 'chưa thu'],
  ])
})

test('lớp mới đắt hơn: thực tế nhiều hơn đã thu → thu thêm tháng sau khi được chọn', async () => {
  const { student, params } = await paidStudent('s1')
  await assert.rejects(transfer({ params, body: { toClassId: 'cb', startDate: '2026-11-16', days: ['MONDAY'] } }), /không có buổi học vào T2/)
  const p = (await preview({ params, body: { action: 'transfer', toClassId: 'cb', startDate: '2026-11-16' } })).body
  assert.equal(p.dropDate, '2026-11-15')
  // Thực tế: 5 buổi × 150.000 + 4 buổi × 180.000 = 1.470.000; đã thu 1.350.000 → thu thêm 120.000.
  assert.deepEqual(p.settlement, { months: [{ month: 11, year: 2026, paid: 1350000, actual: 1470000 }], amount: 120000, month: 12, year: 2026, nextMonthBase: 720000 })
  assert.deepEqual(p.oldClass.months.map(m => [m.month, m.after.sessions, m.outcome]), [[11, 5, 'locked'], [12, 0, 'delete']])
  assert.deepEqual(p.newClass.months.map(m => [m.month, m.after.amount, m.outcome]), [[11, 0, 'covered'], [12, 840000, 'create']])

  await assert.rejects(transfer({ params, body: { toClassId: 'cb', startDate: '2026-11-16' } }), /thu thêm/)
  assert.equal((await prisma.classEnrollment.findUnique({ where: { id: params.enrollmentId } })).status, 'ACTIVE', 'chưa chọn thì chưa ghi gì')

  const res = (await transfer({ params, body: { toClassId: 'cb', startDate: '2026-11-16', applyAdjustment: true } })).body
  assert.equal(res.adjustment, 120000)
  const old = await prisma.classEnrollment.findUnique({ where: { id: params.enrollmentId } })
  assert.equal(old.status, 'DROPPED')
  assert.equal(old.dropDate.toISOString().slice(0, 10), '2026-11-15')
  assert.match(old.notes, /Chuyển từ lớp Toán 8 - CQT02 sang lớp Toán 8 - CQT03 từ 16\/11\/2026/)
  assert.deepEqual(await recordsOf(student.id), [
    ['ca', 11, 9, 1350000, 'PAID'],
    ['cb', 11, 4, 0, 'PAID'],
    ['cb', 12, 4, 840000, 'chưa thu'],
  ])
  const dec = await prisma.tuitionRecord.findFirst({ where: { studentId: student.id, classId: 'cb', billingMonth: 12 } })
  assert.deepEqual([dec.baseAmount, dec.discountAmount, dec.adjustmentAmount], [840000, 0, 120000], 'thu thêm cộng vào học phí gốc, hoá đơn MISA vẫn hợp lệ')
  assert.match(dec.adjustmentNote, /Thu thêm chênh lệch chuyển lớp từ Toán 8 - CQT02 \(T11\/2026\)/)
  const counts = await prisma.class.findMany({ where: { id: { in: ['ca', 'cb'] } }, orderBy: { id: 'asc' }, select: { activeStudentCount: true } })
  assert.deepEqual(counts.map(c => c.activeStudentCount), [0, 1], 'sĩ số: lớp cũ hết học viên (s0, s1 đã chuyển), lớp mới có s1')
})

test('học ít buổi hơn ở lớp mới: đã thu nhiều hơn → giảm tháng sau; chọn không thì không ghi', async () => {
  const { student, params } = await paidStudent('s2')
  // Chỉ học T7 ở lớp mới: 21, 28 → thực tế 750.000 + 360.000 = 1.110.000; đã thu 1.350.000 → giảm 240.000.
  const p = (await preview({ params, body: { action: 'transfer', toClassId: 'cb', startDate: '2026-11-16', days: ['SATURDAY'] } })).body
  assert.equal(p.settlement.amount, -240000)
  await assert.rejects(transfer({ params, body: { toClassId: 'cb', startDate: '2026-11-16', days: ['SATURDAY'] } }), /giảm/)
  await transfer({ params, body: { toClassId: 'cb', startDate: '2026-11-16', days: ['SATURDAY'], applyAdjustment: false } })
  const adj = await prisma.tuitionAdjustment.findMany({ where: { studentId: student.id }, select: { billingMonth: true, amount: true } })
  assert.deepEqual(adj, [{ billingMonth: 11, amount: -360000 }], 'chỉ có khoản "đã gồm trong phiếu lớp cũ", không có khoản giảm tháng 12')
})

test('chọn giảm: phiếu tháng sau giảm đúng số chênh lệch', async () => {
  const { student, params } = await paidStudent('s3')
  await transfer({ params, body: { toClassId: 'cb', startDate: '2026-11-16', days: ['SATURDAY'], applyAdjustment: true } })
  const dec = await prisma.tuitionRecord.findFirst({ where: { studentId: student.id, classId: 'cb', billingMonth: 12 } })
  // Tháng 12 chỉ T7: 5, 12 → 360.000 − 240.000 = 120.000
  assert.deepEqual([dec.totalSessions, dec.baseAmount, dec.discountAmount, dec.finalAmount], [2, 360000, 240000, 120000])
})
