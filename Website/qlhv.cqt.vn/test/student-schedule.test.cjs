const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('student schedule respects every enrollment period when leaving and rejoining a class', async () => {
  const enrollments = [
    { id: 'old', studentId: 's1', classId: 'c1', enrollmentDate: '2026-08-05', dropDate: '2026-08-05', status: 'DROPPED', customTuitionRate: 100000 },
    { id: 'active', studentId: 's1', classId: 'c1', enrollmentDate: '2026-08-01', status: 'ACTIVE', customTuitionRate: 120000 },
  ]
  const dates = ['2026-07-31', '2026-08-01', '2026-08-05', '2026-08-06', '2026-09-30',
    '2026-10-03', '2026-10-06', '2026-10-10', '2026-10-13', '2026-10-17', '2026-10-20', '2026-10-24', '2026-10-27', '2026-10-31']
  const sessions = dates.map(sessionDate => ({ id: sessionDate, classId: 'c1', sessionDate, startTime: '18:00', status: 'SCHEDULED' }))
  const tables = { classEnrollments: enrollments, classes: [{ id: 'c1', name: 'Toán 6 - CQT01', tuitionRate: 150000 }], sessions }
  const doc = row => ({ id: row?.id, exists: !!row, data: () => row })
  const query = (name, filters = []) => ({
    where(field, op, value) {
      assert.equal(op, '==')
      return query(name, [...filters, [field, value]])
    },
    async get() { return { docs: tables[name].filter(row => filters.every(([field, value]) => row[field] === value)).map(doc) } },
    doc(id) { return { async get() { return doc(tables[name].find(row => row.id === id)) } } },
  })
  const original = Module._load
  Module._load = function (request) {
    if (request.endsWith('/firebase')) return {
      db: { collection: query }, C: { ENROLLMENTS: 'classEnrollments', CLASSES: 'classes', SESSIONS: 'sessions' },
      toDocs: snap => snap.docs.map(d => ({ id: d.id, ...d.data() })),
    }
    return original.apply(this, arguments)
  }
  try {
    const router = require('../dist/routes/students').default
    const handler = router.stack.find(layer => layer.route?.path === '/:id/schedule').route.stack.at(-1).handle
    const load = async month => {
      let body
      await handler({ params: { id: 's1' }, query: { month: String(month), year: '2026' } },
        { json(value) { body = value } }, err => { throw err })
      return body
    }
    const october = await load(10)
    assert.equal(october.length, 9)
    assert.equal(new Set(october.map(s => s.id)).size, 9)
    assert.ok(october.every(s => s.ratePerSession === 120000 && s.className === 'Toán 6 - CQT01'))
    assert.deepEqual((await load(8)).map(s => s.sessionDate), ['2026-08-06', '2026-08-05', '2026-08-01'])
    enrollments.reverse()
    assert.deepEqual(await load(10), october, 'Firestore document order must not affect the schedule')

    // Separate enrollment periods: preserve old history and hide the gap.
    enrollments.find(e => e.id === 'active').enrollmentDate = '2026-10-01'
    assert.deepEqual((await load(8)).map(s => [s.sessionDate, s.ratePerSession]), [['2026-08-05', 100000]])
    assert.deepEqual(await load(9), [])
    assert.equal((await load(10)).length, 9)

    enrollments.splice(enrollments.findIndex(e => e.id === 'active'), 1)
    assert.deepEqual(await load(10), [], 'Dropped-only students must not see later sessions')
    enrollments.length = 0
    assert.deepEqual(await load(10), [])
  } finally {
    Module._load = original
    delete require.cache[require.resolve('../dist/routes/students')]
  }
})
