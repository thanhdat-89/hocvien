const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createMisaDraft } = require('../dist/services/misaInvoicePreview')

const source = {
  recordId: 'fee-1', studentId: 'student-1', studentName: 'Học viên thử', className: 'Toán 9',
  month: 10, year: 2026, baseAmount: 1000000, discountAmount: 100000, finalAmount: 900000,
  paidAmount: 0, paymentMethodName: 'TM/Chuyển khoản', fingerprint: 'fixture',
}
const template = { id: 'template-1', name: 'Mẫu bán hàng', series: '2C26MHP', templateNo: '2', isInvoiceSummary: false }
const input = { refId: 'stable-ref-1', source, template, buyer: {
  fullName: 'Phụ huynh thử nghiệm', legalName: '', citizenIdNumber: '', address: '', email: '', phone: '',
}, invoiceDate: '2026-10-13' }

function setupEnv() {
  const keys = ['MEINVOICE_CLIENT_ID', 'MEINVOICE_CLIENT_SECRET', 'MEINVOICE_TAXCODE', 'MEINVOICE_USERNAME', 'MEINVOICE_PASSWORD']
  const old = keys.map(key => process.env[key])
  keys.forEach(key => { process.env[key] = 'fixture-value' })
  return () => keys.forEach((key, index) => old[index] === undefined ? delete process.env[key] : process.env[key] = old[index])
}

function response(value, ok = true) { return { ok, json: async () => value } }

test('tạo nháp gửi đúng endpoint, header ngữ cảnh và PublishStatus=0', async () => {
  const restore = setupEnv(); const calls = []
  try {
    const request = async (url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/oauth')) return response({ access_token: 'token', OrganizationUnitID: 'org-1', CompanyID: '123', UserID: 'user-1' })
      if (url.endsWith('/v3sainvoice/Code')) return response({ Data: JSON.stringify({ 'stable-ref-1': { IsValid: true, RefID: 'stable-ref-1', PublishStatus: 0, InvNo: '' } }) })
      throw new Error(`unexpected ${url}`)
    }
    const result = await createMisaDraft(input, request)
    assert.equal(result.transactionId, '')
    assert.equal(calls.length, 2)
    const call = calls[1]
    const body = JSON.parse(call.init.body)[0]
    assert.equal(body.RefID, 'stable-ref-1')
    assert.equal(body.PublishStatus, 0)
    assert.equal(body.InvoiceType, 10)
    assert.equal(call.init.headers.OrganizationUnitID, 'org-1')
    assert.equal(body.OrganizationUnitID, 'org-1')
    assert.equal(body.CompanyID, 123)
    assert.equal(body.UserID, 'user-1')
  } finally { restore() }
})

test('MISA từ chối rõ ràng được phân loại lỗi xác định', async () => {
  const restore = setupEnv()
  try {
    const request = async (url) => {
      if (url.endsWith('/oauth')) return response({ access_token: 'token', OrganizationUnitID: 'org-1', CompanyID: '123', UserID: 'user-1' })
      return response({ Data: JSON.stringify({ 'stable-ref-1': { IsValid: false, RefID: 'stable-ref-1', ValidateResult: [{ ErrorCode: 'INVALID_TEMPLATE', ErrorMessage: 'Mẫu không hợp lệ' }] } }) })
    }
    await assert.rejects(createMisaDraft(input, request), error => error.ambiguous === false && /Mẫu không hợp lệ/.test(error.message))
  } finally { restore() }
})
