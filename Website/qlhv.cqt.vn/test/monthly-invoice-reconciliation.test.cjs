const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed } = require('./helpers/pg.cjs')
const { createMonthlyInvoiceReconciler, monthlyInvoiceSchedule, monthlyInvoiceReport } = require('../dist/services/monthlyInvoiceReconciliation')
const { saveInvoiceCopies, readInvoice } = require('../dist/services/misaInvoiceStore')

beforeEach(reset)
after(() => prisma.$disconnect())

/** Phiếu học phí tháng 10/2026 (mỗi phiếu một học viên — unique học viên × tháng), mặc định 1.000.000đ, tạo trước giờ chốt. */
async function fee(id, extra = {}) {
  const student = await seed.student({ fullName: 'Học viên thử' })
  const finalAmount = extra.finalAmount ?? 1000000
  return seed.tuition({ id, studentId: student.id, classId: null, className: 'Toán 10', billingMonth: 10, billingYear: 2026,
    baseAmount: finalAmount, finalAmount, remainingAmount: finalAmount, createdAt: new Date(extra.createdAt ?? '2026-10-10T00:00:00.000Z') })
}
const invoice = (ids, doc) => saveInvoiceCopies(ids, { refId: '', invoiceDate: '2026-10-31', recordIds: ids, source: {}, template: {}, buyer: {},
  createdBy: 'test', createdAt: '2026-10-01T00:00:00Z', revision: 0, ...doc })
const run = async () => {
  const row = await prisma.monthlyInvoiceRun.findUnique({ where: { id: '2026-10' } })
  return row && { ...row.data, status: row.status }
}

function fixture(extra = {}) {
  const posts = [], messages = []
  let now = Date.parse('2026-10-31T00:00:00Z')
  const reconciler = createMonthlyInvoiceReconciler({ clock: () => now,
    createInvoice: async (ids, actor, _body, _fetch, options) => {
      posts.push(ids[0]); assert.equal(options.notifications, false); assert.equal(options.positiveAmountOnly, true)
      const created = { status: 'DRAFT_CREATED', createdBy: actor, refId: `ref-${ids[0]}`, source: { finalAmount: 1000000 } }
      await invoice([ids[0]], created)
      return { invoice: created, alreadyExists: false }
    },
    readStatus: async () => { throw new Error('MISA timeout') }, invalidate: async () => {},
    sendTelegram: async text => { messages.push(text); return { sent: true, messageId: messages.length } }, ...extra })
  return { posts, messages, ...reconciler, advance: milliseconds => { now += milliseconds } }
}
async function finish(f, max = 30) {
  for (let i = 0; i < max; i++) {
    await f.tick()
    if ((await run())?.status === 'COMPLETE') return
  }
  throw Error('Job never completed')
}

test('07:00 Vietnam, final day, leap February, rollout and year boundaries', () => {
  for (const date of ['2026-10-30T00:00:00Z', '2026-10-30T23:59:59Z', '2026-09-30T00:00:00Z', '2028-02-28T00:00:00Z']) {
    assert.equal(monthlyInvoiceSchedule(new Date(date)).due, false, date)
  }
  for (const date of ['2026-10-31T00:00:00Z', '2026-11-30T00:00:00Z', '2026-12-31T00:00:00Z', '2028-02-29T00:00:00Z']) {
    const result = monthlyInvoiceSchedule(new Date(date)); assert.equal(result.due, true, date); assert.equal(result.cutoff, date.replace('Z', '.000Z'))
  }
})

test('preview never writes; skips zero and late fees; detects grouped links', async () => {
  await fee('a'); await fee('zero', { finalAmount: 0 }); await fee('late', { createdAt: '2026-10-31T00:00:01Z' })
  await invoice(['group'], { status: 'DRAFT_CREATED', recordIds: ['a', 'other'] })
  // Phiếu âm tiền không còn lưu được: CHECK của tuition_records chặn ở tầng dữ liệu.
  await assert.rejects(fee('bad', { finalAmount: -1 }))
  const f = fixture()
  const before = JSON.stringify([await prisma.tuitionRecord.findMany(), await prisma.misaInvoice.findMany(), await prisma.monthlyInvoiceRun.count()])
  const preview = await f.preview(10, 2026)
  assert.equal(JSON.stringify([await prisma.tuitionRecord.findMany(), await prisma.misaInvoice.findMany(), await prisma.monthlyInvoiceRun.count()]), before)
  assert.equal(preview.entries.find(e => e.id === 'a').linkedInvoiceId, 'group')
  assert.equal(preview.entries.find(e => e.id === 'zero').status, 'SKIPPED_ZERO')
  assert.equal(preview.excludedAfterCutoff, 1)
  assert.equal(f.posts.length, 0)
})

test('whole monthly run creates only missing positive fees, resumes and reports totals', async () => {
  await fee('a'); await fee('b'); await fee('zero', { finalAmount: 0 }); await fee('late', { createdAt: '2026-10-31T01:00:00Z' })
  await invoice(['group'], { status: 'ISSUED', recordIds: ['b', 'linked'] })
  const f = fixture()
  assert.equal((await f.start()).started, true)
  assert.equal((await f.start()).started, false)
  await finish(f)
  assert.deepEqual(f.posts, ['a'])
  const result = await run()
  assert.deepEqual(result.counts, { CREATED: 1, EXISTING: 1, SKIPPED_ZERO: 1 })
  assert.equal(result.totalAmount, 1000000)
  assert.equal(f.messages.length, 1)
  assert.match(f.messages[0], /Bỏ qua 0 đồng \/ miễn toàn bộ: 1/)
  await f.tick(); assert.equal(f.messages.length, 1); assert.equal(f.posts.length, 1)
})

test('concurrent worker delivery claims one lease; no duplicate invoice', async () => {
  await fee('a')
  const f = fixture()
  await f.start()
  await Promise.all([f.tick(), f.tick(), f.tick()])
  assert.deepEqual(f.posts, ['a'])
})

test('unknown, failed and deleted invoice links never get another create request', async () => {
  await fee('a'); await fee('b'); await fee('c')
  await invoice(['a'], { status: 'OUTCOME_UNKNOWN', refId: 'unknown' })
  await invoice(['b'], { status: 'FAILED', refId: 'failed' })
  await invoice(['c'], { status: 'REMOVED_FROM_MISA', refId: 'deleted' })
  const f = fixture()
  await finish(f)
  assert.equal(f.posts.length, 0)
  assert.equal((await run()).counts.REVIEW, 3)
})

test('recovers confirmed RefID and canonical status after interruption without reposting', async () => {
  await fee('a')
  await invoice(['a'], { status: 'OUTCOME_UNKNOWN', refId: 'ref-a', createdBy: 'monthly-invoices:2026-10', source: { finalAmount: 1000000 } })
  const f = fixture({ readStatus: async () => ({ status: 'DRAFT_CREATED' }) })
  await f.start()
  await prisma.monthlyInvoiceRunItem.update({ where: { runId_id: { runId: '2026-10', id: 'a' } }, data: { status: 'PROCESSING' } })
  await finish(f)
  assert.equal(f.posts.length, 0)
  assert.equal((await readInvoice('a')).status, 'DRAFT_CREATED')
  assert.equal((await run()).counts.CREATED, 1)
})

test('Telegram retry only resends report, never recreates invoices', async () => {
  await fee('a')
  let attempts = 0
  const f = fixture({ sendTelegram: async () => ({ sent: ++attempts > 1, errorCode: 'NETWORK_ERROR', messageId: 1 }) })
  await finish(f)
  assert.equal(attempts, 2); assert.equal(f.posts.length, 1)
})

test('stale leases and initialization recover; early ticks never create a job', async () => {
  await fee('a')
  const f = fixture()
  assert.equal((await f.start(new Date('2026-10-16T00:00:00Z'))).reason, 'NOT_DUE')
  await prisma.monthlyInvoiceRun.create({ data: { id: '2026-10', status: 'INITIALIZING', leaseToken: 'dead', leaseUntil: 0n,
    data: { month: 10, year: 2026, cutoff: '2026-10-31T00:00:00Z', startedAt: '2026-10-31T00:00:00Z' } } })
  await finish(f)
  assert.equal(f.posts.length, 1)
})

test('zeroing a fee after snapshot is still excluded', async () => {
  await fee('a')
  const f = fixture()
  await f.start()
  await prisma.tuitionRecord.update({ where: { id: 'a' }, data: { finalAmount: 0, baseAmount: 0 } })
  await finish(f)
  assert.equal(f.posts.length, 0)
  assert.equal((await run()).counts.SKIPPED_ZERO, 1)
})

test('report chunks stay within Telegram limits and include all failure details', () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ id: String(i), studentName: 'Học viên', className: 'Toán', status: 'REVIEW', reason: 'x'.repeat(300) }))
  const report = monthlyInvoiceReport({ month: 10, year: 2026, startedAt: '2026-10-31', reconciledAt: '2026-10-31' }, entries)
  assert(report.messages.length > 1)
  assert(report.messages.every(message => message.length <= 3500))
  assert.match(report.messages[report.messages.length - 1], /phiếu 99/)
})
