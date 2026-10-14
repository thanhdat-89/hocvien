const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('legacy Supabase flags cannot activate sync, fallback, reporting or export reads', async () => {
  const keys = ['SUPABASE_DUAL_WRITE', 'STUDENTS_READ_SOURCE', 'REPORTS_READ_SOURCE', 'REPORTS_SECRET']
  const previous = keys.map(key => process.env[key])
  Object.assign(process.env, {
    SUPABASE_DUAL_WRITE: 'true', STUDENTS_READ_SOURCE: 'supabase',
    REPORTS_READ_SOURCE: 'supabase', REPORTS_SECRET: 'test-secret',
  })
  const originalLoad = Module._load
  const loaded = []
  const reads = []
  let readError
  const query = {
    where() { return this }, orderBy() { return this },
    offset() { return this }, limit() { return this },
    count() { return { get: async () => {
      if (readError) throw readError
      return { data: () => ({ count: 0 }) }
    } } },
    async get() {
      if (readError) throw readError
      return { docs: [], size: 0, empty: true }
    },
  }
  const store = { settings() {}, collection(path) { reads.push(path); return query } }
  const admin = { apps: [{}], firestore: () => store }
  admin.firestore.Timestamp = class Timestamp {}
  const summaryCalls = []
  Module._load = function (request, parent, isMain) {
    assert.doesNotMatch(request, /supabase|firestoreMirror|^pg$/i)
    if (request === 'firebase-admin') return admin
    if (request.endsWith('/tuitionScheduleSummary')) return {
      async getTuitionScheduleSummary(...args) {
        summaryCalls.push(args)
        return [{ studentId: 's1', studentName: 'Học viên', className: 'Toán',
          totalSessions: 4, ratePerSession: 100000, discountAmount: 50000, finalAmount: 350000 }]
      },
    }
    const result = originalLoad.call(this, request, parent, isMain)
    if (parent && request.startsWith('.')) {
      const path = Module._resolveFilename(request, parent)
      if (path.includes('/dist/')) loaded.push(path)
    }
    return result
  }
  const handler = (router, path) => router.stack.find(layer => layer.route?.path === path && layer.route.methods.get).route.stack[0].handle
  try {
    const firebase = require('../dist/lib/firebase')
    assert.equal(firebase.db, store)
    const students = require('../dist/routes/students').default
    require('../dist/routes/dashboard')
    const reports = require('../dist/routes/reports').default
    const { buildTuitionExport } = require('../dist/services/tuitionExport')
    let body
    let error
    const res = { json(value) { body = value }, setHeader() {}, status() { return this } }
    await handler(students, '/')({ query: {} }, res, err => { error = err })
    assert.equal(error, undefined)
    assert.equal(body.total, 0)
    readError = Object.assign(new Error('quota exhausted'), { code: 8 })
    await handler(students, '/')({ query: {} }, res, err => { error = err })
    assert.equal(error, readError)
    readError = undefined
    await handler(reports, '/snapshot')({ query: { kind: 'month' }, headers: { authorization: 'Bearer test-secret' } }, res, err => { throw err })
    assert.equal(body.totalStudents, 0)
    assert.ok(reads.includes('tuitionRecords'))
    assert.ok(reads.every(path => !path.includes('SyncQueue')))
    const result = await buildTuitionExport(10, 2026)
    assert.equal(result.source, 'firebase')
    assert.equal(result.tuitionDue, 350000)
    assert.deepEqual(summaryCalls, [[10, 2026]])
  } finally {
    Module._load = originalLoad
    loaded.forEach(path => { delete require.cache[path] })
    keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i])
  }
})
