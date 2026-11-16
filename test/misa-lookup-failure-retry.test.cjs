const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed } = require('./helpers/pg.cjs')
const service = require('../dist/services/misaInvoicePreview')
const telegram = require('../dist/services/telegramService')
const workflow = require('../dist/services/misaAutoDraft')
const { readInvoice } = require('../dist/services/misaInvoiceStore')

beforeEach(reset)
after(() => prisma.$disconnect())

const template = { id: 'template-1', series: '2C26MHP', templateNo: '2' }
const lookupError = () => new service.InvoicePreviewError(502, 'MISA trả lỗi HTTP 400 ở bước lấy mẫu hóa đơn.')
const waitFor = async check => { for (let i = 0; i < 50 && !(await check()); i++) await new Promise(r => setTimeout(r, 20)) }

/** Giả lập MISA: `templates` quyết định bước lấy mẫu, mỗi lần tạo nháp được ghi vào `creates`. */
function fakeMisa(t, templates) {
  const old = { list: service.listInvoiceTemplates, create: service.createMisaDraft, read: service.readMisaInvoiceStatus,
    created: telegram.notifyInvoiceCreated, failed: telegram.notifyInvoiceCreationFailed, id: process.env.MEINVOICE_DEFAULT_TEMPLATE_ID }
  const creates = []
  delete process.env.MEINVOICE_DEFAULT_TEMPLATE_ID
  service.listInvoiceTemplates = async () => templates()
  service.createMisaDraft = async input => { creates.push(input.refId); return { invoiceNumber: '', transactionId: input.refId } }
  service.readMisaInvoiceStatus = async () => { throw new Error('không dùng') }
  telegram.notifyInvoiceCreated = () => {}
  telegram.notifyInvoiceCreationFailed = () => {}
  t.after(() => {
    Object.assign(service, { listInvoiceTemplates: old.list, createMisaDraft: old.create, readMisaInvoiceStatus: old.read })
    Object.assign(telegram, { notifyInvoiceCreated: old.created, notifyInvoiceCreationFailed: old.failed })
    if (old.id === undefined) delete process.env.MEINVOICE_DEFAULT_TEMPLATE_ID; else process.env.MEINVOICE_DEFAULT_TEMPLATE_ID = old.id
  })
  return creates
}

async function seedFee() {
  const student = await seed.student({ fullName: 'Gia Bảo' })
  return seed.tuition({ id: 'fee-1', studentId: student.id, classId: null, className: 'Toán', billingMonth: 11, billingYear: 2026,
    baseAmount: 100000, discountAmount: 0, finalAmount: 100000, remainingAmount: 0, paidAmount: 100000, status: 'PAID' })
}

test('lỗi ở bước lấy mẫu vẫn lưu hoá đơn FAILED không RefID; tạo lại được và đóng cảnh báo', async t => {
  let lookupFails = true
  const creates = fakeMisa(t, async () => { if (lookupFails) throw lookupError(); return [template] })
  await seedFee()

  const failed = await workflow.tryCreateAutomaticMisaDraft('fee-1', 'admin-1')
  assert.equal(failed.status, 'FAILED')
  assert.match(failed.message, /HTTP 400/)
  const stored = await readInvoice('fee-1')
  assert.deepEqual([stored.status, stored.refId, stored.billingPeriods], ['FAILED', '', ['2026-11']])
  assert.equal(creates.length, 0, 'chưa gửi gì lên MISA')
  await waitFor(async () => (await prisma.adminAlert.count()) > 0)
  const [alert] = await prisma.adminAlert.findMany()
  assert.deepEqual([alert.read, alert.data.recordIds, alert.data.billingMonth, alert.data.billingYear], [false, ['fee-1'], 11, 2026])

  lookupFails = false
  const retried = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
  assert.equal(retried.invoice.status, 'DRAFT_CREATED')
  assert.equal(creates.length, 1)
  assert.notEqual(retried.invoice.refId, '')
  await waitFor(async () => (await prisma.adminAlert.findFirst()).read)
  assert.equal((await prisma.adminAlert.findFirst()).read, true, 'cảnh báo được đánh dấu đã xử lý')
})

test('lỗi lấy mẫu không đè hoá đơn đang chờ đối chiếu', async t => {
  const creates = fakeMisa(t, async () => { throw lookupError() })
  await seedFee()
  const at = new Date().toISOString()
  await prisma.misaInvoice.create({ data: { id: 'fee-1', refId: 'ref-unknown', status: 'OUTCOME_UNKNOWN', invoiceDate: new Date('2026-11-03'),
    recordIds: ['fee-1'], billingPeriods: ['2026-11'], source: {}, template: {}, buyer: {}, createdBy: 'admin-1', createdAt: at, updatedAt: at } })
  const result = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
  assert.equal(result.alreadyExists, true)
  assert.deepEqual([(await readInvoice('fee-1')).status, (await readInvoice('fee-1')).refId], ['OUTCOME_UNKNOWN', 'ref-unknown'])
  assert.equal(creates.length, 0)
})

test('phiếu đã có: chỉ tạo lại hoá đơn khi chưa có hoặc lần trước thất bại', async t => {
  let lookupFails = true
  const creates = fakeMisa(t, async () => { if (lookupFails) throw lookupError(); return [template] })
  await seedFee()

  // Chưa có hoá đơn nào (ví dụ lỗi trước bản sửa này) → thử tạo, lại lỗi → FAILED
  assert.equal((await workflow.retryMisaDraftForExistingRecord('fee-1', 'admin-1')).status, 'FAILED')
  lookupFails = false
  assert.equal((await workflow.retryMisaDraftForExistingRecord('fee-1', 'admin-1')).status, 'DRAFT_CREATED')
  // Đã có hoá đơn → bỏ qua, không gọi MISA lần nữa
  assert.equal((await workflow.retryMisaDraftForExistingRecord('fee-1', 'admin-1')).status, 'SKIPPED_EXISTING_RECORD')
  assert.equal(creates.length, 1)

  await prisma.misaInvoice.update({ where: { id: 'fee-1' }, data: { status: 'OUTCOME_UNKNOWN' } })
  assert.equal((await workflow.retryMisaDraftForExistingRecord('fee-1', 'admin-1')).status, 'SKIPPED_EXISTING_RECORD')
  assert.equal(creates.length, 1)
})
