const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildTuitionScheduleSummary } = require('../dist/services/tuitionScheduleSummary')

test('monthly tuition counts overlapping enrollments once and preserves disjoint enrollment periods', () => {
  const data = {
    students: [{ id: 's1', fullName: 'Trần Minh Hiếu', gradeLevel: 11 }],
    classes: [{ id: 'c1', name: 'Toán 11 - CQT02', tuitionRate: 300000 }],
    enrollments: [
      { id: 'old', studentId: 's1', classId: 'c1', enrollmentDate: '2026-10-11', dropDate: '2026-10-11', status: 'DROPPED', createdAt: '2026-10-11T09:40:03Z' },
      { id: 'new', studentId: 's1', classId: 'c1', enrollmentDate: '2026-10-01', status: 'ACTIVE', createdAt: '2026-10-11T09:40:19Z' },
    ],
    sessions: [1, 4, 8, 11, 15, 18, 22, 25, 29].map(day => ({
      id: `session-${day}`, classId: 'c1', sessionDate: `2026-10-${String(day).padStart(2, '0')}`, status: 'SCHEDULED',
    })),
    promotions: [],
    privateSessions: [],
    records: [{ id: 'fee', studentId: 's1', classId: 'c1', billingMonth: 10, billingYear: 2026, finalAmount: 2700000, status: 'PAID' }],
    paidByRecord: new Map([['fee', 2700000]]),
  }

  let rows = buildTuitionScheduleSummary(data, 10, 2026)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].totalSessions, 9)
  assert.equal(rows[0].finalAmount, 2700000)
  assert.equal(rows[0].tuitionRecord.paidAmount, 2700000)

  // Applying a fixed discount once prevents multiplying it by the number of enrollments.
  data.promotions = [{ id: 'promo', studentId: 's1', classId: 'c1', promotionType: 'FIXED_AMOUNT', promotionValue: 100000 }]
  rows = buildTuitionScheduleSummary(data, 10, 2026)
  assert.equal(rows[0].finalAmount, 2600000)

  // A real gap in attendance must remain excluded after re-enrollment.
  data.enrollments[0].enrollmentDate = '2026-10-01'
  data.enrollments[0].dropDate = '2026-10-04'
  data.enrollments[1].enrollmentDate = '2026-10-15'
  data.enrollments[1].customTuitionRate = 200000
  rows = buildTuitionScheduleSummary(data, 10, 2026)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].totalSessions, 7)
  assert.equal(rows[0].baseAmount, 1600000)
  assert.equal(rows[0].finalAmount, 1500000)
})
