const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const jwt = require('jsonwebtoken')
const { prisma, reset, seed, day, routeHandler, newId, context } = require('./helpers/pg.cjs')
const { runInScope } = require('../dist/lib/scope')
const { authenticate } = require('../dist/middleware/auth')
const { readView } = require('../dist/services/readViews')
const { generateSessionsFromSchedule } = require('../dist/services/sessionGenerator')
const holidays = require('../dist/routes/holidays').default
const auth = require('../dist/routes/auth').default

beforeEach(reset)

/** Hai cơ sở, mỗi cơ sở một học viên ghi danh vào một lớp có một buổi học và một phiếu học phí */
async function twoBranches() {
  const { branchId: A, schoolYearId } = await context()
  const B = (await prisma.branch.create({ data: { id: newId(), name: 'Cơ sở B' } })).id
  const make = async branchId => {
    const student = await seed.student({ branchId })
    const klass = await seed.klass({ branchId })
    await seed.enrollment({ classId: klass.id, studentId: student.id })
    const session = await seed.session({ classId: klass.id, sessionDate: '2026-10-05' })
    const tuition = await seed.tuition({ studentId: student.id, classId: klass.id, billingMonth: 10, billingYear: 2026, finalAmount: 100 })
    return { student, klass, session, tuition }
  }
  return { A, B, schoolYearId, a: await make(A), b: await make(B) }
}
const inA = (A, fn) => runInScope({ branchIds: [A], schoolYearId: null }, fn)

test('đọc trong phạm vi cơ sở A không thấy dữ liệu cơ sở B, kể cả theo id và dữ liệu con', async () => {
  const { A, a, b } = await twoBranches()
  await inA(A, async () => {
    assert.deepEqual((await prisma.student.findMany()).map(s => s.id), [a.student.id])
    assert.equal(await prisma.student.findUnique({ where: { id: b.student.id } }), null)
    await assert.rejects(prisma.student.findUniqueOrThrow({ where: { id: b.student.id } }))
    assert.equal(await prisma.class.count(), 1)
    assert.deepEqual((await prisma.session.findMany()).map(s => s.id), [a.session.id])
    assert.deepEqual((await prisma.tuitionRecord.findMany()).map(r => r.id), [a.tuition.id])
    assert.equal((await prisma.classEnrollment.findMany()).length, 1)
    assert.equal((await prisma.tuitionRecord.aggregate({ _sum: { finalAmount: true } }))._sum.finalAmount, 100)
    assert.equal((await prisma.tuitionRecord.groupBy({ by: ['billingMonth'], _count: true }))[0]._count, 1)
    // Điều kiện của route vẫn giữ nguyên, phạm vi cộng thêm
    assert.equal(await prisma.student.count({ where: { id: { in: [a.student.id, b.student.id] } } }), 1)
    // Transaction tương tác cũng bị lọc
    assert.equal(await prisma.$transaction(tx => tx.student.count()), 1)
  })
  assert.equal(await prisma.student.count(), 2, 'không có phạm vi (cron, webhook) thì không lọc')
})

test('ghi trong phạm vi cơ sở A không sửa, xoá, tạo được dữ liệu cơ sở B', async () => {
  const { A, B, a, b } = await twoBranches()
  await inA(A, async () => {
    await assert.rejects(prisma.student.update({ where: { id: b.student.id }, data: { fullName: 'Sửa' } }), err => err.code === 'P2025')
    assert.equal((await prisma.session.updateMany({ data: { notes: 'x' } })).count, 1)
    await assert.rejects(prisma.tuitionRecord.delete({ where: { id: b.tuition.id } }), err => err.code === 'P2025')
    await assert.rejects(prisma.student.create({ data: { id: newId(), fullName: 'Mới', enrollmentDate: day('2026-10-01'), branchId: B } }), err => err.status === 403)
    await assert.rejects(prisma.student.update({ where: { id: a.student.id }, data: { branchId: B } }), err => err.status === 403)
    await assert.rejects(prisma.session.create({ data: { id: newId(), classId: b.klass.id, sessionDate: day('2026-10-06'), startTime: '18:00', endTime: '19:30' } }), err => err.status === 404)
    await assert.rejects(prisma.payment.create({ data: { id: newId(), tuitionRecordId: b.tuition.id, studentId: a.student.id, amount: 1, paymentDate: day('2026-10-01'), method: 'CASH' } }), err => err.status === 404)
  })
  assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: b.student.id } })).fullName, 'Học viên')
  assert.equal(await prisma.session.count({ where: { notes: 'x' } }), 1)
  assert.equal(await prisma.tuitionRecord.count(), 2)
})

test('học viên chỉ ghi danh vào lớp cùng cơ sở, lớp của năm học đã đóng không nhận ghi danh', async () => {
  const { a, b } = await twoBranches()
  await assert.rejects(seed.enrollment({ classId: b.klass.id, studentId: a.student.id }), err => err.status === 400)
  await prisma.schoolYear.updateMany({ data: { status: 'CLOSED' } })
  const other = await seed.student({ branchId: a.student.branchId })
  await assert.rejects(seed.enrollment({ classId: a.klass.id, studentId: other.id }), err => err.status === 409)
})

/** Gọi authenticate rồi chạy fn trong phạm vi request; bị chặn thì trả về status */
function asUser(user, headers, fn) {
  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'change-this-secret')
  return new Promise((resolve, reject) => {
    const res = { status(code) { this.code = code; return this }, json() { resolve({ status: this.code }); return this } }
    authenticate({ headers: { authorization: `Bearer ${token}`, ...headers } }, res,
      err => err ? reject(err) : Promise.resolve().then(fn).then(result => resolve({ status: 200, result }), reject))
  })
}

test('mỗi tài khoản làm việc ở đúng một cơ sở; đổi cơ sở làm việc chỉ trong quyền', async () => {
  const { A, B, a, b } = await twoBranches()
  const staff = await seed.user({ role: 'STAFF', branches: { create: [{ branchId: A }, { branchId: B }] } })
  const admin = await seed.user({ role: 'ADMIN' })
  const ids = () => prisma.student.findMany({ select: { id: true } }).then(rows => rows.map(r => r.id))
  const putMe = routeHandler(auth, '/me', 'put')

  assert.deepEqual((await asUser(staff, {}, ids)).result, [a.student.id], 'chưa chọn: cơ sở được phân công đầu tiên')
  assert.deepEqual((await asUser(admin, {}, ids)).result, [a.student.id], 'ADMIN cũng chỉ làm việc ở một cơ sở')
  assert.deepEqual((await asUser(staff, { 'x-branch-id': B }, ids)).result, [a.student.id], 'header cũ không còn tác dụng')

  assert.equal((await putMe({ user: { userId: staff.id, role: 'STAFF' }, body: { defaultBranchId: B } })).status, 200)
  assert.deepEqual((await asUser(staff, {}, ids)).result, [b.student.id])
  const me = await asUser(staff, {}, () => routeHandler(auth, '/me', 'get')({ user: { userId: staff.id, role: 'STAFF' } }))
  assert.deepEqual([me.result.body.workingBranchId, me.result.body.allowedBranchIds], [B, [A, B]])

  const only = await seed.user({ role: 'STAFF', branches: { create: { branchId: A } } })
  assert.equal((await putMe({ user: { userId: only.id, role: 'STAFF' }, body: { defaultBranchId: B } })).status, 403)
  // Bị gỡ phân công cơ sở mặc định → về cơ sở được phép đầu tiên
  await prisma.userBranch.delete({ where: { userId_branchId: { userId: staff.id, branchId: B } } })
  require('../dist/middleware/auth').forgetAccount(staff.id)
  assert.deepEqual((await asUser(staff, {}, ids)).result, [a.student.id])
  const nobody = await seed.user({ role: 'STAFF' })
  assert.deepEqual((await asUser(nobody, {}, ids)).result, [], 'chưa được phân công cơ sở nào thì không thấy gì')
})

test('ngày nghỉ chỉ huỷ buổi của cơ sở áp dụng; sinh buổi học chỉ tránh ngày nghỉ của cơ sở mình', async () => {
  const { A, B, a, b } = await twoBranches()
  const user = { userId: (await seed.user()).id, role: 'ADMIN' }
  const post = routeHandler(holidays, '/', 'post')
  const created = await post({ user, body: { name: 'Nghỉ A', startDate: '2026-10-05', endDate: '2026-10-05', branchIds: [A] } })
  assert.equal(created.status, 201)
  assert.deepEqual(created.body.holiday.branches.map(x => x.id), [A])
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: a.session.id } })).status, 'CANCELLED')
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: b.session.id } })).status, 'SCHEDULED')

  // Nhân viên cơ sở A không tạo được ngày nghỉ cho cơ sở B
  const denied = await inA(A, () => post({ user: { ...user, role: 'STAFF' }, body: { name: 'Nghỉ B', startDate: '2026-10-12', branchIds: [B] } }))
  assert.equal(denied.status, 400)

  // 12/10/2026 là thứ Hai: lịch thứ Hai của lớp B vẫn sinh buổi dù cơ sở A nghỉ
  await post({ user, body: { name: 'Nghỉ A2', startDate: '2026-10-12', branchIds: [A] } })
  const scheduleOf = klass => prisma.schedule.create({ data: { id: newId(), classId: klass.id, dayOfWeek: 'MONDAY', startTime: '07:00', endTime: '08:00', effectiveFrom: day('2026-10-01') } })
  assert.equal(await generateSessionsFromSchedule((await scheduleOf(b.klass)).id, day('2026-10-12'), day('2026-10-12')), 1)
  assert.equal(await generateSessionsFromSchedule((await scheduleOf(a.klass)).id, day('2026-10-12'), day('2026-10-12')), 0)
})

test('cache đọc tách theo cơ sở: phiên bản của cơ sở A không dùng lại cho cơ sở B', async () => {
  const { A, B } = await twoBranches()
  const build = () => prisma.student.count()
  const first = await runInScope({ branchIds: [A], schoolYearId: null }, () => readView('studentsIndex', 'test', build))
  const other = await runInScope({ branchIds: [B], schoolYearId: null }, () => readView('studentsIndex', 'test', build, first.version))
  assert.equal(other.unchanged, undefined)
  assert.equal(other.data, 1)
  const same = await runInScope({ branchIds: [A], schoolYearId: null }, () => readView('studentsIndex', 'test', build, first.version))
  assert.equal(same.unchanged, true)
})

test('hoá đơn MISA nhận cơ sở của học viên và bị lọc theo cơ sở', async () => {
  const { saveInvoiceCopies } = require('../dist/services/misaInvoiceStore')
  const { A, B, b } = await twoBranches()
  await saveInvoiceCopies([b.tuition.id], { refId: 'r', status: 'DRAFT_CREATED', invoiceDate: '2026-10-05', recordIds: [b.tuition.id], billingPeriods: ['2026-10'], source: { studentId: b.student.id }, template: {}, buyer: {}, createdBy: 'test', createdAt: '2026-10-05T00:00:00Z' })
  assert.equal((await prisma.misaInvoice.findUniqueOrThrow({ where: { id: b.tuition.id } })).branchId, B)
  // Truy vấn Prisma chỉ chạy khi await: phải await bên trong phạm vi
  assert.equal(await inA(A, async () => await prisma.misaInvoice.count()), 0)
  assert.equal(await runInScope({ branchIds: [B], schoolYearId: null }, async () => await prisma.misaInvoice.count()), 1)
})

test('trong phạm vi cơ sở, tạo bản ghi cha rồi bản ghi con trong cùng transaction vẫn được', async () => {
  const { A, b } = await twoBranches()
  const studentId = newId()
  await inA(A, async () => {
    await prisma.$transaction(async tx => {
      await tx.student.create({ data: { id: studentId, fullName: 'Mới', enrollmentDate: day('2026-10-01'), branchId: A } })
      await tx.parent.create({ data: { id: newId(), studentId, fullName: 'Phụ huynh', isPrimaryContact: true } })
    })
    const other = newId()
    await prisma.$transaction([
      prisma.student.create({ data: { id: other, fullName: 'Mới 2', enrollmentDate: day('2026-10-01'), branchId: A } }),
      prisma.parent.create({ data: { id: newId(), studentId: other, fullName: 'Phụ huynh 2', isPrimaryContact: true } }),
    ])
    // Vẫn chặn tham chiếu tới bản ghi của cơ sở khác
    await assert.rejects(prisma.parent.create({ data: { id: newId(), studentId: b.student.id, fullName: 'X', isPrimaryContact: false } }), err => err.status === 404)
  })
  assert.equal(await prisma.parent.count({ where: { student: { branchId: A } } }), 2)
})
