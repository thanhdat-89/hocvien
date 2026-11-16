const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const { prisma, reset, seed, routeHandler, newId, context } = require('./helpers/pg.cjs')
const { runInScope } = require('../dist/lib/scope')
const { raiseAlert } = require('../dist/services/adminAlerts')
const { studentShortId } = require('../dist/services/sepayMatcher')
const alerts = require('../dist/routes/alerts').default

beforeEach(reset)

const inBranch = (branchId, fn) => runInScope({ branchIds: [branchId], schoolYearId: null }, fn)

test('SePay thử nghiệm chỉ lưu giao dịch, không tạo cảnh báo cần xử lý', async () => {
  process.env.SEPAY_WEBHOOK_KEY = 'test-key'
  process.env.SEPAY_SKIP_IP_CHECK = 'true'
  await context()
  const student = await seed.student()
  const handler = routeHandler(require('../dist/routes/webhooks').default, '/sepay', 'post')
  const send = (id, content) => handler({
    body: { id, gateway: 'VPBank', transactionDate: '2026-10-15 10:20:30', accountNumber: '1', content, transferType: 'in', transferAmount: 500000, accumulated: 1, referenceCode: 'FT', description: '' },
    header: name => ({ authorization: 'Apikey test-key' })[name.toLowerCase()], ip: '127.0.0.1',
  })
  assert.equal((await send(1001, 'chuyen tien an trua')).body.status, 'pending_review')
  assert.equal((await send(1002, `HP T10 ${studentShortId(student.id)}`)).body.status, 'pending_review')
  assert.equal(await prisma.adminAlert.count(), 0)
  // Webhook gửi lại cùng giao dịch: không tạo cảnh báo trùng
  await send(1001, 'chuyen tien an trua')
  assert.equal(await prisma.adminAlert.count(), 0)
  assert.equal(await prisma.bankTransaction.count(), 2)
})

test('chuông chỉ hiện cảnh báo hoạt động, lọc SePay thử nghiệm; giữ phạm vi cơ sở', async () => {
  const { branchId: A } = await context()
  const B = (await prisma.branch.create({ data: { id: newId(), name: 'Cơ sở B' } })).id
  const a = await seed.student(), b = await seed.student({ branchId: B })
  await raiseAlert('overdue_reminder_cap', 'A', { studentId: a.id })
  await raiseAlert('misa_invoice_failed', 'B', { studentId: b.id })
  await raiseAlert('sepay_unmatched', 'chung', { studentId: null })
  const user = { userId: (await seed.user({ role: 'STAFF' })).id, role: 'STAFF' }
  const list = () => routeHandler(alerts, '/', 'get')({ user })

  const seenA = await inBranch(A, list)
  assert.deepEqual([seenA.body.items.map(i => i.message).sort(), seenA.body.unread], [['A'], 1])
  await inBranch(A, () => routeHandler(alerts, '/read-all', 'post')({ user }))
  assert.equal((await inBranch(A, list)).body.unread, 0)
  const seenB = await inBranch(B, list)
  assert.deepEqual([seenB.body.items.map(i => i.message).sort(), seenB.body.unread], [['B'], 1], 'đọc ở A không đụng cảnh báo riêng của B')
  const onlyB = seenB.body.items.find(i => i.message === 'B')
  await assert.rejects(inBranch(A, () => routeHandler(alerts, '/:id/read', 'post')({ user, params: { id: onlyB.id } })), err => err.code === 'P2025')

  const [, gate] = alerts.stack.filter(layer => !layer.route).map(layer => layer.handle)
  const status = await new Promise(resolve => gate({ user: { userId: 'u', role: 'TEACHER' } }, { status(c) { resolve(c); return this }, json() { return this } }, () => resolve(200)))
  assert.equal(status, 403)
})

test('bất thường của lần kiểm tra lớp thành cảnh báo theo cơ sở của lớp, mỗi bất thường một lần mỗi tháng', async () => {
  const { alertClassAudit } = require('../dist/services/adminAlerts')
  await context()
  const B = (await prisma.branch.create({ data: { id: newId(), name: 'Cơ sở B' } })).id
  const klass = await seed.klass({ name: 'Toán 9 - CQT01', branchId: B })
  const student = await seed.student({ fullName: 'Lê C', branchId: B })
  const anomalies = [
    { type: 'MISSING_MONTH_SESSIONS', classId: klass.id, count: 3 },
    { type: 'TUITION_RECORD_DIFFERS', classId: klass.id, studentId: student.id, calculatedAmount: 800000, recordedAmount: 600000 },
  ]
  assert.equal(await alertClassAudit('2026-10', anomalies), 2)
  assert.equal(await alertClassAudit('2026-10', anomalies), 0, 'sáng hôm sau vẫn còn bất thường: không báo lại')
  assert.equal(await alertClassAudit('2026-11', anomalies.slice(0, 1)), 1, 'sang tháng mới thì báo lại')
  const rows = await prisma.adminAlert.findMany({ where: { data: { path: ['period'], equals: '2026-10' } }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(rows.map(r => r.branchId), [B, B])
  assert.match(rows[0].message, /Toán 9 - CQT01 có lịch học nhưng chưa có buổi nào trong tháng 10\/2026/)
  assert.match(rows[1].message, /Lê C .* 600\.000đ, tính lại theo buổi học được 800\.000đ/)
})

test('hoá đơn tạo xong thì cảnh báo hoá đơn được đánh dấu đã xử lý, kể cả khi đã đọc; không đụng phiếu khác', async () => {
  const { resolveInvoiceAlerts } = require('../dist/services/adminAlerts')
  const s = await seed.student()
  await raiseAlert('misa_invoice_failed', 'lỗi 1', { studentId: s.id, recordIds: ['r1'] })
  await raiseAlert('misa_invoice_failed', 'lỗi 2', { studentId: s.id, recordIds: ['r2'] })
  await prisma.adminAlert.updateMany({ where: { message: 'lỗi 1' }, data: { read: true } })
  assert.equal(await resolveInvoiceAlerts(['r1']), 1)
  assert.equal(await resolveInvoiceAlerts(['r1']), 0, 'đã xử lý thì không đóng lại')
  const rows = Object.fromEntries((await prisma.adminAlert.findMany({ where: { type: 'misa_invoice_failed', message: { startsWith: 'lỗi' } } })).map(a => [a.message, a]))
  assert.ok(rows['lỗi 1'].resolvedAt && rows['lỗi 1'].read)
  assert.equal(rows['lỗi 2'].resolvedAt, null)
})
