const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('activity pagination reads at most 11 documents, keeps timestamp ties, filters server-side and rejects invalid cursors', async () => {
  const originalLoad = Module._load
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `log${String(25 - i).padStart(2, '0')}`, createdAt: '2026-10-15T07:00:00.000Z', action: i % 2 ? 'CREATE' : 'UPDATE', resourceType: 'tuition' }))
  const queries = []
  function query(state = { orders: [], filters: [], after: null, limit: null }) {
    return {
      orderBy(field, direction) { return query({ ...state, orders: [...state.orders, [field, direction]] }) },
      where(...filter) { return query({ ...state, filters: [...state.filters, filter] }) },
      startAfter(...after) { return query({ ...state, after }) },
      limit(limit) { return query({ ...state, limit }) },
      offset() { throw Error('Offsets read skipped documents') },
      count() { throw Error('No total-count query needed') },
      doc() { throw Error('Cursor must not require an extra document lookup') },
      async get() {
        assert.equal(state.limit > 0, true, 'Every query must be bounded')
        let data = rows.filter(row => state.filters.every(([field, op, value]) => op === '==' ? row[field] === value : op === '>=' ? row[field] >= value : row[field] <= value))
        if (state.after) data = data.filter(row => row.createdAt < state.after[0] || (state.after.length === 2 && row.createdAt === state.after[0] && row.id < state.after[1]))
        data = data.slice(0, state.limit)
        queries.push({ ...state, reads: data.length })
        return { docs: data.map(row => ({ id: row.id, data: () => row })) }
      },
    }
  }
  Module._load = function(request, parent, isMain) {
    if (request === '../lib/firebase') return { db: { collection: () => query() }, C: { ACTIVITY_LOGS: 'activityLogs' }, admin: { firestore: { FieldPath: { documentId: () => '__name__' } } }, toDocs: snap => snap.docs.map(d => ({ id: d.id, ...d.data() })) }
    return originalLoad.call(this, request, parent, isMain)
  }
  const path = require.resolve('../dist/routes/activity')
  const oldModule = require.cache[path]
  delete require.cache[path]
  try {
    const router = require(path).default
    const handler = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.get).route.stack.at(-1).handle
    const call = async query => {
      let output, error
      await handler({ query }, { json: value => { output = value } }, e => { error = e })
      if (error) throw error
      return output
    }
    const first = await call({})
    assert.equal(first.data.length, 10)
    assert.equal(queries[0].reads, 11)
    assert.deepEqual(queries[0].orders, [['createdAt', 'desc'], ['__name__', 'desc']])
    const second = await call({ cursor: first.nextCursor, limit: '10' })
    const third = await call({ cursor: second.nextCursor, limit: '10' })
    assert.equal(third.data.length, 5)
    assert.equal(third.nextCursor, null)
    assert.deepEqual([...first.data, ...second.data, ...third.data].map(r => r.id), rows.map(r => r.id))
    assert.equal(queries[1].reads, 11)
    assert.equal(queries[2].reads, 5)
    const filtered = await call({ action: 'CREATE', resourceType: 'tuition', from: '2026-10-01', to: '2026-10-31' })
    assert.equal(filtered.data.length, 10)
    assert(filtered.data.every(r => r.action === 'CREATE'))
    const before = queries.length
    for (const cursor of ['invalid!', 'bnVsbA', Buffer.from(JSON.stringify({ v: 1, createdAt: rows[0].createdAt, id: 'bad/id' })).toString('base64url')]) {
      await assert.rejects(call({ cursor }), e => e.status === 400)
    }
    assert.equal(queries.length, before, 'Invalid cursors must not read Firestore')
    await call({ limit: '1000' })
    assert.equal(queries.at(-1).limit, 101)
  } finally {
    Module._load = originalLoad
    if (oldModule) require.cache[path] = oldModule; else delete require.cache[path]
  }
})
