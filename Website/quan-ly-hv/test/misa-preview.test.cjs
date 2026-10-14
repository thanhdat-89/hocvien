const { test } = require('node:test')
const assert = require('node:assert/strict')
const service = require('../dist/services/misaInvoicePreview')

const record = { id: 'fee-1', studentId: 'student-1', studentName: 'Học viên thử nghiệm', className: 'Toán 6',
  billingMonth: 10, billingYear: 2026, baseAmount: 1500000, discountAmount: 150000,
  finalAmount: 1350000, status: 'PAID' }
const payment = { id: 'pay-1', tuitionRecordId: 'fee-1', amount: 1350000, method: 'BANK_TRANSFER' }
const template = { id: 'template-1', name: 'Hóa đơn bán hàng', series: '2C26MHP', templateNo: '2', isInvoiceSummary: false }
const buyer = { fullName: 'Người mua thử nghiệm', legalName: '', taxCode: '', address: '', email: '', phone: '' }
const draft = () => ({ id: 'fee-1', refId: 'a1111111-1111-4111-8111-111111111111', status: 'LOCAL_DRAFT', revision: 1,
  source: service.invoiceSource(record, [payment]), template, buyer, invoiceDate: '2026-10-11' })

test('drafts allow unpaid, partial and free fees while rejecting invalid amounts', () => {
  assert.equal(service.invoiceSource({ ...record, status: 'PENDING' }, []).paidAmount, 0)
  assert.equal(service.invoiceSource({ ...record, status: 'PENDING' }, [payment]).paidAmount, 1350000)
  assert.equal(service.invoiceSource(record, [payment]).paymentMethodName, 'TM/Chuyển khoản')
  assert.equal(service.invoiceSource(record, [{ ...payment, method: 'CASH' }]).paymentMethodName, 'TM/Chuyển khoản')
  assert.equal(service.invoiceSource(record, [{ ...payment, method: 'CASH' }, payment]).paymentMethodName, 'TM/Chuyển khoản')
  assert.equal(service.invoiceSource(record, [{ ...payment, amount: 1000000 }]).paidAmount, 1000000)
  assert.equal(service.invoiceSource(record, [payment, { ...payment, id: 'refund', amount: -1 }]).paidAmount, 1349999)
  assert.throws(() => service.invoiceSource(record, [{ ...payment, amount: -1 }]), error => error.status === 409)
  assert.equal(service.invoiceSource({ ...record, finalAmount: 0, discountAmount: record.baseAmount }, []).finalAmount, 0)
  assert.throws(() => service.invoiceSource({ ...record, baseAmount: 1400000 }, [payment]))
  assert.throws(() => service.invoiceSource(record, [{ ...payment, amount: NaN }]))
  assert.throws(() => service.invoiceSource(record, [{ ...payment, tuitionRecordId: 'other' }]))
  const fingerprint = service.invoiceSource(record, [payment]).fingerprint
  assert.notEqual(fingerprint, service.invoiceSource({ ...record, studentName: 'Tên mới' }, [payment]).fingerprint)
})

test('buyer/date validation and payload keep original discount and paid fee, email disabled', () => {
  const input = { buyer, invoiceDate: '2026-10-11', templateId: template.id, revision: 0, TotalAmount: 1, IsSendEmail: true }
  assert.deepEqual(service.validateDraftInput(input).buyer, buyer)
  for (const invalid of [
    { ...input, invoiceDate: '2026-02-30' }, { ...input, revision: -1 },
    { ...input, buyer: { ...buyer, fullName: '' } }, { ...input, buyer: { ...buyer, taxCode: '0101243150' } },
    { ...input, buyer: { ...buyer, email: 'one@example.com;two@example.com' } },
  ]) assert.throws(() => service.validateDraftInput(invalid), error => error.status === 400)
  const payload = service.buildPreviewPayload(draft())
  assert.equal(payload.RefID, draft().refId)
  assert.equal(payload.TotalAmount, record.finalAmount)
  assert.equal(payload.TotalDiscountAmount, record.discountAmount)
  assert.equal(payload.TotalVATAmount, 0)
  assert.equal(payload.IsSendEmail, false)
  assert.equal(payload.PaymentMethodName, 'TM/Chuyển khoản')
  assert.equal(payload.OriginalInvoiceDetail[0].Amount - payload.OriginalInvoiceDetail[0].DiscountAmount, payload.TotalAmount)
  assert.equal(payload.OriginalInvoiceDetail[0].VATRateName, undefined)
  assert.throws(() => service.buildPreviewPayload({ ...draft(), template: { ...template, templateNo: '1' } }))
})

const fixtureEnv = () => {
  const keys = ['MEINVOICE_CLIENT_ID', 'MEINVOICE_CLIENT_SECRET', 'MEINVOICE_TAXCODE', 'MEINVOICE_USERNAME', 'MEINVOICE_PASSWORD']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  for (const key of keys) process.env[key] = 'test-placeholder'
  return () => { for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key] }
}
function provider(calls, options = {}) {
  return async (url, init) => {
    const path = new URL(url).pathname
    calls.push({ path, init })
    if (new URL(url).hostname === 'download.meinvoice.vn') {
      return new Response(options.emptyPdf ? '' : '%PDF-test', { status: 200, headers: { 'Content-Type': 'application/pdf' } })
    }
    let Data
    if (path.endsWith('/token')) Data = 'test-access-token'
    else if (path.endsWith('/templates')) Data = JSON.stringify([{ IPTemplateID: template.id, InvSeries: template.series,
      InvTemplateNo: '2', TemplateName: template.name, Inactive: options.inactive === true }])
    else if (path.endsWith('/unpublishview')) Data = options.url ?? 'https://download.meinvoice.vn/preview.pdf'
    else throw new Error('Forbidden provider endpoint: ' + path)
    return { ok: true, json: async () => ({ Success: true, Data }) }
  }
}

test('gateway only authenticates, reads active templates and requests unpublished preview', async () => {
  const restore = fixtureEnv()
  try {
    const calls = []
    const result = await service.previewInvoice(draft(), provider(calls))
    assert.equal(result.publishingEnabled, false)
    assert.deepEqual(calls.map(call => call.path.split('/').pop()), ['token', 'templates', 'unpublishview', 'preview.pdf'])
    assert.equal(result.contentVerified, true)
    const empty = await service.previewInvoice(draft(), provider([], { emptyPdf: true }))
    assert.equal(empty.contentVerified, false)
    assert.match(empty.message, /chưa đọc được nội dung PDF/)
    assert.equal(JSON.parse(calls[2].init.body).IsSendEmail, false)
    assert.equal(JSON.parse(calls[2].init.body).TotalAmount, 1350000)
    const inactive = []
    await assert.rejects(service.previewInvoice(draft(), provider(inactive, { inactive: true })), error => error.status === 409)
    assert.equal(inactive.length, 2) // No preview if template is inactive.
    await assert.rejects(service.previewInvoice(draft(), provider([], { url: 'https://evil.example/preview' })), error => error.status === 502)
    await assert.rejects(service.previewInvoice(draft(), async () => { throw new Error('secret-token-in-error') }), error => !error.message.includes('secret-token'))
  } finally { restore() }
})

test('draft routes allow partial/unpaid fees, reject unauthorized/stale requests and reuse RefID', async () => {
  const restore = fixtureEnv()
  const oldFetch = global.fetch
  const documents = new Map([['tuitionRecords/fee-1', { ...record, status: 'PENDING' }], ['payments/pay-1', { ...payment, amount: 500000 }]])
  const snapshot = path => ({ id: path.split('/').pop(), exists: documents.has(path), data: () => documents.get(path) })
  const collection = name => ({
    doc: id => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`), set: async data => documents.set(`${name}/${id}`, data) }),
    where: (field, _operator, value) => ({ get: async () => ({ docs: [...documents.entries()]
      .filter(([path, data]) => path.startsWith(name + '/') && data[field] === value).map(([path]) => snapshot(path)) }) }),
  })
  const firebasePath = require.resolve('../dist/lib/firebase')
  const oldFirebase = require.cache[firebasePath]
  require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: {
    db: { collection, runTransaction: async callback => callback({ get: ref => ref.get(), set: (ref, data) => documents.set(ref.path, data) }) },
    C: { TUITION_RECORDS: 'tuitionRecords', PAYMENTS: 'payments', STUDENTS: 'students' },
    toObj: doc => ({ ...doc.data(), id: doc.id }), toDocs: snap => snap.docs.map(doc => ({ ...doc.data(), id: doc.id })),
  } }
  const routerPath = require.resolve('../dist/routes/misaDrafts')
  delete require.cache[routerPath]
  const router = require(routerPath).default
  const invoke = async (path, method, body, user = { userId: 'admin', role: 'ADMIN' }) => {
    const req = { method, url: path, originalUrl: path, body, user, headers: {}, params: {}, query: {} }
    return new Promise((resolve, reject) => {
      const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this },
        json(data) { resolve({ status: this.statusCode, data }) } }
      router.handle(req, res, error => error ? reject(error) : reject(new Error('Route not handled')))
    })
  }
  const calls = []
  global.fetch = provider(calls)
  try {
    const body = { buyer, invoiceDate: '2026-10-11', templateId: template.id, revision: 0, finalAmount: 1, IsSendEmail: true }
    assert.equal((await invoke('/drafts/fee-1', 'POST', body, null)).status, 403)
    assert.equal((await invoke('/drafts/fee-1', 'POST', body, { role: 'STAFF' })).status, 403)
    const first = await invoke('/drafts/fee-1', 'POST', body)
    assert.equal(first.status, 200)
    assert.equal(first.data.draft.source.finalAmount, 1350000)
    assert.equal(first.data.draft.status, 'PENDING_MISA')
    assert.equal((await invoke('/drafts/fee-1', 'POST', body)).status, 409)
    const second = await invoke('/drafts/fee-1', 'POST', { ...body, revision: 1 })
    assert.equal(second.data.draft.refId, first.data.draft.refId)
    assert.equal(second.data.draft.revision, 2)
    assert.equal((await invoke('/drafts/fee-1/preview', 'POST', { revision: 1 })).status, 409)
    const result = await invoke('/drafts/fee-1/preview', 'POST', { revision: 2 })
    assert.equal(result.status, 200)
    assert.equal(result.data.publishingEnabled, false)
    documents.set('tuitionRecords/fee-1', { ...record, studentName: 'Đã sửa' })
    assert.equal((await invoke('/drafts/fee-1/preview', 'POST', { revision: 2 })).status, 409)
    documents.set('payments/pay-1', { ...payment, amount: 500000 })
    documents.delete('payments/pay-1')
    const unpaid = await invoke('/drafts/fee-1', 'POST', { ...body, revision: 2 })
    assert.equal(unpaid.status, 200)
    assert.equal(unpaid.data.draft.source.paidAmount, 0)
    assert.equal(unpaid.data.draft.refId, first.data.draft.refId)
    assert.equal(documents.get('invoiceDrafts/fee-1').revision, 3)
  } finally {
    restore(); global.fetch = oldFetch
    delete require.cache[routerPath]
    if (oldFirebase) require.cache[firebasePath] = oldFirebase; else delete require.cache[firebasePath]
  }
})

test('class/private fee creation commits one unpaid draft atomically and recalculation preserves edits', async () => {
  const oldList = service.listInvoiceTemplates
  service.listInvoiceTemplates = async () => [template]
  const documents = new Map([
    ['students/s1', { fullName: 'Học viên', primaryParentName: 'Phụ huynh', primaryParentPhone: '0900000000' }],
    ['classes/c1', { name: 'Toán 6', tuitionRate: 100000 }],
    ['classEnrollments/e1', { classId: 'c1', studentId: 's1', status: 'ACTIVE' }],
    ['sessions/s1', { classId: 'c1', sessionDate: '2026-10-10', status: 'SCHEDULED' }],
    ['privateSchedules/p1', { studentId: 's1', sessionDate: '2026-10-10', status: 'SCHEDULED', ratePerSession: 200000 }],
  ])
  let sequence = 0
  let failCommit = false
  const snapshot = path => ({ id: path.split('/').pop(), exists: documents.has(path), data: () => documents.get(path) })
  const collection = (name, filters = [], cap = Infinity) => ({
    doc: id => {
      const path = `${name}/${id ?? `auto-${++sequence}`}`
      return { id: path.split('/').pop(), path, get: async () => snapshot(path),
        update: async data => documents.set(path, { ...documents.get(path), ...data }) }
    },
    where: (field, op, value) => collection(name, [...filters, [field, op, value]], cap),
    limit: count => collection(name, filters, count),
    get: async () => {
      const docs = [...documents.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && filters.every(([field, op, value]) =>
        op === '==' ? data[field] === value : op === '>=' ? data[field] >= value : data[field] <= value))
        .slice(0, cap).map(([path]) => snapshot(path))
      return { docs, empty: docs.length === 0 }
    },
  })
  const db = {
    collection,
    batch: () => {
      const writes = []
      return { set: (ref, data) => writes.push([ref.path, data]), commit: async () => {
        if (failCommit) throw new Error('simulated atomic commit failure')
        for (const [path, data] of writes) documents.set(path, data)
      } }
    },
    runTransaction: async callback => {
      const writes = []
      const result = await callback({ get: ref => ref.get(), set: (ref, data) => writes.push([ref.path, data]) })
      for (const [path, data] of writes) documents.set(path, data)
      return result
    },
  }
  const paths = ['../dist/lib/firebase', '../dist/services/invoiceDraftService', '../dist/services/tuitionCalculator'].map(require.resolve)
  const previous = paths.map(path => require.cache[path])
  require.cache[paths[0]] = { id: paths[0], filename: paths[0], loaded: true, exports: {
    db, C: { STUDENTS: 'students', CLASSES: 'classes', ENROLLMENTS: 'classEnrollments', SESSIONS: 'sessions',
      PRIVATE_SCHEDULES: 'privateSchedules', STUDENT_PROMOTIONS: 'studentPromotions', TUITION_RECORDS: 'tuitionRecords', PAYMENTS: 'payments' },
    toObj: doc => ({ ...doc.data(), id: doc.id }), toDocs: snap => snap.docs.map(doc => ({ ...doc.data(), id: doc.id })),
  } }
  delete require.cache[paths[1]]; delete require.cache[paths[2]]
  try {
    const calc = require(paths[2])
    const drafts = require(paths[1])
    for (const classId of ['c1', 'private']) {
      const first = await calc.calculateTuitionForStudent('s1', classId, 10, 2026)
      const id = first.tuitionRecord.id
      const draft = documents.get(`invoiceDrafts/${id}`)
      assert.equal(first.isNew, true)
      assert.equal(first.tuitionRecord.status, 'PENDING')
      assert.equal(draft.source.paidAmount, 0)
      assert.equal(draft.source.finalAmount, classId === 'c1' ? 100000 : 200000)
      assert.equal(draft.buyer.fullName, 'Phụ huynh')
      assert.equal(draft.template.id, template.id)
      assert.equal(draft.status, 'PENDING_MISA')
      assert.equal(documents.get(`invoiceOutbox/${id}`).idempotencyKey, draft.refId)
      draft.buyer.fullName = 'Đã chỉnh sửa'
      const second = await calc.calculateTuitionForStudent('s1', classId, 10, 2026)
      assert.equal(second.isNew, false)
      assert.equal(second.tuitionRecord.id, id)
      assert.equal(documents.get(`invoiceDrafts/${id}`).refId, draft.refId)
      assert.equal(documents.get(`invoiceDrafts/${id}`).buyer.fullName, 'Đã chỉnh sửa')
      documents.delete(`invoiceDrafts/${id}`)
      await calc.calculateTuitionForStudent('s1', classId, 10, 2026)
      assert.equal(documents.get(`invoiceDrafts/${id}`).source.recordId, id)
    }
    const size = documents.size
    failCommit = true
    await assert.rejects(drafts.createTuitionWithInvoiceDraft({ ...record, id: undefined }, {}), /atomic commit failure/)
    assert.equal(documents.size, size)
    assert.equal([...documents.keys()].filter(path => path.startsWith('invoiceDrafts/')).length, 2)
  } finally {
    service.listInvoiceTemplates = oldList
    paths.forEach((path, index) => { if (previous[index]) require.cache[path] = previous[index]; else delete require.cache[path] })
  }
})

test('default template is explicit or uniquely eligible; never choose arbitrary templates', () => {
  const { chooseDefaultInvoiceTemplate } = require('../dist/services/invoiceDraftService')
  const keys = ['MEINVOICE_DEFAULT_TEMPLATE_ID', 'MEINVOICE_DEFAULT_SERIES']
  const previous = keys.map(key => process.env[key])
  try {
    keys.forEach(key => delete process.env[key])
    assert.equal(chooseDefaultInvoiceTemplate([template]).id, template.id)
    assert.equal(chooseDefaultInvoiceTemplate([]), null)
    assert.equal(chooseDefaultInvoiceTemplate([{ ...template, templateNo: '1' }]), null)
    const other = { ...template, id: 'other', series: '2C26MZZ' }
    assert.equal(chooseDefaultInvoiceTemplate([template, other]), null)
    process.env.MEINVOICE_DEFAULT_TEMPLATE_ID = other.id
    assert.equal(chooseDefaultInvoiceTemplate([template, other]).id, other.id)
    process.env.MEINVOICE_DEFAULT_SERIES = template.series
    assert.equal(chooseDefaultInvoiceTemplate([template, other]), null)
    delete process.env.MEINVOICE_DEFAULT_TEMPLATE_ID
    assert.equal(chooseDefaultInvoiceTemplate([template, other]).id, template.id)
    assert.equal(chooseDefaultInvoiceTemplate([template, { ...template, id: 'duplicate' }]), null)
  } finally {
    keys.forEach((key, index) => previous[index] === undefined ? delete process.env[key] : process.env[key] = previous[index])
  }
})
