const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed } = require('./helpers/pg.cjs')
const service = require('../dist/services/misaInvoicePreview')
const telegram = require('../dist/services/telegramService')
const { saveInvoiceCopies, readInvoice } = require('../dist/services/misaInvoiceStore')
const { retryFailedMisaInvoices, MAX_AUTO_RETRIES } = require('../dist/services/misaInvoiceRetry')

beforeEach(reset)
after(() => prisma.$disconnect())

const template = { id: 'template-1', name: 'Mẫu', series: '2C26MHP', templateNo: '2', isInvoiceSummary: false }
const BUSY = 'MISA trả lỗi HTTP 429 ở bước xác thực.'

/** Giả lập MISA: `create` quyết định kết quả tạo nháp; ghi lại input mỗi lần gửi. */
function fakeMisa(t, create = async input => ({ invoiceNumber: '', transactionId: input.refId })) {
  const old = { list: service.listInvoiceTemplates, create: service.createMisaDraft,
    created: telegram.notifyInvoiceCreated, failed: telegram.notifyInvoiceCreationFailed }
  const sent = []
  service.listInvoiceTemplates = async () => [template]
  service.createMisaDraft = async input => { sent.push(input); return create(input) }
  telegram.notifyInvoiceCreated = () => { throw new Error('cron không gửi tin từng hóa đơn') }
  telegram.notifyInvoiceCreationFailed = () => { throw new Error('cron không gửi tin từng hóa đơn') }
  t.after(() => Object.assign(service, { listInvoiceTemplates: old.list, createMisaDraft: old.create })
    && Object.assign(telegram, { notifyInvoiceCreated: old.created, notifyInvoiceCreationFailed: old.failed }))
  return sent
}

async function failedInvoice({ id = 'fee-1', message = BUSY, minutesAgo = 20, status = 'FAILED', buyer, finalAmount = 100000 } = {}) {
  const student = await seed.student({ fullName: 'Gia Bảo' })
  await seed.tuition({ id, studentId: student.id, classId: null, className: 'Toán', billingMonth: 11, billingYear: 2026,
    baseAmount: finalAmount, finalAmount, remainingAmount: 0, paidAmount: finalAmount, status: 'PAID' })
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString()
  const source = { recordId: id, studentId: student.id, studentName: 'Gia Bảo', className: 'Toán', month: 11, year: 2026,
    baseAmount: finalAmount, discountAmount: 0, finalAmount, paidAmount: finalAmount, paymentMethodName: 'TM/Chuyển khoản', fingerprint: 'x' }
  await saveInvoiceCopies([id], { id, recordIds: [id], refId: '', status, source, sources: [source], template: {},
    buyer: buyer ?? { fullName: 'Gia Bảo', legalName: '', address: '', email: '', phone: '' },
    invoiceDate: '2026-11-22', revision: 0, lastErrorMessage: message, createdAt: at, updatedAt: at, createdBy: 'admin-1', billingPeriods: ['2026-11'] })
}

const notifier = () => { const messages = []; return { messages, notify: async text => { messages.push(text); return { sent: true } } } }

test('hóa đơn lỗi 429 được tự tạo lại, giữ người mua đã chọn, gửi một tin tổng hợp', async t => {
  const sent = fakeMisa(t)
  await failedInvoice({ buyer: { fullName: 'Phụ huynh Gia Bảo', legalName: 'Công ty ABC', address: 'Hà Nội', email: '', phone: '' } })
  const { messages, notify } = notifier()

  const summary = await retryFailedMisaInvoices({ notify })
  assert.deepEqual(summary, { checked: 1, created: 1, failed: 0, exhausted: 0, unknown: 0, skipped: 0 })
  const stored = await readInvoice('fee-1')
  assert.equal(stored.status, 'DRAFT_CREATED')
  assert.equal(stored.autoRetryCount, 0)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].buyer.legalName, 'Công ty ABC')
  assert.equal(sent[0].template.id, 'template-1')
  assert.equal(messages.length, 1)
  assert.match(messages[0], /TỰ TẠO LẠI HÓA ĐƠN MISA[\s\S]*Đã tạo: 1/)
})

test('không đụng tới: lỗi dữ liệu, lỗi vừa xảy ra, "không rõ kết quả"', async t => {
  const sent = fakeMisa(t)
  await failedInvoice({ id: 'fee-data', message: 'Email người mua không hợp lệ.' })
  await failedInvoice({ id: 'fee-new', minutesAgo: 2 })
  await failedInvoice({ id: 'fee-unknown', status: 'OUTCOME_UNKNOWN', message: 'Không nhận được kết quả từ MISA. Kiểm tra danh sách hóa đơn trước khi thử lại.' })
  await failedInvoice({ id: 'fee-old', minutesAgo: 4 * 24 * 60 })
  const { messages, notify } = notifier()

  const summary = await retryFailedMisaInvoices({ notify })
  assert.equal(summary.checked, 0)
  assert.equal(sent.length, 0)
  assert.equal(messages.length, 0, 'không có việc thì không gửi Telegram')
})

test('MISA vẫn bận: đếm số lần, đủ 5 lần thì dừng và báo cần xử lý tay', async t => {
  const sent = fakeMisa(t, async () => { throw new service.InvoicePreviewError(503, service.MISA_BUSY_WRITE_MESSAGE) })
  await failedInvoice()
  const { messages, notify } = notifier()
  let clock = Date.now()

  for (let attempt = 1; attempt <= MAX_AUTO_RETRIES; attempt++) {
    clock += 20 * 60_000
    const summary = await retryFailedMisaInvoices({ notify, now: () => clock })
    const stored = await prisma.misaInvoice.findUnique({ where: { id: 'fee-1' } })
    assert.equal(stored.status, 'FAILED')
    assert.equal(stored.autoRetryCount, attempt)
    assert.equal(summary[attempt < MAX_AUTO_RETRIES ? 'failed' : 'exhausted'], 1)
    // Lần sau "cách 20 phút": đẩy updatedAt về quá khứ thay vì chờ thật.
    await prisma.misaInvoice.update({ where: { id: 'fee-1' }, data: { updatedAt: new Date(clock - 15 * 60_000) } })
  }
  assert.equal(sent.length, MAX_AUTO_RETRIES)
  assert.match(messages.at(-1), /Dừng tự thử lại — cần xử lý tay: 1/)

  clock += 20 * 60_000
  const after = await retryFailedMisaInvoices({ notify, now: () => clock })
  assert.equal(after.checked, 0, 'đã thử đủ 5 lần thì không thử nữa')
  assert.equal(sent.length, MAX_AUTO_RETRIES)
})

test('học phí đã thành 0 đồng: dừng ngay, không tạo hóa đơn', async t => {
  const sent = fakeMisa(t)
  await failedInvoice()
  await prisma.tuitionRecord.update({ where: { id: 'fee-1' }, data: { finalAmount: 0 } })
  const { notify } = notifier()

  const summary = await retryFailedMisaInvoices({ notify })
  assert.equal(summary.exhausted, 1)
  assert.equal(sent.length, 0)
  const stored = await prisma.misaInvoice.findUnique({ where: { id: 'fee-1' } })
  assert.equal(stored.autoRetryCount, MAX_AUTO_RETRIES)
})
