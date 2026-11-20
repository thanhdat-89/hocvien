const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const { prisma, reset, seed, routeHandler, context } = require('./helpers/pg.cjs')
const classes = require('../dist/routes/classes').default

beforeEach(reset)

const admin = async () => ({ userId: (await seed.user()).id, role: 'ADMIN' })
const post = body => admin().then(user => routeHandler(classes, '/', 'post')({ user, body }))
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })

test('tạo lớp kèm khối, lịch học và buổi học tháng này + tháng sau', async () => {
  await context()
  const created = await post({
    name: 'Toán 9 - CQT01', gradeLevel: 9, tuitionRate: 200000, startDate: today(),
    schedules: [{ dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:30' }, { dayOfWeek: 'THURSDAY', startTime: '18:00', endTime: '19:30' }],
  })
  assert.equal(created.status, 201)
  const cls = await prisma.class.findUniqueOrThrow({ where: { id: created.body.id } })
  assert.equal(cls.gradeLevel, 9)
  assert.deepEqual((await prisma.schedule.findMany({ where: { classId: cls.id }, orderBy: { dayOfWeek: 'asc' } })).map(s => s.dayOfWeek).sort(), ['MONDAY', 'THURSDAY'])
  const sessions = await prisma.session.count({ where: { classId: cls.id } })
  assert.ok(sessions > 0)
  assert.equal(created.body.sessionsCreated, sessions)
})

test('thiếu khối hoặc lịch sai thì báo 400, không ghi gì', async () => {
  await context()
  const bad = [
    { name: 'Toán 9', startDate: today() },
    { name: 'Toán 9', gradeLevel: 13, startDate: today() },
    { name: 'Toán 9', gradeLevel: 9, startDate: today(), schedules: [{ dayOfWeek: 'MONDAY', startTime: '19:00', endTime: '18:00' }] },
    { name: 'Toán 9', gradeLevel: 9, startDate: today(), schedules: [{ dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }, { dayOfWeek: 'MONDAY', startTime: '20:00', endTime: '21:00' }] },
    { name: 'Toán 9', gradeLevel: 9, startDate: '2026-12-10', endDate: '2026-12-01' },
  ]
  for (const body of bad) assert.equal((await post(body)).status, 400, JSON.stringify(body))
  assert.equal(await prisma.class.count(), 0)
})

