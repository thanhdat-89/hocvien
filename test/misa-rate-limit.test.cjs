const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { misaFetch, MisaNotSentError, misaQueueState, isTransientMisaFailure } = require('../dist/services/misaRateLimit')
const { createMisaDraft, listInvoiceTemplates, resetMisaAuthCache, InvoicePreviewError } = require('../dist/services/misaInvoicePreview')

beforeEach(() => resetMisaAuthCache())

function withEnv(values) {
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  return () => Object.entries(old).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value)
}
const misaEnv = () => withEnv({ MEINVOICE_CLIENT_ID: 'fixture-value', MEINVOICE_CLIENT_SECRET: 'fixture-value',
  MEINVOICE_TAXCODE: 'fixture-value', MEINVOICE_USERNAME: 'fixture-value', MEINVOICE_PASSWORD: 'fixture-value' })

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers })
const busy = () => json({ message: 'Too many requests' }, 429, { 'Retry-After': '0' })
const oauth = () => json({ access_token: 'token', OrganizationUnitID: 'org-1', CompanyID: '123', UserID: 'user-1' })

const source = { recordId: 'fee-1', studentId: 's-1', studentName: 'Học viên', className: 'Toán 9', month: 11, year: 2026,
  baseAmount: 100000, discountAmount: 0, finalAmount: 100000, paidAmount: 0, paymentMethodName: 'TM/Chuyển khoản', fingerprint: 'x' }
const draft = { refId: 'ref-1', source, template: { id: 't-1', name: 'Mẫu', series: '2C26MHP', templateNo: '2', isInvoiceSummary: false },
  buyer: { fullName: 'Phụ huynh', legalName: '', address: '', email: '', phone: '' }, invoiceDate: '2026-11-22' }

test('hàng đợi chung: tối đa 2 yêu cầu MISA cùng lúc, các lần bắt đầu cách nhau', async t => {
  t.after(withEnv({ MISA_MAX_CONCURRENT: '2', MISA_MIN_INTERVAL_MS: '20' }))
  let running = 0, peak = 0
  const starts = []
  const request = async () => {
    starts.push(Date.now()); running++; peak = Math.max(peak, running)
    await new Promise(r => setTimeout(r, 30))
    running--
    return json({})
  }
  await Promise.all(Array.from({ length: 8 }, () => misaFetch(request, 'https://misa/x')))
  assert.equal(peak, 2)
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 15, 'các lần gọi phải cách nhau')
  assert.deepEqual(misaQueueState(), { active: 0, waiting: 0 })
})

test('hết giờ khi còn xếp hàng: không gửi gì, báo MisaNotSentError', async t => {
  t.after(withEnv({ MISA_MAX_CONCURRENT: '1', MISA_MIN_INTERVAL_MS: '0' }))
  let calls = 0
  let release
  const slow = misaFetch(async () => { calls++; await new Promise(r => { release = r }); return json({}) }, 'https://misa/slow')
  const controller = new AbortController()
  const queued = misaFetch(async () => { calls++; return json({}) }, 'https://misa/queued', { signal: controller.signal })
  controller.abort()
  await assert.rejects(queued, error => error instanceof MisaNotSentError)
  release(); await slow
  assert.equal(calls, 1)
  assert.deepEqual(misaQueueState(), { active: 0, waiting: 0 })
})

test('MISA trả 429 khi tạo hóa đơn: không gửi lại, ghi rõ CHƯA tạo (không phải "không rõ kết quả")', async t => {
  t.after(misaEnv())
  let writes = 0
  const request = async url => {
    if (url.endsWith('/oauth')) return oauth()
    writes++
    return busy()
  }
  await assert.rejects(createMisaDraft(draft, request), error =>
    error instanceof InvoicePreviewError && error.ambiguous === false && /HTTP 429/.test(error.message) && isTransientMisaFailure(error.message))
  assert.equal(writes, 1)
})

test('MISA trả 429 khi đăng nhập: chờ rồi thử lại, sau đó tạo hóa đơn bình thường', async t => {
  t.after(misaEnv())
  let logins = 0
  const request = async url => {
    if (url.endsWith('/oauth')) return ++logins === 1 ? busy() : oauth()
    return json({ Data: JSON.stringify({ 'ref-1': { IsValid: true, RefID: 'ref-1', PublishStatus: 0, InvNo: '' } }) })
  }
  const created = await createMisaDraft(draft, request)
  assert.equal(created.invoiceNumber, '')
  assert.equal(logins, 2)
})

test('cổng developer trả 429 ở bước lấy token: thử lại tối đa 3 lần rồi mới báo lỗi', async t => {
  t.after(misaEnv())
  let tokens = 0
  await assert.rejects(listInvoiceTemplates(2026, async url => { if (url.endsWith('/token')) tokens++; return busy() }),
    /HTTP 429 ở bước xác thực/)
  assert.equal(tokens, 3)

  resetMisaAuthCache(); tokens = 0
  const templates = await listInvoiceTemplates(2026, async url => {
    if (url.endsWith('/token')) return ++tokens === 1 ? busy() : json({ Success: true, Data: 'token' })
    return json({ Success: true, Data: [{ IPTemplateID: 't-1', InvSeries: '2C26MHP', InvTemplateNo: '2', TemplateName: 'Mẫu' }] })
  })
  assert.equal(templates[0].id, 't-1')
  assert.equal(tokens, 2)
})

test('phân loại lỗi tạm thời', () => {
  assert.ok(isTransientMisaFailure('MISA trả lỗi HTTP 429 ở bước xác thực.'))
  assert.ok(isTransientMisaFailure('Không kết nối được MISA ở bước xác thực. Vui lòng thử lại sau.'))
  assert.ok(isTransientMisaFailure('MISA đang bận, hóa đơn chưa được gửi đi. Có thể tạo lại an toàn.'))
  assert.ok(!isTransientMisaFailure('Email người mua không hợp lệ.'))
  assert.ok(!isTransientMisaFailure('MISA trả lỗi HTTP 400 ở bước lấy mẫu hóa đơn.'))
  assert.ok(!isTransientMisaFailure(null))
})
