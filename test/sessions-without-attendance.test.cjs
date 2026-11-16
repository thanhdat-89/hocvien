const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed, routeHandler, newId } = require('./helpers/pg.cjs')
const router = require('../dist/routes/sessions').default

before(reset)
after(() => prisma.$disconnect())

test('completing sessions and changing teachers do not create attendance', async () => {
  const oldTeacher = await prisma.teacher.create({ data: { id: newId(), fullName: 'Giáo viên cũ' } })
  const newTeacher = await prisma.teacher.create({ data: { id: newId(), fullName: 'Giáo viên mới' } })
  const cls = await seed.klass({ name: 'Toán 6', teacherId: oldTeacher.id })
  const student = await seed.student()
  await seed.enrollment({ classId: cls.id, studentId: student.id, status: 'ACTIVE' })
  const session = await seed.session({ classId: cls.id, teacherId: oldTeacher.id, sessionDate: '2020-01-01', status: 'SCHEDULED' })
  const auth = { user: { role: 'ADMIN', userId: 'admin' } }

  const completed = await routeHandler(router, '/:id/complete', 'put')({ ...auth, params: { id: session.id }, body: {} })
  assert.equal(completed.body.session.status, 'COMPLETED')
  assert.equal(completed.body.session.className, 'Toán 6')
  assert.equal(completed.body.message, 'Đã hoàn thành buổi học')

  await prisma.session.update({ where: { id: session.id }, data: { status: 'SCHEDULED' } })
  const bulk = await routeHandler(router, '/complete-past', 'post')(auth)
  assert.equal(bulk.body.count, 1)

  await routeHandler(router, '/:id', 'put')({ ...auth, params: { id: session.id }, body: { teacherId: newTeacher.id } })
  const detail = await routeHandler(router, '/:id', 'get')({ ...auth, params: { id: session.id } })
  assert.equal(detail.body.teacherName, 'Giáo viên mới')

  assert.equal(await prisma.studentAttendance.count(), 0)
  assert.equal(await prisma.teacherAttendance.count(), 0)
  assert.equal(router.stack.some(layer => layer.route?.path === '/auto-init-attendance'), false)
})
