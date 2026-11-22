const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset } = require('./helpers/pg.cjs')
const health = require('../dist/services/misaHealth')
const { misaFetch } = require('../dist/services/misaRateLimit')

let messages
beforeEach(async () => { await reset(); messages = []; health.resetMisaHealth(async text => { messages.push(text) }) })
after(() => prisma.$disconnect())

test('tỉ lệ lỗi > 10% trong 5 phút → MỘT cảnh báo; hết lỗi → một tin ổn định lại', () => {
  const t0 = Date.parse('2026-11-22T18:00:00+07:00')
  for (let i = 0; i < 4; i++) health.recordMisaCall('ok', t0 + i)
  assert.equal(messages.length, 0)
  health.recordMisaCall('http_429', t0 + 10)
  assert.equal(messages.length, 1)
  assert.match(messages[0], /KẾT NỐI MISA ĐANG LỖI NHIỀU\n1\/5 yêu cầu lỗi[\s\S]*quá tải \(429\): 1/)
  for (let i = 0; i < 20; i++) health.recordMisaCall('http_429', t0 + 20 + i)
  assert.equal(messages.length, 1, 'không gửi lặp lại khi vẫn đang lỗi')
  health.recordMisaCall('ok', t0 + 6 * 60_000)   // lỗi cũ đã ra khỏi cửa sổ 5 phút
  assert.equal(messages.length, 2)
  assert.match(messages[1], /ĐÃ ỔN ĐỊNH LẠI/)
})

test('ít lần gọi hoặc lỗi dữ liệu (4xx, 404) không gây cảnh báo', () => {
  const t0 = Date.now()
  for (let i = 0; i < 4; i++) health.recordMisaCall('network', t0 + i)
  for (let i = 0; i < 10; i++) health.recordMisaCall(health.outcomeOfStatus(i % 2 ? 400 : 404), t0 + 10 + i)
  assert.equal(messages.length, 1, '4 lỗi mạng / 14 lần gọi > 10% thì vẫn báo')
  health.resetMisaHealth(async text => { messages.push(text) }); messages.length = 0
  for (let i = 0; i < 20; i++) health.recordMisaCall(health.outcomeOfStatus(400), t0 + i)
  assert.equal(messages.length, 0)
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
