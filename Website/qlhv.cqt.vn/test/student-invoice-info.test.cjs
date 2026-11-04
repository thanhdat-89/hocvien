const test = require('node:test')
const assert = require('node:assert/strict')
const { buyerFromStudent, parseInvoiceInfo } = require('../dist/services/studentInvoiceInfo')

test('người mua ưu tiên thông tin hoá đơn của học viên', () => {
  const buyer = buyerFromStudent({
    fullName: 'Nguyen Van A', address: 'Địa chỉ cũ', invoiceFullName: 'Nguyễn Văn A', invoiceCitizenId: '001234567890',
    invoiceAddress: '12 Lò Đúc', invoiceEmail: 'a@example.com', invoicePhone: '0901234567',
  })
  assert.deepEqual(buyer, { fullName: 'Nguyễn Văn A', legalName: '', citizenIdNumber: '001234567890',
    address: '12 Lò Đúc', email: 'a@example.com', phone: '0901234567' })
})

test('thiếu thông tin hoá đơn thì lùi về tên và địa chỉ học viên', () => {
  const buyer = buyerFromStudent({ fullName: 'Nguyễn Văn A', address: 'Hà Nội' }, 'phiếu')
  assert.deepEqual(buyer, { fullName: 'Nguyễn Văn A', legalName: '', citizenIdNumber: '', address: 'Hà Nội', email: '', phone: '' })
  assert.equal(buyerFromStudent(null, 'Tên phiếu').fullName, 'Tên phiếu')
})

test('parseInvoiceInfo chuẩn hoá, bỏ qua trường không gửi và kiểm tra định dạng', () => {
  assert.deepEqual(parseInvoiceInfo({ fullName: 'x' }), {})
  assert.deepEqual(parseInvoiceInfo({ invoiceFullName: '  Nguyễn   Văn A ', invoiceEmail: '', invoiceCitizenId: '079123456789' }),
    { invoiceFullName: 'Nguyễn Văn A', invoiceEmail: null, invoiceCitizenId: '079123456789' })
  assert.throws(() => parseInvoiceInfo({ invoiceCitizenId: '12345' }), /CCCD/)
  assert.throws(() => parseInvoiceInfo({ invoiceEmail: 'abc' }), /Email/)
  assert.throws(() => parseInvoiceInfo({ invoicePhone: 'abc' }), /điện thoại/)
})
