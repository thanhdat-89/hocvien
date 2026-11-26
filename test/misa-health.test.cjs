const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset } = require('./helpers/pg.cjs')
const health = require('../dist/services/misaHealth')
const { misaFetch } = require('../dist/services/misaRateLimit')

beforeEach(async () => { await reset(); health.resetMisaHealth() })
after(() => prisma.$disconnect())

test('lỗi kết nối MISA không gửi Telegram; báo cáo vẫn cho biết đang lỗi nhiều', async () => {
  const sent = []
  const realFetch = global.fetch
  global.fetch = async (url, init) => { sent.push(String(url)); return new Response('{"ok":true}') }
  try {
    const t0 = Date.now()
    for (let i = 0; i < 4; i++) health.recordMisaCall('ok', t0 + i)
    for (let i = 0; i < 6; i++) health.recordMisaCall('http_429', t0 + 10 + i)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(sent.filter(url => url.includes('telegram')).length, 0)
    const report = await health.misaHealthReport(t0 + 100)
    assert.equal(report.alerting, true)
    assert.equal(report.last5Minutes.failures, 6)
    health.resetMisaHealth()
    for (let i = 0; i < 20; i++) health.recordMisaCall(health.outcomeOfStatus(i % 2 ? 400 : 404), t0 + i)
    assert.equal((await health.misaHealthReport(t0 + 100)).alerting, false, 'lỗi dữ liệu (4xx, 404) không tính là lỗi kết nối')
  } finally { global.fetch = realFetch }
})

test('mọi lần gọi qua hàng đợi được đếm theo ngày và ghi vào misa_call_stats', async () => {
  const statuses = [200, 200, 429, 500]
  for (const status of statuses) await misaFetch(async () => new Response('{}', { status }), 'https://misa/x')
  await assert.rejects(misaFetch(async () => { throw new TypeError('fetch failed') }, 'https://misa/x'))
  const report = await health.misaHealthReport()
  const [today] = Object.values(report.days)
  assert.deepEqual(today, { http_429: 1, http_5xx: 1, network: 1, ok: 2 })
  assert.equal(report.last5Minutes.calls, 5)
  assert.equal(report.alerting, true)
  // Ghi lần hai cộng dồn, không ghi đè
  await misaFetch(async () => new Response('{}', { status: 200 }), 'https://misa/x')
  await health.flushMisaCallStats()
  const row = await prisma.misaCallStat.findFirst({ where: { outcome: 'ok' } })
  assert.equal(row.count, 3)
})
