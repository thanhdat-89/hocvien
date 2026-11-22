const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const { prisma, reset, seed, routeHandler } = require('./helpers/pg.cjs')
const router = require('../dist/routes/sessions').default

beforeEach(reset)

const auth = { user: { role: 'ADMIN', userId: 'admin' } }
const preview = (id, action) => routeHandler(router, '/:id/cancel-preview', 'get')({ ...auth, params: { id }, query: { action } })
const cancel = id => routeHandler(router, '/:id/cancel', 'put')({ ...auth, params: { id }, body: { cancelReason: 'Giáo viên ốm' } })
const restore = id => routeHandler(router, '/:id/restore', 'put')({ ...auth, params: { id }, body: {} })

// Lớp 150.000đ/buổi, 2 buổi tháng 11; A học giá lớp, B có giá riêng 100.000đ; C nghỉ trước buổi 16/11
async function setup() {
  const cls = await seed.klass({ name: 'Toán 9', status: 'ACTIVE', tuitionRate: 150000 })
  const [a, b, c] = [await seed.student({ fullName: 'A' }), await seed.student({ fullName: 'B' }), await seed.student({ fullName: 'C' })]
  await seed.enrollment({ classId: cls.id, studentId: a.id, status: 'ACTIVE' })
  await seed.enrollment({ classId: cls.id, studentId: b.id, status: 'ACTIVE', customTuitionRate: 100000 })
  await seed.enrollment({ classId: cls.id, studentId: c.id, status: 'DROPPED', dropDate: '2026-11-10' })
  const s1 = await seed.session({ classId: cls.id, sessionDate: '2026-11-16', status: 'SCHEDULED' })
  await seed.session({ classId: cls.id, sessionDate: '2026-11-23', startTime: '18:00', status: 'SCHEDULED' })
  return { cls, a, b, c, s1 }
}
const record = (cls, student, data = {}) => seed.tuition({ studentId: student.id, classId: cls.id, billingMonth: 11, billingYear: 2026, finalAmount: 300000, status: 'PENDING', ...data })

test('xem trước: đếm học viên có buổi này và tổng tiền theo giá của từng người', async () => {
  const { s1 } = await setup()
  const res = await preview(s1.id, 'cancel')
  assert.equal(res.body.studentCount, 2)
  assert.equal(res.body.amount, 250000)
  assert.equal(res.body.lockedRecords, 0)
})

test('huỷ rồi khôi phục: phiếu chưa thu được tính lại theo số buổi', async () => {
  const { cls, a, s1 } = await setup()
  const rec = await record(cls, a)
  await cancel(s1.id)
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: s1.id } })).status, 'CANCELLED')
  assert.equal((await prisma.tuitionRecord.findUniqueOrThrow({ where: { id: rec.id } })).finalAmount, 150000)

  await restore(s1.id)
  const after = await prisma.session.findUniqueOrThrow({ where: { id: s1.id } })
  assert.deepEqual([after.status, after.cancelReason], ['SCHEDULED', null])
  assert.equal((await prisma.tuitionRecord.findUniqueOrThrow({ where: { id: rec.id } })).finalAmount, 300000)
})

test('tháng đã có phiếu thu tiền hoặc hoá đơn thì chặn huỷ và khôi phục', async () => {
  const { cls, a, b, s1 } = await setup()
  await record(cls, a, { status: 'PAID', paidAmount: 300000 })
  assert.equal((await preview(s1.id, 'cancel')).body.lockedRecords, 1)
  await assert.rejects(cancel(s1.id), err => err.status === 409)
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: s1.id } })).status, 'SCHEDULED')

  await prisma.tuitionRecord.deleteMany()
  const recB = await record(cls, b)
  const at = new Date()
  await prisma.misaInvoice.create({ data: { id: 'inv-1', refId: 'r', status: 'DRAFT_CREATED', invoiceDate: at, recordIds: [recB.id], billingPeriods: ['2026-11'],
    source: {}, template: {}, buyer: {}, createdBy: 'admin', createdAt: at, updatedAt: at } })
  await assert.rejects(cancel(s1.id), err => err.status === 409)

  await prisma.misaInvoice.deleteMany()
  await cancel(s1.id)
  await prisma.misaInvoice.create({ data: { id: 'inv-2', refId: 'r', status: 'DRAFT_CREATED', invoiceDate: at, recordIds: [recB.id], billingPeriods: ['2026-11'],
    source: {}, template: {}, buyer: {}, createdBy: 'admin', createdAt: at, updatedAt: at } })
  await assert.rejects(restore(s1.id), err => err.status === 409)
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: s1.id } })).status, 'CANCELLED')
})

test('không huỷ lại buổi đã huỷ, không khôi phục buổi chưa huỷ', async () => {
  const { s1 } = await setup()
  await assert.rejects(restore(s1.id), err => err.status === 409)
  await cancel(s1.id)
  await assert.rejects(cancel(s1.id), err => err.status === 409)
})
