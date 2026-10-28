const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('monthly tuition counts overlapping enrollments once and preserves disjoint enrollment periods', async () => {
  const tables = {
    students: [{ id: 's1', fullName: 'Trần Minh Hiếu', gradeLevel: 11 }],
    classes: [{ id: 'c1', name: 'Toán 11 - CQT02', tuitionRate: 300000 }],
    classEnrollments: [
      { id: 'old', studentId: 's1', classId: 'c1', enrollmentDate: '2026-10-11', dropDate: '2026-10-11', status: 'DROPPED', createdAt: '2026-10-11T09:40:03Z' },
      { id: 'new', studentId: 's1', classId: 'c1', enrollmentDate: '2026-10-01', status: 'ACTIVE', createdAt: '2026-10-11T09:40:19Z' },
    ],
    sessions: [1, 4, 8, 11, 15, 18, 22, 25, 29].map(day => ({
      id: `session-${day}`, classId: 'c1', sessionDate: `2026-10-${String(day).padStart(2, '0')}`, status: 'SCHEDULED',
    })),
    tuitionRecords: [{ id: 'fee', studentId: 's1', classId: 'c1', billingMonth: 10, billingYear: 2026, finalAmount: 2700000, status: 'PAID' }],
    payments: [{ id: 'payment', tuitionRecordId: 'fee', amount: 2700000 }],
  }
  const doc = row => ({ id: row?.id, exists: !!row, data: () => row })
  const collection = (name, filters = []) => ({
    doc(id) { return { get: async () => doc((tables[name] || []).find(row => row.id === id)) } },
    where(field, op, value) { return collection(name, [...filters, [field, op, value]]) },
    async get() {
      const docs = (tables[name] || []).filter(row => filters.every(([field, op, value]) => {
        if (op === '==') return row[field] === value
        if (op === '>=') return row[field] >= value
        if (op === '<=') return row[field] <= value
        if (op === 'in') return value.includes(row[field])
        throw Error(`Unsupported operator: ${op}`)
      })).map(doc)
      return { docs, forEach: fn => docs.forEach(fn) }
    },
  })
  const firebase = { db: { collection }, C: {
    STUDENTS: 'students', CLASSES: 'classes', ENROLLMENTS: 'classEnrollments',
    SESSIONS: 'sessions', STUDENT_PROMOTIONS: 'studentPromotions', PRIVATE_SCHEDULES: 'privateSchedules',
    TUITION_RECORDS: 'tuitionRecords', PAYMENTS: 'payments',
  }, toDocs: snap => snap.docs.map(d => ({ id: d.id, ...d.data() })) }
  const original = Module._load
  const path = require.resolve('../dist/services/tuitionScheduleSummary')
  Module._load = function (request) {
    if (request.endsWith('/lib/firebase')) return firebase
    return original.apply(this, arguments)
  }
  try {
    delete require.cache[path]
    const { getTuitionScheduleSummary } = require(path)
    let rows = await getTuitionScheduleSummary(10, 2026, firebase.db)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].totalSessions, 9)
    assert.equal(rows[0].finalAmount, 2700000)
    assert.equal(rows[0].tuitionRecord.paidAmount, 2700000)

    // Applying a fixed discount once prevents multiplying it by the number of enrollments.
    tables.studentPromotions = [{ id: 'promo', studentId: 's1', classId: 'c1', promotionType: 'FIXED_AMOUNT', promotionValue: 100000 }]
    rows = await getTuitionScheduleSummary(10, 2026, firebase.db)
    assert.equal(rows[0].finalAmount, 2600000)

    // A real gap in attendance must remain excluded after re-enrollment.
    tables.classEnrollments[0].enrollmentDate = '2026-10-01'
    tables.classEnrollments[0].dropDate = '2026-10-04'
    tables.classEnrollments[1].enrollmentDate = '2026-10-15'
    tables.classEnrollments[1].customTuitionRate = 200000
    rows = await getTuitionScheduleSummary(10, 2026, firebase.db)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].totalSessions, 7)
    assert.equal(rows[0].baseAmount, 1600000)
    assert.equal(rows[0].finalAmount, 1500000)
  } finally {
    Module._load = original
    delete require.cache[path]
  }
})
