const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed, routeHandler } = require('./helpers/pg.cjs')
const router = require('../dist/routes/students').default

before(reset)
after(() => prisma.$disconnect())

test('student schedule respects every enrollment period when leaving and rejoining a class', async () => {
  const student = await seed.student({ id: 's1' })
  const cls = await seed.klass({ id: 'c1', name: 'Toán 6 - CQT01', tuitionRate: 150000 })
  const dates = ['2026-07-31', '2026-08-01', '2026-08-05', '2026-08-06', '2026-09-30',
    '2026-10-03', '2026-10-06', '2026-10-10', '2026-10-13', '2026-10-17', '2026-10-20', '2026-10-24', '2026-10-27', '2026-10-31']
  for (const sessionDate of dates) await seed.session({ id: sessionDate, classId: cls.id, sessionDate, startTime: '18:00', status: 'SCHEDULED' })
  const enrol = order => Promise.all(order.map(e => seed.enrollment({ classId: cls.id, studentId: student.id, ...e })))
  const oldEnrollment = { id: 'old', enrollmentDate: '2026-08-05', dropDate: '2026-08-05', status: 'DROPPED', customTuitionRate: 100000 }
  const active = { id: 'active', enrollmentDate: '2026-08-01', status: 'ACTIVE', customTuitionRate: 120000 }
  await enrol([oldEnrollment, active])

  const handler = routeHandler(router, '/:id/schedule', 'get')
  const load = async month => (await handler({ params: { id: 's1' }, query: { month: String(month), year: '2026' } })).body

  const october = await load(10)
  assert.equal(october.length, 9)
  assert.equal(new Set(october.map(s => s.id)).size, 9)
  assert.ok(october.every(s => s.ratePerSession === 120000 && s.className === 'Toán 6 - CQT01'))
  assert.deepEqual((await load(8)).map(s => s.sessionDate), ['2026-08-06', '2026-08-05', '2026-08-01'])

  await prisma.classEnrollment.deleteMany()
  await enrol([active, oldEnrollment].map(e => ({ ...e })))
  assert.deepEqual(await load(10), october, 'Thứ tự lưu ghi danh không ảnh hưởng lịch')

  // Separate enrollment periods: preserve old history and hide the gap.
  await prisma.classEnrollment.update({ where: { id: 'active' }, data: { enrollmentDate: new Date('2026-10-01T00:00:00Z') } })
  assert.deepEqual((await load(8)).map(s => [s.sessionDate, s.ratePerSession]), [['2026-08-05', 100000]])
  assert.deepEqual(await load(9), [])
  assert.equal((await load(10)).length, 9)

  await prisma.classEnrollment.delete({ where: { id: 'active' } })
  assert.deepEqual(await load(10), [], 'Dropped-only students must not see later sessions')
  await prisma.classEnrollment.deleteMany()
  assert.deepEqual(await load(10), [])
})
