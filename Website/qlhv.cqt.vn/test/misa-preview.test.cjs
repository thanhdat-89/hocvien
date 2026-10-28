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

test('default template is explicit or uniquely eligible; never choose arbitrary templates', () => {
  const { chooseDefaultInvoiceTemplate } = require('../dist/services/misaAutoDraft')
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
