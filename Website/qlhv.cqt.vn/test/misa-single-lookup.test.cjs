const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('tuition invoice validates templates once and reserves before sending to MISA', async () => {
  const service = require('../dist/services/misaInvoicePreview')
  const telegram = require('../dist/services/telegramService')
  const oldNotify = telegram.notifyInvoiceCreated
  const oldFailure = telegram.notifyInvoiceCreationFailed
  const failures = []
  telegram.notifyInvoiceCreationFailed = (failure, loadSources) => { failures.push({ failure, loadSources }) }
  const oldList = service.listInvoiceTemplates, oldCreate = service.createMisaDraft
  const oldRead = service.readMisaInvoiceStatus
  service.readMisaInvoiceStatus = async () => { throw new Error('Lookup unavailable') }
  const originalLoad = Module._load
  const values = new Map([
    ['tuitionRecords/fee-1', { studentId: 's1', studentName: 'Student', className: 'Math',
      billingMonth: 10, billingYear: 2026, baseAmount: 100000, discountAmount: 0,
      finalAmount: 100000, status: 'PAID' }],
    ['students/s1', { fullName: 'Student' }],
  ])
  const events = []
  telegram.notifyInvoiceCreated = invoice => {
    events.push('notify')
    assert.equal(invoice.status, 'DRAFT_CREATED')
    assert.equal(values.get('misaInvoices/fee-1').status, 'DRAFT_CREATED')
  }
  const db = {
    collection(collection) {
      return {
        where() { return { get: async () => ({ docs: [] }) } },
        doc(id) {
          const path = `${collection}/${id}`
          return { path,
            get: async () => ({ id, exists: values.has(path), data: () => values.get(path) }),
            async set(value) { values.set(path, value) },
          }
        },
      }
    },
    async runTransaction(run) {
      return run({ get: ref => ref.get(), set(ref, value) { events.push('reserve'); values.set(ref.path, value) } })
    },
  }
  const template = { id: 'template-1', series: '2C26MHP', templateNo: '2' }
  service.listInvoiceTemplates = async () => { events.push('templates'); return [template] }
  service.createMisaDraft = async input => {
    events.push('create')
    assert.equal(values.get('misaInvoices/fee-1').status, 'CREATING')
    assert.equal(input.template.id, template.id)
    return { invoiceNumber: '', transactionId: input.refId }
  }
  Module._load = function(request, parent, isMain) {
    if (request === '../lib/firebase') return { db, C: { TUITION_RECORDS: 'tuitionRecords', PAYMENTS: 'payments', STUDENTS: 'students' },
      toObj: doc => ({ id: doc.id, ...doc.data() }), toDocs: snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../dist/services/misaAutoDraft')
  const oldModule = require.cache[modulePath]
  delete require.cache[modulePath]
  const keys = ['MEINVOICE_DEFAULT_TEMPLATE_ID', 'MEINVOICE_DEFAULT_SERIES']
  const env = keys.map(key => process.env[key])
  keys.forEach(key => { delete process.env[key] })
  try {
    const workflow = require(modulePath)
    const fee = values.get('tuitionRecords/fee-1')
    values.set('tuitionRecords/fee-1', { ...fee, finalAmount: 0, baseAmount: 0 })
    await assert.rejects(workflow.createTuitionMisaInvoice(['fee-1'], 'monthly-test', undefined, fetch,
      { notifications: false, positiveAmountOnly: true }), error => error.status === 409)
    assert.deepEqual(events, [])
    assert.equal(values.has('misaInvoices/fee-1'), false)
    values.set('tuitionRecords/fee-1', fee)
    service.listInvoiceTemplates = async () => {
      values.set('tuitionRecords/fee-1', { ...fee, finalAmount: 0, baseAmount: 0 })
      return [template]
    }
    await assert.rejects(workflow.createTuitionMisaInvoice(['fee-1'], 'monthly-test', undefined, fetch,
      { notifications: false, positiveAmountOnly: true }), error => error.status === 409)
    assert.equal(values.has('misaInvoices/fee-1'), false)
    assert.equal(failures.length, 0)
    values.set('tuitionRecords/fee-1', fee)
    service.listInvoiceTemplates = async () => { events.push('templates'); return [template] }
    for (const [billingMonth, billingYear] of [[9, 2026], [12, 2025]]) {
      values.set('tuitionRecords/fee-1', { ...fee, billingMonth, billingYear })
      await assert.rejects(workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1'), error => error.status === 409 && /10\/2026/.test(error.message))
      const skipped = await workflow.tryCreateAutomaticMisaDraft('fee-1', 'admin-1')
      assert.equal(skipped.enabled, false)
      assert.equal(skipped.status, 'SKIPPED_BEFORE_INVOICE_START')
      assert.equal(values.has('misaInvoices/fee-1'), false)
      assert.deepEqual(events, [])
      assert.equal(failures.length, 0)
    }
    values.set('tuitionRecords/fee-1', fee)
    values.set('tuitionRecords/fee-old', { ...fee, billingMonth: 9 })
    await assert.rejects(workflow.createTuitionMisaInvoice(['fee-1', 'fee-old'], 'admin-1'), error => error.status === 409)
    assert.deepEqual(events, [])
    assert.equal(values.has('misaInvoices/fee-old'), false)
    // Recheck the period inside the transaction if the record changes after preflight.
    service.listInvoiceTemplates = async () => {
      values.set('tuitionRecords/fee-1', { ...fee, billingMonth: 9 })
      return [template]
    }
    await assert.rejects(workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1'), error => error.status === 409)
    assert.equal(values.has('misaInvoices/fee-1'), false)
    values.set('tuitionRecords/fee-1', fee)
    service.listInvoiceTemplates = async () => { events.push('templates'); return [template] }
    const result = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
    assert.equal(result.invoice.status, 'DRAFT_CREATED')
    assert.deepEqual(events, ['templates', 'reserve', 'create', 'notify'])
    const again = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
    assert.equal(again.alreadyExists, true)
    assert.deepEqual(events, ['templates', 'reserve', 'create', 'notify'])
    // Historical links remain readable/idempotent; no new invoice is created.
    values.set('tuitionRecords/fee-1', { ...fee, billingMonth: 9 })
    assert.equal((await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')).alreadyExists, true)
    values.set('tuitionRecords/fee-1', fee)
    values.delete('misaInvoices/fee-1')
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
    values.delete('misaInvoices/fee-1')
    let writes = 0, reads = 0
    service.createMisaDraft = async () => { writes++; throw new service.InvoicePreviewError(502, 'Lost response', true) }
    service.readMisaInvoiceStatus = async refId => {
      reads++
      assert.equal(refId, values.get('misaInvoices/fee-1').refId)
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
  } finally {
    Module._load = originalLoad
    service.listInvoiceTemplates = oldList; service.createMisaDraft = oldCreate
    service.readMisaInvoiceStatus = oldRead
    telegram.notifyInvoiceCreated = oldNotify
    telegram.notifyInvoiceCreationFailed = oldFailure
    if (oldModule) require.cache[modulePath] = oldModule; else delete require.cache[modulePath]
    keys.forEach((key, i) => env[i] === undefined ? delete process.env[key] : process.env[key] = env[i])
  }
})
