const { test } = require('node:test')
const assert = require('node:assert/strict')
const service = require('../dist/services/misaInvoicePreview')

const record = { id: 'fee-1', studentId: 'student-1', studentName: 'Học viên thử nghiệm', className: 'Toán 6',
  billingMonth: 10, billingYear: 2026, baseAmount: 1500000, discountAmount: 150000,
  finalAmount: 1350000, status: 'PAID' }
const payment = { id: 'pay-1', tuitionRecordId: 'fee-1', amount: 1350000, method: 'BANK_TRANSFER' }
const template = { id: 'template-1', name: 'Hóa đơn bán hàng', series: '2C26MHP', templateNo: '2', isInvoiceSummary: false, invoiceType: 10 }
const buyer = { fullName: 'Người mua thử nghiệm', legalName: '', citizenIdNumber: '012345678901', address: '', email: '', phone: '' }
const input = () => ({ refId: 'a1111111-1111-4111-8111-111111111111', source: service.invoiceSource(record, [payment]), template, buyer, invoiceDate: '2026-10-11' })

 test('invoice requires a valid tuition record paid in full and fingerprints saved payments', () => {
  assert.equal(service.invoiceSource(record, [payment]).paymentMethodName, 'TM/Chuyển khoản')
  for (const payments of [[], [{ ...payment, amount: 1000000 }], [{ ...payment, amount: -1 }]]) {
    assert.throws(() => service.invoiceSource(record, payments), error => error.status === 409)
  }
  assert.throws(() => service.invoiceSource({ ...record, finalAmount: 0 }, [payment]))
  assert.throws(() => service.invoiceSource({ ...record, baseAmount: 1400000 }, [payment]))
  assert.throws(() => service.invoiceSource(record, [{ ...payment, tuitionRecordId: 'other' }]))
  assert.notEqual(service.invoiceSource(record, [payment]).fingerprint,
    service.invoiceSource({ ...record, studentName: 'Tên mới' }, [payment]).fingerprint)
})

test('buyer and invoice date are validated; client cannot supply invoice totals', () => {
  const parsed = service.validateDraftInput({ buyer, invoiceDate: '2026-10-11', templateId: template.id, revision: 0, finalAmount: 1 })
  assert.deepEqual(parsed.buyer, buyer)
  for (const invalid of [
    { buyer, invoiceDate: '2026-02-30', templateId: template.id, revision: 0 },
    { buyer: { ...buyer, fullName: '' }, invoiceDate: '2026-10-11', templateId: template.id, revision: 0 },
    { buyer: { ...buyer, citizenIdNumber: '1'.repeat(21) }, invoiceDate: '2026-10-11', templateId: template.id, revision: 0 },
    { buyer, invoiceDate: '2026-10-11', templateId: template.id, revision: -1 },
  ]) assert.throws(() => service.validateDraftInput(invalid), error => error.status === 400)
})

const env = ['MEINVOICE_CLIENT_ID', 'MEINVOICE_CLIENT_SECRET', 'MEINVOICE_TAXCODE', 'MEINVOICE_USERNAME', 'MEINVOICE_PASSWORD']
test('direct MISA workflow creates only an unpublished draft and does not call a signing or issuing endpoint', async () => {
  const previous = Object.fromEntries(env.map(key => [key, process.env[key]]))
  env.forEach(key => { process.env[key] = 'test-placeholder' })
  const calls = []
  try {
    const mockFetch = async (url, init) => {
      const parsed = new URL(url)
      calls.push({ path: parsed.pathname, init })
      if (parsed.pathname === '/api/v2/oauth') return new Response(JSON.stringify({ access_token: 'opaque-test-token' }), { status: 200 })
      if (parsed.pathname === '/api/v2/v3sainvoice/Code') return new Response(JSON.stringify({
        data: JSON.stringify({ [input().refId]: { Success: true,
          Data: JSON.stringify({ RefID: input().refId, InvNo: 'Chưa cấp số', PublishStatus: 0 }), ErrorCode: [] } }),
      }), { status: 200 })
      throw new Error('Unexpected endpoint ' + parsed.pathname)
    }
    const invoiceInput = { ...input(), source: { ...input().source, className: 'Học riêng' } }
    const result = await service.createMisaDraft(invoiceInput, mockFetch)
    assert.equal(result.invoiceNumber, 'Chưa cấp số')
    assert.deepEqual(calls.map(call => call.path), ['/api/v2/oauth', '/api/v2/v3sainvoice/Code'])
    const payload = JSON.parse(calls[1].init.body)[0]
    assert.equal(payload.PublishStatus, 0)
    assert.equal(payload.InvoiceDetails[0].Description, 'Học phí Học riêng')
    assert.equal(payload.InvoiceType, 10)
    assert.equal(payload.InvoiceDetails[0].CustomField1Detail, '150000')
    assert.equal(payload.PaymentMethod, 'TM/CK')
    assert.equal(payload.AccountObjectTaxCode, '')
    assert.equal(payload.CitizenIDNumber, '012345678901')
    assert.equal(payload.TotalAmount, 1350000)
    assert.equal(payload.InvoiceDetails[0].VATRate, 0)

    const classInvoiceInput = { ...input(), source: { ...input().source, className: 'Toán 8 - CQT02' } }
    await service.createMisaDraft(classInvoiceInput, mockFetch)
    const classDescription = JSON.parse(calls[3].init.body)[0].InvoiceDetails[0].Description
    assert.equal(classDescription, 'Học phí Toán 8 - CQT02')

    const privateSource = { ...input().source, className: 'Học riêng', baseAmount: 2500000, discountAmount: 0, finalAmount: 2500000 }
    await service.createMisaDraft({ ...input(), sources: [input().source, privateSource] }, mockFetch)
    const groupedPayload = JSON.parse(calls[5].init.body)[0]
    assert.deepEqual(groupedPayload.InvoiceDetails.map(item => item.Description), ['Học phí Toán 6', 'Học phí Học riêng'])
    assert.equal(groupedPayload.TotalSaleAmount, 4000000)
    assert.equal(groupedPayload.TotalDiscountAmount, 150000)
    assert.equal(groupedPayload.TotalAmount, 3850000)
    await assert.rejects(service.createMisaDraft({ ...input(), sources: [input().source, { ...privateSource, studentId: 'another-student' }] }, async () => {
      throw new Error('MISA must not be called for a mixed-student invoice')
    }), error => error.status === 400)
  } finally {
    env.forEach(key => previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key])
  }
})

test('MISA status refresh distinguishes draft, issued and accepted by tax authority', async () => {
  const previous = Object.fromEntries(env.map(key => [key, process.env[key]]))
  env.forEach(key => { process.env[key] = 'test-placeholder' })
  try {
    for (const [invoice, expected] of [
      [{ PublishStatus: 0, SendToTaxStatus: 0 }, 'DRAFT_CREATED'],
      [{ PublishStatus: 1, SendToTaxStatus: 0 }, 'ISSUED'],
      [{ PublishStatus: 1, SendToTaxStatus: 2, TransactionID: 'lookup-code' }, 'SENT_TO_TAX'],
    ]) {
      const result = await service.readMisaInvoiceStatus(input().refId, async url => {
        const path = new URL(url).pathname
        if (path === '/api/v2/oauth') return new Response(JSON.stringify({ access_token: 'opaque-test-token' }), { status: 200 })
        if (path.includes('/api/v2/v3sainvoice/code/')) return new Response(JSON.stringify({ data: JSON.stringify({ ...invoice, RefID: input().refId, InvNo: '00000001' }) }), { status: 200 })
        if (path === '/api/v3/invoicepublished/linkview') return new Response(JSON.stringify({ Success: true, Data: 'https://www.meinvoice.vn/tra-cuu/invoice.pdf' }), { status: 200 })
        throw new Error('Unexpected endpoint ' + path)
      })
      assert.equal(result.status, expected)
      assert.equal(result.invoiceNumber, '00000001')
      if (expected === 'SENT_TO_TAX') assert.equal(result.invoiceUrl, 'https://www.meinvoice.vn/tra-cuu/invoice.pdf')
    }
  } finally {
    env.forEach(key => previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key])
  }
})
