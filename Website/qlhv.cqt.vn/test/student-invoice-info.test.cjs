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

const { buildInvoicePreview } = require('../dist/services/studentInvoiceInfo')
const { vndInWords } = require('../dist/lib/vndWords')

test('đọc số tiền thành chữ theo mẫu hoá đơn MISA', () => {
  assert.equal(vndInWords(1400000), 'Một triệu bốn trăm nghìn đồng chẵn.')
  assert.equal(vndInWords(1050000), 'Một triệu không trăm năm mươi nghìn đồng chẵn.')
  assert.equal(vndInWords(1001000), 'Một triệu không trăm lẻ một nghìn đồng chẵn.')
  assert.equal(vndInWords(125), 'Một trăm hai mươi lăm đồng chẵn.')
  assert.equal(vndInWords(2000000000), 'Hai tỷ đồng chẵn.')
  assert.equal(vndInWords(0), 'Không đồng.')
})

const previewBase = { student: { fullName: 'Học viên thử nghiệm', address: null, invoiceCitizenId: '001200000001',
  invoiceAddress: 'Số 1 phố Thử Nghiệm', invoiceEmail: 'a@example.com' },
  activeClassNames: ['Toán 10 - CQT01'], period: { month: 11, year: 2026 }, periods: [{ month: 11, year: 2026 }],
  invoiceDate: '2026-11-04', series: '2C26MHP', existingInvoice: null }

test('bản xem trước có cùng dòng hàng và tổng tiền với hoá đơn thật', () => {
  const preview = buildInvoicePreview({ ...previewBase, records: [
    { className: 'Toán 10 - CQT01', baseAmount: 1400000, discountAmount: 0, finalAmount: 1400000 },
    { className: 'Học riêng', baseAmount: 500000, discountAmount: 50000, finalAmount: 450000 },
  ] })
  assert.deepEqual(preview.lines.map(l => [l.description, l.unitName, l.quantity, l.unitPrice]),
    [['Học phí Toán 10 - CQT01', 'Tháng', 1, 1400000], ['Học phí Học riêng', 'Tháng', 1, 500000]])
  assert.deepEqual(preview.totals, { amount: 1900000, discountAmount: 50000, finalAmount: 1850000 })
  assert.equal(preview.amountInWords, 'Một triệu tám trăm năm mươi nghìn đồng chẵn.')
  assert.equal(preview.buyer.citizenIdNumber, '001200000001')
  assert.deepEqual(preview.buyerFallback, { fullName: true, address: false })
  assert.deepEqual(preview.warnings, [])
})

test('tháng chưa có phiếu: dòng mẫu theo lớp đang học, không có số tiền, có cảnh báo', () => {
  const preview = buildInvoicePreview({ ...previewBase, records: [], student: { fullName: 'A', address: 'Hà Nội' },
    existingInvoice: { invoiceNumber: '00001336', status: 'ISSUED' } })
  assert.equal(preview.lines[0].description, 'Học phí Toán 10 - CQT01')
  assert.equal(preview.lines[0].unitPrice, null)
  assert.equal(preview.totals.finalAmount, null)
  assert.equal(preview.amountInWords, null)
  assert.deepEqual(preview.buyerFallback, { fullName: true, address: true })
  assert.ok(preview.warnings.some(w => w.includes('Chưa có phiếu học phí tháng 11/2026')))
  assert.ok(preview.warnings.some(w => w.includes('00001336')))
  assert.ok(preview.warnings.some(w => w.includes('CCCD')))
})
