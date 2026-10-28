const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed } = require('./helpers/pg.cjs')
const service = require('../dist/services/misaInvoicePreview')
const telegram = require('../dist/services/telegramService')
const workflow = require('../dist/services/misaAutoDraft')
const { readInvoice } = require('../dist/services/misaInvoiceStore')

before(reset)
after(() => prisma.$disconnect())

test('tuition invoice validates templates once and reserves before sending to MISA', async () => {
  const oldNotify = telegram.notifyInvoiceCreated, oldFailure = telegram.notifyInvoiceCreationFailed
  const oldList = service.listInvoiceTemplates, oldCreate = service.createMisaDraft, oldRead = service.readMisaInvoiceStatus
  const keys = ['MEINVOICE_DEFAULT_TEMPLATE_ID', 'MEINVOICE_DEFAULT_SERIES']
  const env = keys.map(key => process.env[key])
  keys.forEach(key => { delete process.env[key] })

  const student = await seed.student({ fullName: 'Student' })
  const values = { studentId: student.id, classId: null, className: 'Math', billingMonth: 10, billingYear: 2026,
    baseAmount: 100000, discountAmount: 0, finalAmount: 100000, remainingAmount: 0, paidAmount: 100000, status: 'PAID' }
  await seed.tuition({ id: 'fee-1', ...values })
  const setFee = data => prisma.tuitionRecord.update({ where: { id: 'fee-1' }, data })
  const restoreFee = () => setFee({ billingMonth: 10, billingYear: 2026, baseAmount: 100000, finalAmount: 100000 })
  const hasInvoice = async id => !!(await prisma.misaInvoice.findUnique({ where: { id } }))

  const failures = [], events = []
  telegram.notifyInvoiceCreationFailed = (failure, loadSources) => { failures.push({ failure, loadSources }) }
  telegram.notifyInvoiceCreated = invoice => { events.push('notify'); assert.equal(invoice.status, 'DRAFT_CREATED') }
  service.readMisaInvoiceStatus = async () => { throw new Error('Lookup unavailable') }
  const template = { id: 'template-1', series: '2C26MHP', templateNo: '2' }
  const listTemplates = async () => { events.push('templates'); return [template] }
  service.listInvoiceTemplates = listTemplates
  service.createMisaDraft = async input => {
    events.push('create')
    // RefID đã được giữ chỗ trong database trước khi gọi MISA.
    const reserved = await readInvoice('fee-1')
    assert.equal(reserved.status, 'CREATING')
    assert.equal(reserved.refId, input.refId)
    assert.equal(input.template.id, template.id)
    return { invoiceNumber: '', transactionId: input.refId }
  }

  try {
    await setFee({ finalAmount: 0, baseAmount: 0 })
    await assert.rejects(workflow.createTuitionMisaInvoice(['fee-1'], 'monthly-test', undefined, fetch,
      { notifications: false, positiveAmountOnly: true }), error => error.status === 409)
    assert.deepEqual(events, [])
    assert.equal(await hasInvoice('fee-1'), false)

    // Phiếu đổi thành 0đ sau bước kiểm tra đầu: bị chặn lại trong transaction giữ chỗ.
    await restoreFee()
    service.listInvoiceTemplates = async () => { await setFee({ finalAmount: 0, baseAmount: 0 }); return [template] }
    await assert.rejects(workflow.createTuitionMisaInvoice(['fee-1'], 'monthly-test', undefined, fetch,
      { notifications: false, positiveAmountOnly: true }), error => error.status === 409)
    assert.equal(await hasInvoice('fee-1'), false)
    assert.equal(failures.length, 0)

    service.listInvoiceTemplates = listTemplates
    for (const [billingMonth, billingYear] of [[9, 2026], [12, 2025]]) {
      await restoreFee(); await setFee({ billingMonth, billingYear })
      await assert.rejects(workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1'), error => error.status === 409 && /10\/2026/.test(error.message))
      const skipped = await workflow.tryCreateAutomaticMisaDraft('fee-1', 'admin-1')
      assert.equal(skipped.enabled, false)
      assert.equal(skipped.status, 'SKIPPED_BEFORE_INVOICE_START')
      assert.equal(await hasInvoice('fee-1'), false)
      assert.deepEqual(events, [])
      assert.equal(failures.length, 0)
    }

    await restoreFee()
    await seed.tuition({ id: 'fee-old', ...values, billingMonth: 9 })
    await assert.rejects(workflow.createTuitionMisaInvoice(['fee-1', 'fee-old'], 'admin-1'), error => error.status === 409)
    assert.deepEqual(events, [])
    assert.equal(await hasInvoice('fee-old'), false)

    // Recheck the period inside the transaction if the record changes after preflight.
    // (tháng 7: fee-old đã giữ tháng 9 của học viên này — unique học viên × tháng)
    service.listInvoiceTemplates = async () => { await setFee({ billingMonth: 7 }); return [template] }
    await assert.rejects(workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1'), error => error.status === 409)
    assert.equal(await hasInvoice('fee-1'), false)

    await restoreFee()
    service.listInvoiceTemplates = listTemplates
    const result = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
    assert.equal(result.invoice.status, 'DRAFT_CREATED')
    assert.deepEqual(events, ['templates', 'create', 'notify'])
    assert.equal((await readInvoice('fee-1')).status, 'DRAFT_CREATED')
    const again = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
    assert.equal(again.alreadyExists, true)
    assert.deepEqual(events, ['templates', 'create', 'notify'])

    // Historical links remain readable/idempotent; no new invoice is created.
    await setFee({ billingMonth: 7 })
    assert.equal((await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')).alreadyExists, true)
    await restoreFee()
    await prisma.misaInvoice.deleteMany()

    service.listInvoiceTemplates = async () => { throw new service.InvoicePreviewError(502, 'Không kết nối được MISA ở bước lấy mẫu hóa đơn.') }
    const failedLookup = await workflow.tryCreateAutomaticMisaDraft('fee-1', 'admin-1')
    assert.equal(failedLookup.status, 'FAILED')
    assert.equal(failures.length, 1)
    assert.match(failures[0].failure.reason, /lấy mẫu hóa đơn/)
    assert.equal((await failures[0].loadSources())[0].studentName, 'Student')

    service.listInvoiceTemplates = async () => [template]
    service.createMisaDraft = async () => { throw new service.InvoicePreviewError(502, 'MISA từ chối: sai thông tin người mua.') }
    const rejected = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
    assert.equal(rejected.invoice.status, 'FAILED')
    assert.equal(failures.length, 2)
    assert.match(failures[1].failure.reason, /sai thông tin người mua/)
    assert.equal(failures[1].failure.sources[0].month, 10)

    service.createMisaDraft = async () => { throw new service.InvoicePreviewError(502, 'MISA chưa trả kết quả; cần đối chiếu.', true) }
    const unknown = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
    assert.equal(unknown.invoice.status, 'OUTCOME_UNKNOWN')
    assert.equal(failures.length, 3)

    await prisma.misaInvoice.deleteMany()
    let writes = 0, reads = 0
    service.createMisaDraft = async () => { writes++; throw new service.InvoicePreviewError(502, 'Lost response', true) }
    service.readMisaInvoiceStatus = async refId => {
      reads++
      assert.equal(refId, (await readInvoice('fee-1')).refId)
      return { status: 'DRAFT_CREATED', transactionId: 'confirmed-transaction' }
    }
    const recovered = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
    assert.equal(recovered.invoice.status, 'DRAFT_CREATED')
    assert.equal(recovered.invoice.transactionId, 'confirmed-transaction')
    assert.equal(writes, 1)
    assert.equal(reads, 1)
    assert.equal(failures.length, 3)
    assert.equal(failures[2].failure.outcomeUnknown, true)
    assert.ok(failures[2].failure.refId)
    const existing = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
    assert.equal(existing.alreadyExists, true)
    assert.equal(failures.length, 3)

    // Hai yêu cầu đồng thời cho cùng phiếu: chỉ một lần gửi MISA.
    await prisma.misaInvoice.deleteMany()
    let sends = 0
    service.createMisaDraft = async input => { sends++; await new Promise(r => setTimeout(r, 50)); return { invoiceNumber: '', transactionId: input.refId } }
    const both = await Promise.all([1, 2].map(() => workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1', undefined, fetch, { notifications: false })))
    assert.equal(sends, 1)
    assert.equal(both.filter(r => r.alreadyExists).length, 1)
  } finally {
    service.listInvoiceTemplates = oldList; service.createMisaDraft = oldCreate; service.readMisaInvoiceStatus = oldRead
    telegram.notifyInvoiceCreated = oldNotify; telegram.notifyInvoiceCreationFailed = oldFailure
    keys.forEach((key, i) => env[i] === undefined ? delete process.env[key] : process.env[key] = env[i])
  }
})
