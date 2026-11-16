const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, routeHandler } = require('./helpers/pg.cjs')
const router = require('../dist/routes/activity').default

before(reset)
after(() => prisma.$disconnect())

test('activity pagination keeps timestamp ties, filters server-side and rejects invalid cursors', async () => {
  const createdAt = new Date('2026-10-15T07:00:00.000Z')
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: `log${String(25 - i).padStart(2, '0')}`, createdAt, action: i % 2 ? 'CREATE' : 'UPDATE', resourceType: 'tuition',
    userId: 'u', userName: 'U', userRole: 'ADMIN', description: 'd', method: 'POST', path: '/api/tuition', statusCode: 200,
  }))
  await prisma.activityLog.createMany({ data: rows })
  const handler = routeHandler(router, '/', 'get')
  const call = async query => (await handler({ query })).body

  const first = await call({})
  assert.equal(first.data.length, 10)
  const second = await call({ cursor: first.nextCursor, limit: '10' })
  const third = await call({ cursor: second.nextCursor, limit: '10' })
  assert.equal(third.data.length, 5)
  assert.equal(third.nextCursor, null)
  assert.deepEqual([...first.data, ...second.data, ...third.data].map(r => r.id), rows.map(r => r.id), 'Đủ, không trùng, đúng thứ tự (createdAt, id) giảm dần')
  assert.equal(first.data[0].createdAt, '2026-10-15T07:00:00.000Z')

  // Con trỏ kiểu cũ (chỉ timestamp) vẫn dùng được.
  const legacy = await call({ cursor: '2026-10-15T08:00:00.000Z' })
  assert.equal(legacy.data.length, 10)

  const filtered = await call({ action: 'CREATE', resourceType: 'tuition', from: '2026-10-01', to: '2026-10-31' })
  assert.equal(filtered.data.length, 10)
  assert(filtered.data.every(r => r.action === 'CREATE'))

  for (const cursor of ['invalid!', 'bnVsbA', Buffer.from(JSON.stringify({ v: 1, createdAt: createdAt.toISOString(), id: 'bad/id' })).toString('base64url')]) {
    await assert.rejects(call({ cursor }), e => e.status === 400)
  }

  await prisma.activityLog.createMany({ data: Array.from({ length: 120 }, (_, i) => ({ ...rows[0], id: `extra${String(i).padStart(3, '0')}` })) })
  assert.equal((await call({ limit: '1000' })).data.length, 100, 'Tối đa 100 dòng mỗi trang')
})
