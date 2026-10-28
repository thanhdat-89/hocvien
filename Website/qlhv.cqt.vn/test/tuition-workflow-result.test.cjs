const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed } = require('./helpers/pg.cjs')
const { getTuitionWorkflowResult } = require('../dist/services/tuitionWorkflowResult')
const { saveInvoiceCopies } = require('../dist/services/misaInvoiceStore')

before(reset)
after(() => prisma.$disconnect())

test('lost-response reconciliation reads canonical fee, payments and invoice without writes', async () => {
  const student = await seed.student()
  const cls = await seed.klass()
  const fee = await seed.tuition({ studentId: student.id, classId: cls.id, billingMonth: 7, billingYear: 2026, finalAmount: 100000, status: 'PENDING' })
  await seed.payment({ tuitionRecordId: fee.id, studentId: student.id, amount: 100000 })
  await saveInvoiceCopies([fee.id], { refId: 'ref1', status: 'DRAFT_CREATED', invoiceDate: '2026-07-31', recordIds: [fee.id],
    source: {}, template: {}, buyer: {}, createdBy: 'test', createdAt: new Date().toISOString() })
  const tables = async () => JSON.stringify([await prisma.tuitionRecord.findMany(), await prisma.payment.findMany(), await prisma.misaInvoice.findMany()])
  const snapshot = await tables()

  const input = { studentId: student.id, classId: cls.id, month: 7, year: 2026 }
  let result = await getTuitionWorkflowResult(input)
  assert.equal(result.paid, true)
  assert.equal(result.finalStatus.totalPaid, 100000)
  assert.equal(result.invoiceDraft.status, 'DRAFT_CREATED')
  assert.equal(result.invoiceDraft.refId, 'ref1')
  assert.equal(await tables(), snapshot, 'Chỉ đọc, không ghi gì')

  await prisma.misaInvoice.deleteMany()
  result = await getTuitionWorkflowResult(input)
  assert.equal(result.invoiceDraft.status, 'SKIPPED_BEFORE_INVOICE_START')
  assert.equal(result.invoiceDraft.enabled, false)

  await prisma.tuitionRecord.update({ where: { id: fee.id }, data: { billingMonth: 10 } })
  result = await getTuitionWorkflowResult({ ...input, month: 10 })
  assert.equal(result.invoiceDraft.status, 'OUTCOME_UNKNOWN', 'eligible fees without metadata still need reconciliation')
  await prisma.tuitionRecord.update({ where: { id: fee.id }, data: { billingMonth: 7 } })

  await assert.rejects(getTuitionWorkflowResult({ ...input, month: 10, recordId: fee.id }), e => e.status === 409)

  // Firestore cần kiểm tra "nhiều phiếu trùng" khi đọc; PostgreSQL chặn ngay khi ghi bằng unique index.
  await assert.rejects(seed.tuition({ studentId: student.id, classId: cls.id, billingMonth: 7, billingYear: 2026 }), e => e.code === 'P2002')

  await prisma.payment.deleteMany()
  await prisma.tuitionRecord.deleteMany()
  assert.equal(await getTuitionWorkflowResult(input), null)
})

test('private tuition uses classId "private" in the API and NULL in the database', async () => {
  await reset()
  const student = await seed.student()
  const fee = await seed.tuition({ studentId: student.id, classId: null, billingMonth: 10, billingYear: 2026, finalAmount: 0, status: 'PAID' })
  const result = await getTuitionWorkflowResult({ studentId: student.id, classId: 'private', month: 10, year: 2026 })
  assert.equal(result.recordId, fee.id)
  await assert.rejects(seed.tuition({ studentId: student.id, classId: null, billingMonth: 10, billingYear: 2026 }), e => e.code === 'P2002',
    'Một phiếu học riêng mỗi học viên mỗi tháng')
})
