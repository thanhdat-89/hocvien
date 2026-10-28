const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createMonthlyInvoiceReconciler, monthlyInvoiceSchedule, buildMonthlyInvoiceEntries, monthlyInvoiceReport } = require('../dist/services/monthlyInvoiceReconciliation')

function memoryDb(seed = {}) {
  const values = new Map(Object.entries(seed))
  let queue = Promise.resolve()
  const clone = value => value === undefined ? undefined : structuredClone(value)
  const snap = ref => ({ id: ref.id, ref, exists: values.has(ref.path), data: () => clone(values.get(ref.path)) })
  const doc = path => ({ path, id: path.split('/').at(-1), get: async () => snap(doc(path)),
    set: async (value, options) => values.set(path, clone(options?.merge ? { ...values.get(path), ...value } : value)),
    update: async value => values.set(path, clone({ ...values.get(path), ...value })),
    collection: name => collection(`${path}/${name}`),
  })
  const collection = (path, filters = [], cap = Infinity) => ({
    doc: id => doc(`${path}/${id}`),
    where: (key, op, value) => collection(path, [...filters, [key, op, value]], cap),
    limit: count => collection(path, filters, count),
    get: async () => {
      const docs = [...values].filter(([key, value]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1
        && filters.every(([key, op, target]) => op === 'in' ? target.includes(value[key]) : value[key] === target))
        .slice(0, cap).map(([key]) => snap(doc(key)))
      return { docs, empty: !docs.length, size: docs.length }
    },
  })
  return { values, collection,
    runTransaction: callback => {
      const execute = async () => {
        const writes = []
        const result = await callback({ get: ref => ref.get(), set: (...args) => writes.push(() => args[0].set(...args.slice(1))),
          update: (...args) => writes.push(() => args[0].update(...args.slice(1))) })
        for (const write of writes) await write()
        return result
      }
      const result = queue.then(execute)
      queue = result.catch(() => {})
      return result
    },
    batch: () => { const writes = []; return { set: (ref, value) => writes.push(() => ref.set(value)), commit: async () => { for (const write of writes) await write() } } },
  }
}
const fee = (extra = {}) => ({ billingMonth: 10, billingYear: 2026, studentName: 'Học viên thử', className: 'Toán 10',
  finalAmount: 1000000, createdAt: '2026-10-10T00:00:00.000Z', ...extra })
function fixture(seed, extra = {}) {
  const db = memoryDb(seed), posts = [], messages = []
  let now = Date.parse('2026-10-31T00:00:00Z')
  const reconciler = createMonthlyInvoiceReconciler({ db, clock: () => now,
    createInvoice: async (ids, actor, _body, _fetch, options) => {
      posts.push(ids[0]); assert.equal(options.notifications, false); assert.equal(options.positiveAmountOnly, true)
      const invoice = { status: 'DRAFT_CREATED', createdBy: actor, refId: `ref-${ids[0]}`, source: { finalAmount: 1000000 } }
      db.values.set(`misaInvoices/${ids[0]}`, invoice)
      return { invoice, alreadyExists: false }
    },
    readStatus: async () => { throw new Error('MISA timeout') }, invalidate: async () => {},
    sendTelegram: async text => { messages.push(text); return { sent: true, messageId: messages.length } }, ...extra })
  return { db, posts, messages, ...reconciler, advance: milliseconds => { now += milliseconds } }
}
async function finish(f, max = 30) {
  for (let i = 0; i < max; i++) {
    await f.tick()
    if (f.db.values.get('monthlyInvoiceRuns/2026-10')?.status === 'COMPLETE') return
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

test('preview never writes; skips zero, invalid amounts and late fees; detects grouped links', async () => {
  const f = fixture({ 'tuitionRecords/a': fee(), 'tuitionRecords/zero': fee({ finalAmount: 0 }),
    'tuitionRecords/bad': fee({ finalAmount: -1 }), 'tuitionRecords/late': fee({ createdAt: '2026-10-31T00:00:01Z' }),
    'misaInvoices/group': { status: 'DRAFT_CREATED', recordIds: ['a', 'other'] } })
  const before = structuredClone([...f.db.values])
  const preview = await f.preview(10, 2026)
  assert.deepEqual([...f.db.values], before)
  assert.equal(preview.entries.find(e => e.id === 'a').linkedInvoiceId, 'group')
  assert.equal(preview.entries.find(e => e.id === 'zero').status, 'SKIPPED_ZERO')
  assert.equal(preview.entries.find(e => e.id === 'bad').status, 'REVIEW')
  assert.equal(preview.excludedAfterCutoff, 1)
  assert.equal(f.posts.length, 0)
})

test('whole monthly run creates only missing positive fees, resumes and reports totals', async () => {
  const f = fixture({ 'tuitionRecords/a': fee(), 'tuitionRecords/b': fee(), 'tuitionRecords/zero': fee({ finalAmount: 0 }),
    'tuitionRecords/late': fee({ createdAt: '2026-10-31T01:00:00Z' }),
    'misaInvoices/group': { status: 'ISSUED', recordIds: ['b', 'linked'] } })
  assert.equal((await f.start()).started, true)
  assert.equal((await f.start()).started, false)
  await finish(f)
  assert.deepEqual(f.posts, ['a'])
  const run = f.db.values.get('monthlyInvoiceRuns/2026-10')
  assert.deepEqual(run.counts, { CREATED: 1, EXISTING: 1, SKIPPED_ZERO: 1 })
  assert.equal(run.totalAmount, 1000000)
  assert.equal(f.messages.length, 1)
  assert.match(f.messages[0], /Bỏ qua 0 đồng \/ miễn toàn bộ: 1/)
  await f.tick(); assert.equal(f.messages.length, 1); assert.equal(f.posts.length, 1)
})

test('concurrent worker delivery claims one lease; no duplicate invoice', async () => {
  const f = fixture({ 'tuitionRecords/a': fee() })
  await f.start()
  await Promise.all([f.tick(), f.tick(), f.tick()])
  assert.deepEqual(f.posts, ['a'])
})

test('unknown, failed and deleted invoice links never get another create request', async () => {
  const f = fixture({ 'tuitionRecords/a': fee(), 'tuitionRecords/b': fee(), 'tuitionRecords/c': fee(),
    'misaInvoices/a': { status: 'OUTCOME_UNKNOWN', refId: 'unknown' },
    'misaInvoices/b': { status: 'FAILED', refId: 'failed' },
    'misaInvoices/c': { status: 'REMOVED_FROM_MISA', refId: 'deleted' } })
  await finish(f)
  assert.equal(f.posts.length, 0)
  assert.equal(f.db.values.get('monthlyInvoiceRuns/2026-10').counts.REVIEW, 3)
})

test('recovers confirmed RefID and canonical status after interruption without reposting', async () => {
  const f = fixture({ 'tuitionRecords/a': fee(),
    'misaInvoices/a': { status: 'OUTCOME_UNKNOWN', refId: 'ref-a', createdBy: 'monthly-invoices:2026-10', source: { finalAmount: 1000000 } } },
  { readStatus: async () => ({ status: 'DRAFT_CREATED' }) })
  await f.start()
  f.db.values.get('monthlyInvoiceRuns/2026-10/items/a').status = 'PROCESSING'
  await finish(f)
  assert.equal(f.posts.length, 0)
  assert.equal(f.db.values.get('misaInvoices/a').status, 'DRAFT_CREATED')
  assert.equal(f.db.values.get('monthlyInvoiceRuns/2026-10').counts.CREATED, 1)
})

test('Telegram retry only resends report, never recreates invoices', async () => {
  let attempts = 0
  const f = fixture({ 'tuitionRecords/a': fee() }, { sendTelegram: async () => ({ sent: ++attempts > 1, errorCode: 'NETWORK_ERROR', messageId: 1 }) })
  await finish(f)
  assert.equal(attempts, 2); assert.equal(f.posts.length, 1)
})

test('stale leases and initialization recover; early ticks never create a job', async () => {
  const f = fixture({ 'tuitionRecords/a': fee() })
  assert.equal((await f.start(new Date('2026-10-16T00:00:00Z'))).reason, 'NOT_DUE')
  f.db.values.set('monthlyInvoiceRuns/2026-10', { month: 10, year: 2026, cutoff: '2026-10-31T00:00:00Z',
    startedAt: '2026-10-31T00:00:00Z', status: 'INITIALIZING', leaseUntil: 0, leaseToken: 'dead' })
  await finish(f)
  assert.equal(f.posts.length, 1)
})

test('zeroing a fee after snapshot is still excluded', async () => {
  const f = fixture({ 'tuitionRecords/a': fee() })
  await f.start(); f.db.values.get('tuitionRecords/a').finalAmount = 0
  await finish(f)
  assert.equal(f.posts.length, 0)
  assert.equal(f.db.values.get('monthlyInvoiceRuns/2026-10').counts.SKIPPED_ZERO, 1)
})

test('report chunks stay within Telegram limits and include all failure details', () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ id: String(i), studentName: 'Học viên', className: 'Toán', status: 'REVIEW', reason: 'x'.repeat(300) }))
  const report = monthlyInvoiceReport({ month: 10, year: 2026, startedAt: '2026-10-31', reconciledAt: '2026-10-31' }, entries)
  assert(report.messages.length > 1)
  assert(report.messages.every(message => message.length <= 3500))
  assert.match(report.messages.at(-1), /phiếu 99/)
})
