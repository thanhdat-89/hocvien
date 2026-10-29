const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const { prisma, reset, seed, day, routeHandler, newId, context } = require('./helpers/pg.cjs')
const classes = require('../dist/routes/classes').default
const students = require('../dist/routes/students').default
const holidays = require('../dist/routes/holidays').default

beforeEach(reset)

const admin = async () => ({ userId: (await seed.user()).id, role: 'ADMIN' })

test('lớp, học viên, ngày nghỉ mới vào cơ sở mặc định và năm học đang chạy', async () => {
  const { branchId, schoolYearId } = await context()
  const user = await admin()

  const created = await routeHandler(classes, '/', 'post')({ user, body: { name: 'Toán 9A' } })
  assert.equal(created.status, 201)
  assert.deepEqual(await prisma.class.findUniqueOrThrow({ where: { id: created.body.id }, select: { branchId: true, schoolYearId: true } }), { branchId, schoolYearId })

  const student = await routeHandler(students, '/', 'post')({ user, body: { fullName: 'Nguyễn A', parents: [] } })
  assert.equal(student.status, 201)
  assert.equal((await prisma.student.findFirstOrThrow({ where: { fullName: 'Nguyễn A' } })).branchId, branchId)

  const holiday = await routeHandler(holidays, '/', 'post')({ user, body: { name: 'Quốc khánh', startDate: '2026-09-02', endDate: '2026-09-02' } })
  assert.equal(holiday.status, 201)
  assert.deepEqual(await prisma.holidayBranch.findMany({ select: { branchId: true } }), [{ branchId }])
})

test('nhập Excel chỉ ghi danh vào lớp cùng tên của năm học đang chạy', async () => {
  const { branchId } = await context()
  const lastYear = await prisma.schoolYear.create({ data: { id: newId(), name: '2025–2026', startDate: day('2025-07-01'), endDate: day('2026-05-31'), status: 'CLOSED' } })
  const old = await seed.klass({ name: 'Toán 9A', schoolYearId: lastYear.id })
  const current = await seed.klass({ name: 'Toán 9A' })

  const result = await routeHandler(students, '/bulk', 'post')({ user: await admin(), body: { students: [{ fullName: 'Trần B', className: 'Toán 9A' }] } })
  assert.equal(result.status, 201)
  const enrolled = await prisma.classEnrollment.findMany({ select: { classId: true, student: { select: { branchId: true } } } })
  assert.deepEqual(enrolled, [{ classId: current.id, student: { branchId } }])
  assert.notEqual(old.id, current.id)
})

test('không có năm học đang chạy thì tạo lớp báo 409, không ghi gì', async () => {
  await context()
  await prisma.schoolYear.updateMany({ data: { status: 'CLOSED' } })
  await assert.rejects(routeHandler(classes, '/', 'post')({ user: await admin(), body: { name: 'Toán 9A' } }), err => err.status === 409)
  assert.equal(await prisma.class.count(), 0)
})
