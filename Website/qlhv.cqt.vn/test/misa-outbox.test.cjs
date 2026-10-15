const { test } = require('node:test')
const assert = require('node:assert/strict')
const service = require('../dist/services/misaInvoicePreview')
const gateway = require('../dist/services/misaDraftGateway')
const template = { id: 'template-1', series: '2C26MHP', templateNo: '2', name: 'Sales', isInvoiceSummary: false }
const record = { id: 'fee-1', studentId: 's1', studentName: 'Student', className: 'Math', billingMonth: 10, billingYear: 2026, baseAmount: 100, discountAmount: 10, finalAmount: 90, status: 'PENDING' }
const draft = () => ({ id: record.id, refId: 'fixed-ref', revision: 1, status: 'PENDING_MISA', template,
  buyer: { fullName: 'Parent', legalName: '', taxCode: '', address: '', email: '', phone: '' },
  source: service.invoiceSource(record, []), invoiceDate: '2026-10-13', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' })

test('gateway creates an unpublished MISA invoice with PublishStatus 0', async () => {
  const keys = ['MEINVOICE_CLIENT_ID', 'MEINVOICE_CLIENT_SECRET', 'MEINVOICE_TAXCODE', 'MEINVOICE_USERNAME', 'MEINVOICE_PASSWORD']
  const old = keys.map(k => process.env[k]); keys.forEach(k => process.env[k] = 'test-secret')
  const response = value => ({ ok: true, json: async () => value })
  const calls = []
  const request = async (url, init) => {
    calls.push({ url, init })
    if (url.includes('/invoice/token')) return response({ Success: true, Data: 'developer-token' })
    if (url.includes('/templates?')) return response({ Success: true, Data: [{ IPTemplateID: template.id, InvSeries: template.series, InvTemplateNo: '2', Inactive: false }] })
    if (url.endsWith('/oauth')) return response({ access_token: 'legacy-token', OrganizationUnitID: 'org', CompanyID: '123', UserID: 'user-1', DatabaseID: 'db' })
    if (url.endsWith('/v3sainvoice/Code')) return response({ Data: JSON.stringify({ 'fixed-ref': { IsValid: true, RefID: 'fixed-ref', InvNo: '' } }) })
    throw new Error('Unexpected endpoint')
  }
  try {
    const result = await gateway.prepareUnsignedInvoice(draft(), request)
    assert.equal(result.transactionId, 'fixed-ref')
    assert.equal(calls.length, 4)
    const body = JSON.parse(calls[3].init.body)
    assert.equal(body[0].PublishStatus, 0)
    assert.equal(body[0].InvoiceType, 10)
    assert.equal(body[0].RefID, 'fixed-ref')
    assert.equal(body[0].InvoiceDetails[0].Amount, 100)
    assert.equal(body[0].InvoiceDetails[0].AmountWithoutVAT, 90)
    assert.equal(calls[3].init.headers.Authorization, 'Bearer legacy-token')
    assert.equal(calls[3].init.headers.OrganizationUnitID, 'org')
    assert.equal(calls[3].init.headers.DatabaseID, 'db')
  } finally { keys.forEach((k, i) => old[i] === undefined ? delete process.env[k] : process.env[k] = old[i]) }
})

test('gateway rejects provider errors without marking the outcome unknown', async () => {
  const keys = ['MEINVOICE_CLIENT_ID', 'MEINVOICE_CLIENT_SECRET', 'MEINVOICE_TAXCODE', 'MEINVOICE_USERNAME', 'MEINVOICE_PASSWORD']
  const old = keys.map(k => process.env[k]); keys.forEach(k => process.env[k] = 'test-secret')
  const response = value => ({ ok: true, json: async () => value })
  const request = async url => {
    if (url.includes('/invoice/token')) return response({ Success: true, Data: 'developer-token' })
    if (url.includes('/templates?')) return response({ Success: true, Data: [{ IPTemplateID: template.id, InvSeries: template.series, InvTemplateNo: '2', Inactive: false }] })
    if (url.endsWith('/oauth')) return response({ access_token: 'legacy-token', OrganizationUnitID: 'org', CompanyID: '123', UserID: 'user-1', DatabaseID: 'db' })
    return response({ Data: JSON.stringify({ 'fixed-ref': { IsValid: false, RefID: 'fixed-ref', ValidateResult: [{ ErrorCode: 'INVALID_INVOICE', ErrorMessage: 'Mẫu không hợp lệ' }] } }) })
  }
  try { await assert.rejects(gateway.prepareUnsignedInvoice(draft(), request), e => e.code === 'PROVIDER_REJECTED' && e.ambiguous === false && /Mẫu không hợp lệ/.test(e.message))
  } finally { keys.forEach((k, i) => old[i] === undefined ? delete process.env[k] : process.env[k] = old[i]) }
})

function fixture() {
  const docs = new Map([['tuitionRecords/fee-1', record], ['invoiceDrafts/fee-1', draft()]])
  const snap = path => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path) })
  const collection = name => ({
    doc: id => ({ path: `${name}/${id}`, get: async () => snap(`${name}/${id}`) }),
    where: () => ({ get: async () => ({ docs: [] }) }),
  })
  let transactions = 0; let failFinal = false
  const db = { collection, runTransaction: async callback => {
    transactions++
    if (failFinal && transactions === 2) throw new Error('persistence failed')
    const writes = []
    const result = await callback({ get: ref => ref.get(), update: (ref, patch) => writes.push([ref.path, patch]) })
    writes.forEach(([path, patch]) => docs.set(path, { ...docs.get(path), ...patch }))
    return result
  } }
  const firebasePath = require.resolve('../dist/lib/firebase')
  const outboxPath = require.resolve('../dist/services/invoiceOutbox')
  const previous = [require.cache[firebasePath], require.cache[outboxPath]]
  require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: { db,
    C: { TUITION_RECORDS: 'tuitionRecords', PAYMENTS: 'payments' }, toObj: doc => doc.data(), toDocs: snap => snap.docs.map(doc => doc.data()) } }
  delete require.cache[outboxPath]
  const outbox = require(outboxPath)
  docs.set('invoiceOutbox/fee-1', outbox.makeInvoiceOutbox(draft()))
  const oldFlag = process.env.MEINVOICE_AUTO_PREPARE_XML; process.env.MEINVOICE_AUTO_PREPARE_XML = 'true'
  return { docs, outbox, failFinal: () => { failFinal = true }, restore: () => {
    oldFlag === undefined ? delete process.env.MEINVOICE_AUTO_PREPARE_XML : process.env.MEINVOICE_AUTO_PREPARE_XML = oldFlag
    ;[firebasePath, outboxPath].forEach((path, i) => previous[i] ? require.cache[path] = previous[i] : delete require.cache[path])
  } }
}

test('outbox claims before sending, blocks concurrent request and sends a fixed revision once', async () => {
  const f = fixture(); let calls = 0
  try {
    const provider = async data => {
      calls++; assert.equal(data.refId, 'fixed-ref')
      assert.equal(f.docs.get('invoiceDrafts/fee-1').status, 'CREATING_MISA')
      await assert.rejects(f.outbox.processInvoiceOutbox('fee-1', provider), e => e.status === 409)
      return { transactionId: 'txn', invoiceNo: '' }
    }
    assert.equal((await f.outbox.processInvoiceOutbox('fee-1', provider, 1)).status, 'MISA_DRAFT_CREATED')
    assert.equal(f.docs.get('invoiceOutbox/fee-1').status, 'DONE')
    assert.equal(f.docs.get('invoiceDrafts/fee-1').providerInvoiceId, 'txn')
    await f.outbox.processInvoiceOutbox('fee-1', provider, 1)
    assert.equal(calls, 1)
    await assert.rejects(f.outbox.processInvoiceOutbox('fee-1', provider, 2), e => e.status === 409)
  } finally { f.restore() }
})

test('ambiguous responses and expired leases never resend; stale fee is reviewable', async () => {
  for (const mode of ['timeout', 'crash', 'persistence', 'changed']) {
    const f = fixture(); let calls = 0
    const provider = async () => { calls++; if (mode === 'timeout') throw new gateway.MisaPreparationError('UNKNOWN', true, 'Unknown'); return { transactionId: 'txn', invoiceNo: '' } }
    try {
      if (mode === 'crash') f.docs.set('invoiceOutbox/fee-1', { ...f.docs.get('invoiceOutbox/fee-1'), status: 'PROCESSING', leaseUntil: '2000-01-01' })
      if (mode === 'changed') f.docs.set('tuitionRecords/fee-1', { ...record, studentName: 'Changed' })
      if (mode === 'persistence') {
        f.failFinal(); await assert.rejects(f.outbox.processInvoiceOutbox('fee-1', provider), /persistence/)
        f.docs.get('invoiceOutbox/fee-1').leaseUntil = '2000-01-01'
      }
      const result = await f.outbox.processInvoiceOutbox('fee-1', provider)
      assert.equal(result.status, mode === 'changed' ? 'NEEDS_REVIEW' : 'OUTCOME_UNKNOWN')
      await assert.rejects(f.outbox.processInvoiceOutbox('fee-1', provider), e => e.status === 409)
      assert.equal(calls, ['timeout', 'persistence'].includes(mode) ? 1 : 0)
    } finally { f.restore() }
  }
})

test('pre-send connection failure retries with backoff; automation defaults off', async () => {
  const f = fixture(); let calls = 0
  try {
    const provider = async () => { calls++; throw new service.InvoicePreviewError(502, 'Authentication unavailable') }
    assert.equal((await f.outbox.processInvoiceOutbox('fee-1', provider)).status, 'SYNC_FAILED')
    assert.equal(f.docs.get('invoiceOutbox/fee-1').status, 'RETRY')
    await assert.rejects(f.outbox.processInvoiceOutbox('fee-1', provider), e => e.status === 409)
    assert.equal(calls, 1)
    delete process.env.MEINVOICE_AUTO_PREPARE_XML
    await assert.rejects(f.outbox.processInvoiceOutbox('fee-1', provider), e => e.status === 503)
  } finally { f.restore() }
})

test('cron denies missing or incorrect secret and allows exact bearer', async () => {
  const f = fixture()
  const cronPath = require.resolve('../dist/routes/misaInvoiceCron'); delete require.cache[cronPath]
  const oldSecret = process.env.CRON_SECRET
  const oldProcess = f.outbox.processPendingInvoices
  let calls = 0; f.outbox.processPendingInvoices = async () => { calls++; return { enabled: true, processed: 1 } }
  const router = require(cronPath).default
  const invoke = authorization => new Promise((resolve, reject) => router.handle({ method: 'GET', url: '/cron/process-invoices', headers: { authorization } }, {
    statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this }, json(data) { resolve({ status: this.statusCode, data }) },
  }, reject))
  try {
    delete process.env.CRON_SECRET
    assert.equal((await invoke('Bearer undefined')).status, 401)
    process.env.CRON_SECRET = 'fixture-secret'
    assert.equal((await invoke('Bearer wrong')).status, 401)
    assert.equal((await invoke('Bearer fixture-secret')).status, 200)
    assert.equal(calls, 1)
  } finally {
    oldSecret === undefined ? delete process.env.CRON_SECRET : process.env.CRON_SECRET = oldSecret
    f.outbox.processPendingInvoices = oldProcess; delete require.cache[cronPath]; f.restore()
  }
})

test('tuition automation refreshes payment source, preserves buyer, calls MISA after commit and protects prepared invoices', async () => {
  const f = fixture()
  const draftServicePath = require.resolve('../dist/services/invoiceDraftService')
  const workflowPath = require.resolve('../dist/services/tuitionInvoiceWorkflow')
  const oldService = require.cache[draftServicePath]
  require.cache[draftServicePath] = { id: draftServicePath, filename: draftServicePath, loaded: true,
    exports: { ensureInvoiceDraftForTuitionRecord: async () => {} } }
  // Provide transaction set semantics for workflow writes.
  const firebase = require('../dist/lib/firebase')
  const previousTransaction = firebase.db.runTransaction
  firebase.db.runTransaction = callback => previousTransaction(tx => callback({ ...tx,
    set: (ref, data) => tx.update(ref, data) }))
  const originalProcess = f.outbox.processInvoiceOutbox
  let calls = 0
  f.outbox.processInvoiceOutbox = async id => {
    calls++
    const saved = f.docs.get(`invoiceDrafts/${id}`)
    assert.equal(saved.source.studentName, 'Updated student')
    assert.equal(saved.buyer.fullName, 'Parent edited')
    assert.equal(f.docs.get(`invoiceOutbox/${id}`).revision, saved.revision)
    f.docs.set(`invoiceDrafts/${id}`, { ...saved, status: 'MISA_DRAFT_CREATED', providerInvoiceId: 'txn' })
  }
  delete require.cache[workflowPath]
  try {
    f.docs.get('invoiceDrafts/fee-1').buyer.fullName = 'Parent edited'
    f.docs.set('tuitionRecords/fee-1', { ...record, studentName: 'Updated student' })
    const workflow = require(workflowPath)
    const result = await workflow.runTuitionInvoiceWorkflow('fee-1')
    assert.equal(result.status, 'MISA_DRAFT_CREATED')
    assert.equal(result.transactionId, 'txn')
    assert.equal(calls, 1)
    const saved = f.docs.get('invoiceDrafts/fee-1')
    f.docs.set('tuitionRecords/fee-1', { ...record, studentName: 'Changed after preparation' })
    // Real outbox returns the existing result; it must not generate another invoice.
    f.outbox.processInvoiceOutbox = originalProcess
    await workflow.runTuitionInvoiceWorkflow('fee-1')
    assert.deepEqual(f.docs.get('invoiceDrafts/fee-1'), saved)
    delete process.env.MEINVOICE_AUTO_PREPARE_XML
    assert.equal((await workflow.runTuitionInvoiceWorkflow('fee-1')).enabled, false)
  } finally {
    f.outbox.processInvoiceOutbox = originalProcess
    firebase.db.runTransaction = previousTransaction
    if (oldService) require.cache[draftServicePath] = oldService; else delete require.cache[draftServicePath]
    delete require.cache[workflowPath]; f.restore()
  }
})


test('real Firestore wrapper generates fee IDs without network and preserves explicit ID validation', async () => {
  const { Firestore } = require('firebase-admin/firestore')
  const { createMirroredFirestore } = require('../dist/lib/firestoreMirror')
  const raw = new Firestore({ projectId: 'local-regression-test' })
  const db = createMirroredFirestore(raw)
  try {
    const first = db.collection('tuitionRecords').doc()
    const second = db.collection('tuitionRecords').doc()
    assert.match(first.id, /^[A-Za-z0-9]{20}$/)
    assert.notEqual(first.id, second.id)
    assert.equal(first.path, `tuitionRecords/${first.id}`)
    assert.equal(db.collection('tuitionRecords').doc('fee-1').id, 'fee-1')
    assert.equal(first.collection('children').doc().id.length, 20)
    assert.throws(() => db.collection('tuitionRecords').doc(undefined), /documentPath/)
    assert.throws(() => db.collection('tuitionRecords').doc(''), /documentPath/)
    // Construct the real atomic write, without committing or contacting Firestore.
    const batch = db.batch()
    batch.set(first, { billingMonth: 7, billingYear: 2026, finalAmount: 1200000 })
    batch.set(db.collection('invoiceDrafts').doc(first.id), { refId: 'fixed-ref', source: { recordId: first.id } })
    batch.set(db.collection('invoiceOutbox').doc(first.id), { idempotencyKey: 'fixed-ref', status: 'PENDING' })
  } finally { await raw.terminate() }
})
