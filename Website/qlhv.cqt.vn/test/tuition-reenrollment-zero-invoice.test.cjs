const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed } = require('./helpers/pg.cjs')
const { calculateTuitionForStudent } = require('../dist/services/tuitionCalculator')
const service = require('../dist/services/misaInvoicePreview')
const workflow = require('../dist/services/misaAutoDraft')

before(reset)
after(() => prisma.$disconnect())

test('re-enrolled student is billed from the active enrollment, not an older dropped one', async () => {
  const student = await seed.student({ fullName: 'Học viên ghi danh lại' })
  const klass = await seed.klass({ name: 'Toán 6 - CQT01', tuitionRate: 150000 })
  // Ghi danh đã nghỉ có id nhỏ hơn — trước đây được chọn và làm phiếu ra 0 buổi.
  await seed.enrollment({ id: 'a-dropped', classId: klass.id, studentId: student.id, enrollmentDate: '2026-08-05', dropDate: '2026-08-05', status: 'DROPPED' })
  await seed.enrollment({ id: 'z-active', classId: klass.id, studentId: student.id, enrollmentDate: '2026-08-01', status: 'ACTIVE' })
  for (const [day, status] of [[3], [7], [10], [14], [17], [21], [24, 'CANCELLED'], [28]]) {
    await seed.session({ classId: klass.id, sessionDate: `2026-11-${String(day).padStart(2, '0')}`, ...(status ? { status } : {}) })
  }
  const { tuitionRecord } = await calculateTuitionForStudent(student.id, klass.id, 11, 2026)
  assert.equal(tuitionRecord.totalSessions, 7)
  assert.equal(tuitionRecord.baseAmount, 1050000)
  assert.equal(tuitionRecord.finalAmount, 1050000)
})

test('a gap between a dropped and a later enrollment stays unbilled', async () => {
  const student = await seed.student({ fullName: 'Học viên nghỉ giữa tháng' })
  const klass = await seed.klass({ name: 'Toán 7', tuitionRate: 100000 })
  await seed.enrollment({ classId: klass.id, studentId: student.id, enrollmentDate: '2026-08-01', dropDate: '2026-11-05', status: 'DROPPED' })
  await seed.enrollment({ classId: klass.id, studentId: student.id, enrollmentDate: '2026-11-15', status: 'ACTIVE', customTuitionRate: 120000 })
  for (const day of [3, 10, 17, 24]) await seed.session({ classId: klass.id, sessionDate: `2026-11-${String(day).padStart(2, "0")}` })
  const { tuitionRecord } = await calculateTuitionForStudent(student.id, klass.id, 11, 2026)
  assert.equal(tuitionRecord.totalSessions, 3)
  assert.equal(tuitionRecord.baseAmount, 100000 + 120000 + 120000)
})

test('a 0đ tuition record never creates a MISA invoice', async () => {
  const oldList = service.listInvoiceTemplates, oldCreate = service.createMisaDraft
  const calls = []
  service.listInvoiceTemplates = async () => [{ id: 'template-1', series: '2C26MHP', templateNo: '2' }]
  service.createMisaDraft = async () => { calls.push('create'); return { invoiceNumber: '', transactionId: 'x' } }
  const keys = ['MEINVOICE_DEFAULT_TEMPLATE_ID', 'MEINVOICE_DEFAULT_SERIES'], env = keys.map(k => process.env[k])
  keys.forEach(k => { delete process.env[k] })
  try {
    const student = await seed.student({ fullName: 'Học viên 0 đồng' })
    await seed.tuition({ id: 'zero-fee', studentId: student.id, classId: null, className: 'Toán', billingMonth: 11, billingYear: 2026,
      baseAmount: 0, discountAmount: 0, finalAmount: 0, remainingAmount: 0, paidAmount: 0, status: 'PAID' })
    const auto = await workflow.tryCreateAutomaticMisaDraft('zero-fee', 'admin-1')
    assert.equal(auto.status, 'SKIPPED_ZERO_AMOUNT')
    await assert.rejects(workflow.createTuitionMisaInvoice(['zero-fee'], 'admin-1', undefined, fetch, { notifications: false }),
      error => error.status === 409 && /0 đồng/.test(error.message))
    assert.deepEqual(calls, [])
    assert.equal(await prisma.misaInvoice.findUnique({ where: { id: 'zero-fee' } }), null)
  } finally {
    service.listInvoiceTemplates = oldList; service.createMisaDraft = oldCreate
    keys.forEach((k, i) => { if (env[i] === undefined) delete process.env[k]; else process.env[k] = env[i] })
  }
})
