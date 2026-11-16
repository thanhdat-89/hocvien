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

test('notification runs in Vercel background and sends once for a grouped invoice', async () => config(async () => {
  const originalFetch = global.fetch
  const contextSymbol = Symbol.for('@vercel/request-context')
  const oldContext = global[contextSymbol]
  const tasks = []; let sends = 0
  global[contextSymbol] = { get: () => ({ waitUntil: task => tasks.push(task) }) }
  const first = { studentName: 'Student', className: 'Math', month: 7, year: 2026, finalAmount: 100000 }
  const invoice = { source: first, sources: [first, first], invoiceDate: '2026-10-14', refId: 'ref-1', status: 'DRAFT_CREATED' }
  let resolveSend
  global.fetch = async () => { sends++; return new Promise(resolve => { resolveSend = resolve }) }
  try {
    service.notifyInvoiceCreated({ ...invoice, status: 'FAILED' })
    assert.equal(sends, 0)
    service.notifyInvoiceCreated(invoice)
    assert.equal(sends, 1)
    assert.equal(tasks.length, 1)
    resolveSend(Response.json({ ok: true, result: { message_id: 1 } }))
    await Promise.all(tasks)
  } finally {
    global.fetch = originalFetch
    if (oldContext === undefined) delete global[contextSymbol]; else global[contextSymbol] = oldContext
  }
}))
