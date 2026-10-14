const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('tuition invoice validates templates once and reserves before sending to MISA', async () => {
  const service = require('../dist/services/misaInvoicePreview')
  const telegram = require('../dist/services/telegramService')
  const oldNotify = telegram.notifyInvoiceCreated
  const oldList = service.listInvoiceTemplates, oldCreate = service.createMisaDraft
  const originalLoad = Module._load
  const values = new Map([
    ['tuitionRecords/fee-1', { studentId: 's1', studentName: 'Student', className: 'Math',
      billingMonth: 7, billingYear: 2026, baseAmount: 100000, discountAmount: 0,
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
    const result = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
    assert.equal(result.invoice.status, 'DRAFT_CREATED')
    assert.deepEqual(events, ['templates', 'reserve', 'create', 'notify'])
    const again = await workflow.createTuitionMisaInvoice(['fee-1'], 'admin-1')
    assert.equal(again.alreadyExists, true)
    assert.deepEqual(events, ['templates', 'reserve', 'create', 'notify'])
  } finally {
    Module._load = originalLoad
    service.listInvoiceTemplates = oldList; service.createMisaDraft = oldCreate
    telegram.notifyInvoiceCreated = oldNotify
    if (oldModule) require.cache[modulePath] = oldModule; else delete require.cache[modulePath]
    keys.forEach((key, i) => env[i] === undefined ? delete process.env[key] : process.env[key] = env[i])
  }
})
