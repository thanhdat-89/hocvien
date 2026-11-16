const { test } = require('node:test')
const assert = require('node:assert/strict')
const { listInvoiceTemplates, invoiceApi, InvoicePreviewError } = require('../dist/services/misaInvoicePreview')

const template = { IPTemplateID: 'template-1', InvSeries: '2C26MHP', InvTemplateNo: '2', TemplateName: 'Sales' }
const response = data => Response.json({ Success: true, Data: data })
async function configured(run) {
  const keys = ['MEINVOICE_CLIENT_ID', 'MEINVOICE_CLIENT_SECRET', 'MEINVOICE_TAXCODE', 'MEINVOICE_USERNAME', 'MEINVOICE_PASSWORD']
  const old = keys.map(key => process.env[key])
  keys.forEach(key => { process.env[key] = 'fixture-value' })
  try { await run() } finally {
    keys.forEach((key, i) => old[i] === undefined ? delete process.env[key] : process.env[key] = old[i])
  }
}

test('template lookup recovers from one network timeout without repeating authentication', async () => configured(async () => {
  let tokens = 0, lookups = 0
  const templates = await listInvoiceTemplates(2026, async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal)
    if (url.endsWith('/token')) { tokens++; return response('token') }
    if (++lookups === 1) throw new DOMException('timeout', 'TimeoutError')
    return response([template])
  })
  assert.equal(tokens, 1)
  assert.equal(lookups, 2)
  assert.equal(templates[0].id, 'template-1')
}))

test('permanent network failure stops after two lookup attempts', async () => configured(async () => {
  let lookups = 0
  await assert.rejects(listInvoiceTemplates(2026, async url => {
    if (url.endsWith('/token')) return response('token')
    lookups++
    throw new TypeError('fetch failed')
  }), error => error instanceof InvoicePreviewError && /lấy mẫu hóa đơn/.test(error.message))
  assert.equal(lookups, 2)
}))

test('provider rejection is not retried', async () => configured(async () => {
  let calls = 0
  await assert.rejects(listInvoiceTemplates(2026, async () => {
    calls++
    return Response.json({ Success: false, ErrorCode: 'INVALID_CREDENTIALS' })
  }), /INVALID_CREDENTIALS/)
  assert.equal(calls, 1)
}))

test('lookup retry policy never repeats an invoice write', async () => configured(async () => {
  let writes = 0
  const api = await invoiceApi(async url => {
    if (url.endsWith('/token')) return response('token')
    writes++
    throw new TypeError('fetch failed')
  })
  await assert.rejects(api.call('/invoices', { method: 'POST' }), InvoicePreviewError)
  assert.equal(writes, 1)
}))
