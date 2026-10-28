const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const filename = require('node:path').resolve(__dirname, '../frontend/src/services/invoiceStatusSync.ts')
const compiled = new Module(filename, module)
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { syncInvoiceStatuses } = compiled.exports
const row = (id, refId = id, status = 'DRAFT_CREATED') => ({ id, refId, status })

test('collects all pages before writes; deduplicates grouped RefIDs and includes issued invoices', async () => {
  const events = [], progress = []
  const result = await syncInvoiceStatuses({
    list: async cursor => {
      events.push(`list:${cursor || 'first'}`)
      return cursor ? { rows: [row('linked', 'ref1'), row('issued', 'ref2', 'SENT_TO_TAX'), row('failed', 'ref3', 'FAILED')], nextCursor: null }
        : { rows: [row('fee1', 'ref1')], nextCursor: 'page2' }
    },
    refresh: async id => events.push(`refresh:${id}`),
    cancelled: () => false,
    progress: (done, total) => progress.push([done, total]),
  })
  assert.deepEqual(events, ['list:first', 'list:page2', 'refresh:linked', 'refresh:issued'])
  assert.deepEqual(result, { completed: 2, failed: 0 })
  assert.deepEqual(progress.at(-1), [2, 2])
})

test('limits concurrency to two and continues after individual provider failures', async () => {
  let active = 0, max = 0
  const refreshed = []
  const result = await syncInvoiceStatuses({
    list: async () => ({ rows: [row('a'), row('b'), row('c'), row('d')], nextCursor: null }),
    refresh: async id => {
      active++; max = Math.max(max, active)
      await new Promise(resolve => setImmediate(resolve))
      active--; refreshed.push(id)
      if (id === 'b') throw new Error('MISA unavailable')
    },
    cancelled: () => false, progress() {},
  })
  assert.equal(max, 2)
  assert.equal(refreshed.length, 4)
  assert.deepEqual(result, { completed: 4, failed: 1 })
})

test('cancels queued work when the selected billing period changes', async () => {
  let cancelled = false, writes = 0
  const result = await syncInvoiceStatuses({
    list: async () => ({ rows: [row('a'), row('b'), row('c')], nextCursor: null }),
    refresh: async () => { writes++; cancelled = true },
    cancelled: () => cancelled, progress() {},
  })
  assert.equal(writes, 1)
  assert.equal(result, null)
})

test('pagination errors never start status updates', async () => {
  let writes = 0
  await assert.rejects(syncInvoiceStatuses({
    list: async cursor => { if (cursor) throw new Error('version changed'); return { rows: [row('a')], nextCursor: 'next' } },
    refresh: async () => { writes++ }, cancelled: () => false, progress() {},
  }), /version changed/)
  assert.equal(writes, 0)
})
