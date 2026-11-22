const { test } = require('node:test')
const assert = require('node:assert/strict')
const service = require('../dist/services/telegramService')

async function config(run, enabled = true) {
  const keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], old = keys.map(k => process.env[k])
  keys.forEach(k => { if (enabled) process.env[k] = 'fixture'; else delete process.env[k] })
  try { await run() } finally { keys.forEach((k,i) => old[i] === undefined ? delete process.env[k] : process.env[k] = old[i]) }
}

test('Telegram is disabled without configuration and makes no network call', async () => config(async () => {
  const result = await service.checkTelegramConnection(() => { throw Error('unexpected network') })
  assert.equal(result.state, 'NOT_CONFIGURED')
  assert.equal(result.missing.length, 2)
}, false))

test('connection check verifies bot and receiving chat without exposing credentials', async () => config(async () => {
  const methods = []
  const result = await service.checkTelegramConnection(async (url, init) => {
    const method = url.split('/').pop(); methods.push(method)
    if (method === 'getChat') assert.equal(JSON.parse(init.body).chat_id, 'fixture')
    return Response.json({ ok: true, result: method === 'getMe' ? { username: 'test_bot' } : { type: 'private' } })
  })
  assert.equal(result.state, 'CONNECTED')
  assert.deepEqual(methods, ['getMe', 'getChat'])
  assert.equal(JSON.stringify(result).includes('fixture'), false)
}))

test('grouped invoice produces one message with total, periods and invoice reference', () => {
  const first = { studentName: 'An Khanh', className: 'Toán 8', month: 7, year: 2026, finalAmount: 1350000 }
  const text = service.invoiceTelegramMessage({ source: first, sources: [first, { ...first, className: 'Học riêng', finalAmount: 1250000 }], invoiceDate: '2026-10-14', refId: 'ref-1' })
  assert.match(text, /14\/10\/2026/)
  assert.match(text, /2\.600\.000 đ/)
  assert.match(text, /Toán 8/)
  assert.match(text, /Học riêng/)
  assert.match(text, /RefID: ref-1/)
})

test('failure message explains the reason and protects secrets', () => {
  const old = process.env.MEINVOICE_PASSWORD
  process.env.MEINVOICE_PASSWORD = 'private-password'
  try {
    const text = service.invoiceFailureTelegramMessage({ recordIds: ['fee-1'], reason: 'Lỗi xác thực private-password',
      sources: [{ studentName: 'Student', className: 'Math', month: 7, year: 2026, finalAmount: 100000 }] })
    assert.match(text, /TẠO HÓA ĐƠN KHÔNG THÀNH CÔNG/)
    assert.match(text, /Lý do: Lỗi xác thực \[ẩn\]/)
    assert.match(text, /kỳ 7\/2026/)
    assert.doesNotMatch(text, /private-password/)
    const unknown = service.invoiceFailureTelegramMessage({ recordIds: ['fee-1'], refId: 'ref-1', reason: 'Mất kết nối', outcomeUnknown: true })
    assert.match(unknown, /CHƯA XÁC ĐỊNH KẾT QUẢ/)
    assert.match(unknown, /đối chiếu RefID/)
  } finally { if (old === undefined) delete process.env.MEINVOICE_PASSWORD; else process.env.MEINVOICE_PASSWORD = old }
})

test('send failure returns a safe result without raw provider error or token', async () => config(async () => {
  const result = await service.sendTelegramMessage('test', async () => { throw Error('https://api.telegram.org/botfixture/sendMessage') })
  assert.equal(result.sent, false)
  assert.equal(result.errorCode, 'NETWORK_ERROR')
  assert.equal(JSON.stringify(result).includes('fixture'), false)
}))

test('hóa đơn mới được gom: một hóa đơn → tin chi tiết như cũ; nhiều hóa đơn → MỘT tin tổng hợp', async () => config(async () => {
  const src = (name, amount, className = 'Toán 9') => ({ studentName: name, className, month: 11, year: 2026, finalAmount: amount })
  const invoice = (name, amount, extra = {}) => ({ source: src(name, amount), sources: [src(name, amount)], invoiceDate: '2026-11-22',
    refId: `ref-${name}`, status: 'DRAFT_CREATED', ...extra })
  const messages = []
  const telegram = async (_url, init) => { messages.push(JSON.parse(init.body).text); return Response.json({ ok: true, result: { message_id: 1 } }) }

  service.notifyInvoiceCreated(invoice('Lỗi', 1, { status: 'FAILED' }))
  assert.deepEqual(await service.flushInvoiceCreatedNotifications(telegram), { sent: false, count: 0 }, 'chỉ báo hóa đơn đã tạo')

  service.notifyInvoiceCreated(invoice('An', 100000))
  await service.flushInvoiceCreatedNotifications(telegram)
  assert.match(messages[0], /^🧾 HÓA ĐƠN MỚI — CHƯA PHÁT HÀNH\nHọc viên: An[\s\S]*RefID: ref-An/)

  for (let i = 0; i < 41; i++) service.notifyInvoiceCreated(invoice(`Học viên ${i}`, 2000000))
  service.notifyInvoiceCreated({ ...invoice('Gộp', 0), sources: [src('Gộp', 1000000, 'Toán 8'), src('Gộp', 680000, 'Học riêng')] })
  assert.deepEqual(await service.flushInvoiceCreatedNotifications(telegram), { sent: true, count: 42 })
  assert.equal(messages.length, 2)
  const text = messages[1]
  assert.match(text, /^🧾 42 HÓA ĐƠN MỚI — CHƯA PHÁT HÀNH\nTổng tiền: 83\.680\.000 đ\n• Học viên 0 — Toán 9 kỳ 11\/2026: 2\.000\.000 đ/)
  assert.match(text, /… và 12 hóa đơn khác\nSố hóa đơn, RefID: https:\/\/qlhv\.cqt\.vn\/tuition\/invoices$/)
}))

test('giờ tự tạo lại: mốc 15 phút đầu tiên sau ít nhất 10 phút', () => {
  const vn = (hhmm) => Date.parse(`2026-11-22T${hhmm}:00+07:00`)
  assert.equal(service.nextAutoRetryTime(vn('18:23')), '18:45')
  assert.equal(service.nextAutoRetryTime(vn('18:05')), '18:15')
  assert.equal(service.nextAutoRetryTime(vn('23:55')), '00:15')
})

test('nhiều lỗi tạo hóa đơn trong 1 phút → MỘT tin tổng hợp, chia theo cách xử lý', async () => config(async () => {
  const source = name => [{ studentName: name, className: 'Toán 9', month: 11, year: 2026, finalAmount: 1350000 }]
  for (let i = 0; i < 31; i++) service.notifyInvoiceCreationFailed({ recordIds: [`fee-${i}`], reason: 'MISA trả lỗi HTTP 429 ở bước xác thực.', autoRetry: true, sources: source(`Học viên ${i}`) })
  service.notifyInvoiceCreationFailed({ recordIds: ['fee-x'], reason: 'Email người mua không hợp lệ.', sources: source('Người mua sai') })
  service.notifyInvoiceCreationFailed({ recordIds: ['fee-u'], refId: 'ref-u', reason: 'Không nhận được kết quả từ MISA.', outcomeUnknown: true },
    async () => source('Chưa rõ'))
  const messages = []
  const result = await service.flushInvoiceFailureNotifications(async (_url, init) => { messages.push(JSON.parse(init.body).text); return Response.json({ ok: true, result: { message_id: 1 } }) })
  assert.deepEqual(result, { sent: true, count: 33 })
  assert.equal(messages.length, 1)
  const [text] = messages
  assert.match(text, /^❌ 33 HÓA ĐƠN CHƯA TẠO ĐƯỢC/)
  assert.match(text, /Lý do \(31\): MISA trả lỗi HTTP 429/)
  assert.match(text, /🔁 Sẽ tự tạo lại lúc \d\d:\d\d: 31/)
  assert.match(text, /… và 16 phiếu khác/)
  assert.match(text, /✋ Cần kiểm tra và tạo lại bằng tay: 1\n• Người mua sai/)
  assert.match(text, /⚠️ Chưa xác định kết quả[^\n]*: 1\n• Chưa rõ[^\n]*RefID ref-u/)
  assert.equal((await service.flushInvoiceFailureNotifications(async () => { throw Error('không gửi lại') })).count, 0)
}))

test('chỉ một lỗi → tin chi tiết như cũ, kèm giờ tự tạo lại', () => {
  const text = service.invoiceFailureBatchMessage([{ recordIds: ['fee-1'], reason: 'MISA trả lỗi HTTP 429 ở bước xác thực.', autoRetry: true,
    sources: [{ studentName: 'An', className: 'Toán 8', month: 11, year: 2026, finalAmount: 100000 }] }], Date.parse('2026-11-22T18:23:00+07:00'))
  assert.match(text, /^❌ TẠO HÓA ĐƠN KHÔNG THÀNH CÔNG/)
  assert.match(text, /Hệ thống sẽ tự tạo lại lúc 18:45\.\nhttps:\/\/qlhv\.cqt\.vn\/tuition\/invoices$/)
})
