const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed } = require('./helpers/pg.cjs')
const { prepareClassChange, applyClassChange, renameClass, classRateForMonth } = require('../dist/services/classChange')

before(reset)
after(() => prisma.$disconnect())

const tomorrow = () => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

test('renaming a class preserves sessions; changing a billed schedule is blocked', async () => {
  const effectiveDate = tomorrow()
  const [year, month] = effectiveDate.slice(0, 7).split('-').map(Number)

  const cls = await seed.klass({ name: 'Toán 6', status: 'ACTIVE', tuitionRate: 150000 })
  const schedule = await seed.schedule({ classId: cls.id, dayOfWeek: 'TUESDAY', startTime: '18:00', endTime: '19:30', effectiveFrom: '2026-01-01' })
  await seed.session({ classId: cls.id, scheduleId: schedule.id, sessionDate: effectiveDate, startTime: '18:00', status: 'SCHEDULED' })
  const student = await seed.student()
  await seed.tuition({ studentId: student.id, classId: cls.id, billingYear: year, billingMonth: month, status: 'PAID' })
  const snapshot = async () => ({
    schedules: await prisma.schedule.findMany({ where: { classId: cls.id }, orderBy: { id: 'asc' } }),
    sessions: await prisma.session.findMany({ where: { classId: cls.id }, orderBy: { id: 'asc' } }),
    rates: await prisma.classTuitionRate.findMany({ where: { classId: cls.id } }),
  })

  const before = await snapshot()
  await renameClass(cls.id, 'Toán 6 mới')
  assert.equal((await prisma.class.findUnique({ where: { id: cls.id } })).name, 'Toán 6 mới')
  assert.deepEqual(await snapshot(), before, 'Đổi tên không đụng tới lịch, buổi học hay đơn giá')

  const unchanged = { scope: 'schedule', effectiveDate, days: [{ dayOfWeek: 'TUESDAY', startTime: '18:00', endTime: '19:30' }] }
  const plan = await prepareClassChange(cls.id, unchanged)
  assert.equal(plan.summary.scheduleChanged, false)
  assert.equal(plan.summary.removeSessions, 0)
  assert.equal(plan.summary.createSessions, 0)
  const updatedBefore = (await prisma.class.findUnique({ where: { id: cls.id } })).updatedAt
  await applyClassChange(cls.id, { ...unchanged, previewToken: plan.token })
  assert.deepEqual(await snapshot(), before, 'Lịch không đổi: chỉ cập nhật updatedAt của lớp')
  assert.ok((await prisma.class.findUnique({ where: { id: cls.id } })).updatedAt > updatedBefore)
  await assert.rejects(applyClassChange(cls.id, { ...unchanged, previewToken: plan.token }), err => err.status === 409, 'Token cũ không dùng lại được')

  await assert.rejects(prepareClassChange(cls.id, { ...unchanged,
    days: [{ dayOfWeek: 'TUESDAY', startTime: '19:00', endTime: '20:30' }] }), err => err.status === 409, 'Kỳ đã có phiếu học phí')
  await assert.rejects(prepareClassChange(cls.id, { ...unchanged, name: 'Tên mới' }), err => err.status === 400)

  await prisma.tuitionRecord.deleteMany()
  const nextMonthDate = new Date()
  nextMonthDate.setUTCDate(1)
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1)
  const rateInput = { scope: 'rate', tuitionRate: 180000, rateEffectiveMonth: nextMonthDate.toISOString().slice(0, 7) }
  const ratePlan = await prepareClassChange(cls.id, rateInput)
  assert.equal(ratePlan.summary.scheduleChanged, false)
  await applyClassChange(cls.id, { ...rateInput, previewToken: ratePlan.token })
  assert.equal((await prisma.class.findUnique({ where: { id: cls.id } })).tuitionRate, 180000)
  const rates = await prisma.classTuitionRate.findMany({ where: { classId: cls.id }, orderBy: { effectiveMonth: 'asc' } })
  assert.deepEqual(rates.map(r => [r.effectiveMonth, r.rate]), [['2000-01', 150000], [rateInput.rateEffectiveMonth, 180000]])
  assert.deepEqual((await snapshot()).sessions, before.sessions, 'Đổi đơn giá không đổi lịch')

  assert.equal(classRateForMonth({ tuitionRate: 200000, tuitionRateHistory: [
    { effectiveMonth: '2000-01', rate: 150000 }, { effectiveMonth: '2026-11', rate: 200000 },
  ] }, 10, 2026), 150000)
  assert.equal(classRateForMonth({ tuitionRate: 200000, tuitionRateHistory: [
    { effectiveMonth: '2000-01', rate: 150000 }, { effectiveMonth: '2026-11', rate: 200000 },
  ] }, 11, 2026), 200000)
})

test('concurrent saves of the same preview apply exactly once', async () => {
  await reset()
  const cls = await seed.klass({ name: 'Toán 7', status: 'ACTIVE', tuitionRate: 150000 })
  await seed.schedule({ classId: cls.id, dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:30' })
  const input = { scope: 'schedule', effectiveDate: tomorrow(), days: [{ dayOfWeek: 'WEDNESDAY', startTime: '18:00', endTime: '19:30' }] }
  const plan = await prepareClassChange(cls.id, input)
  const results = await Promise.allSettled([1, 2, 3].map(() => applyClassChange(cls.id, { ...input, previewToken: plan.token })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 409))
  assert.equal(await prisma.schedule.count({ where: { classId: cls.id, dayOfWeek: 'WEDNESDAY' } }), 1)
})
