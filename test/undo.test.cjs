// Hoàn tác thao tác nguy hiểm (src/lib/undo.ts): khôi phục học viên đã xoá hẳn, hoàn tác đợt ghi đè hàng loạt.
const { test, before, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed, day, routeHandler, newId } = require('./helpers/pg.cjs')
const undo = require('../dist/lib/undo')
const students = require('../dist/routes/students').default

const hardDelete = routeHandler(students, '/:id/hard', 'delete')

before(reset)
beforeEach(reset)
after(() => prisma.$disconnect())

const counts = async studentId => ({
  student: await prisma.student.count({ where: { id: studentId } }),
  enrollments: await prisma.classEnrollment.count({ where: { studentId } }),
  plans: await prisma.enrollmentWeekdayPlan.count({ where: { enrollment: { studentId } } }),
  tuition: await prisma.tuitionRecord.count({ where: { studentId } }),
  payments: await prisma.payment.count({ where: { studentId } }),
  parents: await prisma.parent.count({ where: { studentId } }),
})

test('hard-deleted student comes back with enrollments, weekday plans, tuition and payments', async () => {
  const admin = await seed.user()
  const st = await seed.student({ fullName: 'Lê Văn A' })
  const klass = await seed.klass({ activeStudentCount: 1 })
  const en = await seed.enrollment({ studentId: st.id, classId: klass.id, status: 'ACTIVE' })
  await prisma.enrollmentWeekdayPlan.create({ data: { id: newId(), enrollmentId: en.id, effectiveFrom: day('2026-01-01'), days: ['MONDAY'] } })
  const tr = await seed.tuition({ studentId: st.id, classId: klass.id, billingMonth: 10, billingYear: 2026, finalAmount: 500000 })
  await seed.payment({ tuitionRecordId: tr.id, studentId: st.id, amount: 500000 })
  await prisma.parent.create({ data: { id: newId(), studentId: st.id, fullName: 'Phụ huynh', phone: '0900000000' } })
  const original = await counts(st.id)

  const req = { params: { id: st.id }, user: { userId: admin.id, role: 'ADMIN' }, branchId: null }
  const r = await hardDelete(req)
  assert.equal(r.status, 200)
  assert.deepEqual(Object.values(await counts(st.id)), [0, 0, 0, 0, 0, 0])
  assert.equal((await prisma.class.findUnique({ where: { id: klass.id } })).activeStudentCount, 0)
  const snaps = await prisma.undoSnapshot.findMany()
  assert.equal(snaps.length, 1)
  assert.equal(snaps[0].label, 'Xoá hẳn học viên Lê Văn A')
  const undoId = snaps[0].id

  const preview = await undo.undoSnapshot(undoId, admin.id, true)
  assert.equal(preview.restored, 6)
  assert.equal(await prisma.student.count({ where: { id: st.id } }), 0, 'xem trước không ghi')

  const done = await undo.undoSnapshot(undoId, admin.id, false)
  assert.equal(done.restored, 6)
  assert.deepEqual(await counts(st.id), original)
  assert.equal((await prisma.class.findUnique({ where: { id: klass.id } })).activeStudentCount, 1, 'đếm lại sĩ số')
  assert.equal((await prisma.payment.findFirst({ where: { studentId: st.id } })).amount, 500000)
  await assert.rejects(undo.undoSnapshot(undoId, admin.id, false), { status: 409 })
})

test('batch undo reverts untouched rows, deletes created rows, skips rows changed or used since', async () => {
  const admin = await seed.user()
  const klass = await seed.klass()
  const [s1, s2, s3, s4, s5, s6] = await Promise.all([1, 2, 3, 4, 5, 6].map(i => seed.student({ fullName: `HV ${i}` })))
  const rec = (studentId, finalAmount, classId = klass.id) => seed.tuition({ studentId, classId, billingMonth: 11, billingYear: 2026, finalAmount })
  const a = await rec(s1.id, 100)             // thao tác sửa → trả lại
  const b = await rec(s2.id, 200)             // thao tác không đụng
  const other = await seed.tuition({ studentId: s1.id, classId: klass.id, billingMonth: 10, billingYear: 2026, finalAmount: 9 })  // ngoài phạm vi

  const id = await undo.snapshotBatch([{ table: 'tuition_records', where: { billingMonth: 11, billingYear: 2026, classId: [klass.id, null] } }],
    'Tính học phí hàng loạt tháng 11/2026', { userId: admin.id })
  await assert.rejects(undo.undoSnapshot(id, admin.id, false), { status: 409 }, 'chưa chụp "sau" thì chưa cho hoàn tác')

  // "Thao tác": sửa a, tạo c (sau đó có thanh toán), d (sau đó bị sửa tay), e (không ai đụng), f học riêng (classId null)
  await prisma.tuitionRecord.update({ where: { id: a.id }, data: { finalAmount: 150 } })
  const c = await rec(s3.id, 300), d = await rec(s4.id, 400), e = await rec(s5.id, 500), f = await rec(s6.id, 600, null)
  await undo.captureAfter(id)
  await seed.payment({ tuitionRecordId: c.id, studentId: s3.id, amount: 300 })
  await prisma.tuitionRecord.update({ where: { id: d.id }, data: { notes: 'sửa tay' } })

  const result = await undo.undoSnapshot(id, admin.id, false)
  assert.equal(result.reverted, 1)
  assert.equal(result.deleted, 2)
  assert.deepEqual(result.skipped.map(x => x.reason).sort(), ['đã có dữ liệu ở payments', 'đã được sửa sau thao tác'])
  assert.equal((await prisma.tuitionRecord.findUnique({ where: { id: a.id } })).finalAmount, 100)
  assert.equal((await prisma.tuitionRecord.findUnique({ where: { id: b.id } })).finalAmount, 200)
  assert.ok(await prisma.tuitionRecord.findUnique({ where: { id: c.id } }))
  assert.ok(await prisma.tuitionRecord.findUnique({ where: { id: d.id } }))
  assert.equal(await prisma.tuitionRecord.findUnique({ where: { id: e.id } }), null)
  assert.equal(await prisma.tuitionRecord.findUnique({ where: { id: f.id } }), null)
  assert.ok(await prisma.tuitionRecord.findUnique({ where: { id: other.id } }))
  const snap = await prisma.undoSnapshot.findUnique({ where: { id } })
  assert.ok(snap.undoneAt)
  assert.equal(snap.undoResult.deleted, 2)
})

test('batch undo of generated sessions keeps sessions that already have attendance', async () => {
  const admin = await seed.user()
  const st = await seed.student()
  const klass = await seed.klass()
  const keep = await seed.session({ classId: klass.id, sessionDate: '2026-12-01' })
  const id = await undo.snapshotBatch([{ table: 'sessions', where: { classId: klass.id, sessionDate: { gte: '2026-12-01', lt: '2027-01-01' } } }],
    'Tạo buổi học tháng 12/2026', { userId: admin.id })
  const s1 = await seed.session({ classId: klass.id, sessionDate: '2026-12-08' })
  const s2 = await seed.session({ classId: klass.id, sessionDate: '2026-12-15' })
  const outside = await seed.session({ classId: klass.id, sessionDate: '2027-01-05' })
  await undo.captureAfter(id)
  await prisma.studentAttendance.create({ data: { id: newId(), sessionId: s2.id, classId: klass.id, studentId: st.id, status: 'PRESENT' } })

  const result = await undo.undoSnapshot(id, admin.id, false)
  assert.equal(result.deleted, 1)
  assert.deepEqual(result.skipped, [{ table: 'sessions', reason: 'đã có dữ liệu ở student_attendances', count: 1 }])
  assert.deepEqual((await prisma.session.findMany({ where: { classId: klass.id }, orderBy: { sessionDate: 'asc' } })).map(x => x.id), [keep.id, s2.id, outside.id])
  assert.equal(await prisma.session.findUnique({ where: { id: s1.id } }), null)
})

test('failed operation discards its snapshot; expired snapshots are purged', async () => {
  const admin = await seed.user()
  const id = await undo.snapshotBatch([{ table: 'sessions', where: { classId: 'x' } }], 'thử', { userId: admin.id })
  await undo.discardSnapshot(id)
  assert.equal(await prisma.undoSnapshot.count(), 0)
  const old = await undo.snapshotBatch([{ table: 'sessions', where: { classId: 'x' } }], 'cũ', { userId: admin.id })
  await prisma.undoSnapshot.update({ where: { id: old }, data: { expiresAt: new Date(Date.now() - 1000) } })
  assert.equal(await undo.purgeUndoSnapshots(), 1)
})

test('bulk delete of all students is disabled in production', async () => {
  const bulkDelete = routeHandler(students, '/bulk-delete', 'post')
  const old = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const r = await bulkDelete({ body: { password: 'x' }, user: { userId: 'u', role: 'ADMIN' } })
    assert.equal(r.status, 403)
  } finally { process.env.NODE_ENV = old }
})
