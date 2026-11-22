const { test } = require('node:test')
const assert = require('node:assert/strict')
const service = require('../dist/services/misaInvoicePreview')

const record = { id: 'fee-1', studentId: 'student-1', studentName: 'Học viên thử nghiệm', className: 'Toán 6',
  billingMonth: 10, billingYear: 2026, baseAmount: 1500000, discountAmount: 150000,
  finalAmount: 1350000, status: 'PAID' }
const payment = { id: 'pay-1', tuitionRecordId: 'fee-1', amount: 1350000, method: 'BANK_TRANSFER' }
const template = { id: 'template-1', name: 'Hóa đơn bán hàng', series: '2C26MHP', templateNo: '2', isInvoiceSummary: false }
// Từ 12/10/2026 người mua dùng số CCCD (citizenIdNumber) thay mã số thuế — xem misa-auto-draft-contract.test.cjs cho payload.
const buyer = { fullName: 'Người mua thử nghiệm', legalName: '', citizenIdNumber: '012345678901', address: '', email: '', phone: '' }

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

test('buyer and invoice date are validated', () => {
  const input = { buyer, invoiceDate: '2026-10-11', templateId: template.id, revision: 0, TotalAmount: 1, IsSendEmail: true }
  const valid = service.validateDraftInput(input)
  assert.deepEqual(valid.buyer, buyer)
  assert.equal(valid.TotalAmount, undefined, 'client không tự đặt tổng tiền')
  for (const invalid of [
    { ...input, invoiceDate: '2026-02-30' }, { ...input, revision: -1 },
    { ...input, buyer: { ...buyer, fullName: '' } }, { ...input, buyer: { ...buyer, citizenIdNumber: '1'.repeat(21) } },
    { ...input, buyer: { ...buyer, email: 'one@example.com;two@example.com' } },
  ]) assert.throws(() => service.validateDraftInput(invalid), error => error.status === 400)
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
