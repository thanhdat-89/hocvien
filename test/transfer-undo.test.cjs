// Hoàn tác chuyển lớp từ Lịch sử hoạt động: khôi phục toàn bộ, hoặc không gì nếu đã có thay đổi sau đó.
const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed, routeHandler, newId } = require('./helpers/pg.cjs')
const undo = require('../dist/lib/undo')
const router = require('../dist/routes/students').default
const { calculateTuitionForStudent } = require('../dist/services/tuitionCalculator')

beforeEach(reset)
after(() => prisma.$disconnect())

const enroll = routeHandler(router, '/:id/enroll', 'post')
const transfer = routeHandler(router, '/:id/enroll/:enrollmentId/transfer', 'post')

async function setup() {
  const admin = await seed.user()
  for (const [id, name] of [['ca', 'Toán 12 - CQT03'], ['cb', 'Toán 12 - CQT01']]) {
    await seed.klass({ id, name, tuitionRate: 150000, status: 'ACTIVE' })
    const sch = await seed.schedule({ classId: id, dayOfWeek: 'TUESDAY', startTime: '18:00', endTime: '19:30', effectiveFrom: '2026-09-01' })
    for (const d of ['2026-11-24', '2026-12-01', '2026-12-08', '2026-12-15']) await seed.session({ classId: id, scheduleId: sch.id, sessionDate: d, status: 'SCHEDULED' })
  }
  const st = await seed.student({ fullName: 'Nguyễn Văn A' })
  const e = (await enroll({ params: { id: st.id }, body: { classId: 'ca', enrollmentDate: '2026-10-01' } })).body
  await calculateTuitionForStudent(st.id, 'ca', 11, 2026)
  await calculateTuitionForStudent(st.id, 'ca', 12, 2026)
  const state = async () => ({
    enrollments: (await prisma.classEnrollment.findMany({ where: { studentId: st.id }, orderBy: { id: 'asc' } }))
      .map(x => [x.id, x.classId, x.status, x.dropDate, x.notes]),
    records: (await prisma.tuitionRecord.findMany({ where: { studentId: st.id }, orderBy: { id: 'asc' } }))
      .map(r => [r.id, r.classId, r.billingMonth, r.totalSessions, r.finalAmount, r.status]),
    counts: (await prisma.class.findMany({ orderBy: { id: 'asc' } })).map(c => [c.id, c.activeStudentCount]),
  })
  const original = await state()
  const req = { params: { id: st.id, enrollmentId: e.id }, body: { toClassId: 'cb', startDate: '2026-12-01' }, user: { userId: admin.id, role: 'ADMIN' }, branchId: null }
  await transfer(req)
  const [snap] = await prisma.undoSnapshot.findMany()
  assert.equal(snap.label, 'Chuyển lớp Nguyễn Văn A: Toán 12 - CQT03 → Toán 12 - CQT01 từ 01/12/2026')
  const undoId = snap.id
  await undo.captureAfter(undoId) // route thật chạy khi response kết thúc
  return { admin, st, undoId, original, state }
}

test('hoàn tác chuyển lớp đưa ghi danh, phiếu học phí và sĩ số về như trước', async () => {
  const { admin, undoId, original, state } = await setup()
  const moved = await state()
  assert.notDeepEqual(moved, original)
  assert.ok(moved.records.some(r => r[1] === 'cb' && r[2] === 12), 'đã lập phiếu lớp mới tháng 12')

  const preview = await undo.undoSnapshot(undoId, admin.id, true)
  assert.ok(!preview.blocked)
  assert.deepEqual(await state(), moved, 'xem trước không ghi')

  await undo.undoSnapshot(undoId, admin.id, false)
  assert.deepEqual(await state(), original)
  await assert.rejects(undo.undoSnapshot(undoId, admin.id, false), { status: 409 }, 'không hoàn tác hai lần')
})

test('phiếu lớp mới đã thu tiền: không hoàn tác gì', async () => {
  const { admin, st, undoId, state } = await setup()
  const rec = await prisma.tuitionRecord.findFirst({ where: { studentId: st.id, classId: 'cb', billingMonth: 12 } })
  await seed.payment({ tuitionRecordId: rec.id, studentId: st.id, amount: rec.finalAmount })
  await prisma.tuitionRecord.update({ where: { id: rec.id }, data: { status: 'PAID', paidAmount: rec.finalAmount } })
  const moved = await state()

  const preview = await undo.undoSnapshot(undoId, admin.id, true)
  assert.equal(preview.blocked, true)
  assert.ok(preview.skipped.some(x => x.table === 'tuition_records'))
  await assert.rejects(undo.undoSnapshot(undoId, admin.id, false), err => err.status === 409 && /Không có gì bị thay đổi/.test(err.message))
  assert.deepEqual(await state(), moved, 'không thay đổi dòng nào')
  assert.equal((await prisma.undoSnapshot.findUnique({ where: { id: undoId } })).undoneAt, null, 'vẫn có thể thử lại sau')
})

test('đã điểm danh ở lớp mới: không hoàn tác gì', async () => {
  const { admin, st, undoId, state } = await setup()
  const session = await prisma.session.findFirst({ where: { classId: 'cb', sessionDate: new Date('2026-12-01') } })
  await prisma.studentAttendance.create({ data: { id: newId(), sessionId: session.id, classId: 'cb', studentId: st.id, status: 'PRESENT' } })
  const moved = await state()

  const preview = await undo.undoSnapshot(undoId, admin.id, true)
  assert.equal(preview.blocked, true)
  assert.deepEqual(preview.skipped, [{ table: 'student_attendances', reason: 'phát sinh sau thao tác', count: 1 }])
  await assert.rejects(undo.undoSnapshot(undoId, admin.id, false), { status: 409 })
  assert.deepEqual(await state(), moved)
})
