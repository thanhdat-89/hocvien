const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildTuitionScheduleSummary } = require('../dist/services/tuitionScheduleSummary')
const { enrollmentCoversSession, weekdaysOn } = require('../dist/lib/enrollmentDays')

// Tháng 12/2026: T3 có 5 buổi (1, 8, 15, 22, 29), T7 có 4 buổi (5, 12, 19, 26), CN có 4 buổi (6, 13, 20, 27).
const tue = [1, 8, 15, 22, 29].map(d => `2026-12-${String(d).padStart(2, '0')}`)
const sat = [5, 12, 19, 26].map(d => `2026-12-${String(d).padStart(2, '0')}`)
const sun = [6, 13, 20, 27].map(d => `2026-12-${String(d).padStart(2, '0')}`)
const sessions = (classId, dates) => dates.map(sessionDate => ({ id: `${classId}-${sessionDate}`, classId, sessionDate, status: 'SCHEDULED' }))

const base = () => ({
  students: [{ id: 's1', fullName: 'Nguyễn Văn A', gradeLevel: 6 }, { id: 's2', fullName: 'Trần Thị B', gradeLevel: 6 }],
  classes: [
    { id: 'c1', name: 'Toán 6 - CQT01', tuitionRate: 150000 },
    { id: 'c2', name: 'Toán 6 - CQT02', tuitionRate: 300000 },
  ],
  enrollments: [],
  sessions: [...sessions('c1', [...tue, ...sat]), ...sessions('c2', sun)],
  promotions: [], privateSessions: [], records: [], paidByRecord: new Map(),
})
const enrol = (id, studentId, classId, weekdayPlans = []) =>
  ({ id, studentId, classId, enrollmentDate: '2026-09-01', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00Z', weekdayPlans })
const row = (rows, studentId, classId) => rows.find(r => r.studentId === studentId && r.classId === classId)

test('học viên học một buổi/tuần trong lớp hai buổi chỉ bị tính các buổi đã chọn', () => {
  const data = base()
  data.enrollments = [
    enrol('full', 's2', 'c1'),
    enrol('tueOnly', 's1', 'c1', [{ effectiveFrom: '2026-09-01', days: ['TUESDAY'] }]),
  ]
  const rows = buildTuitionScheduleSummary(data, 12, 2026)
  assert.equal(row(rows, 's2', 'c1').totalSessions, 9, 'học đủ: không đổi')
  assert.equal(row(rows, 's2', 'c1').finalAmount, 1350000)
  assert.equal(row(rows, 's1', 'c1').totalSessions, 5, 'tháng có 5 buổi T3 thì tính 5')
  assert.equal(row(rows, 's1', 'c1').finalAmount, 750000)
})

test('học viên học hai lớp, mỗi lớp một buổi, tính theo đơn giá từng lớp', () => {
  const data = base()
  data.enrollments = [
    enrol('a', 's1', 'c1', [{ effectiveFrom: '2026-09-01', days: ['SATURDAY'] }]),
    enrol('b', 's1', 'c2'),
  ]
  const rows = buildTuitionScheduleSummary(data, 12, 2026)
  assert.equal(row(rows, 's1', 'c1').totalSessions, 4)
  assert.equal(row(rows, 's1', 'c1').finalAmount, 600000)
  assert.equal(row(rows, 's1', 'c2').finalAmount, 1200000)
})

test('đổi lịch giữa tháng: trước ngày áp dụng theo lịch cũ, sau đó theo lịch mới', () => {
  const data = base()
  data.enrollments = [enrol('e', 's1', 'c1', [
    { effectiveFrom: '2026-09-01', days: ['TUESDAY'] },
    { effectiveFrom: '2026-12-16', days: [] }, // từ 16/12 học đủ
  ])]
  const rows = buildTuitionScheduleSummary(data, 12, 2026)
  // T3: 1, 8, 15 (lịch cũ) + 22, 29; T7: 19, 26 (lịch mới)
  assert.equal(row(rows, 's1', 'c1').totalSessions, 7)
})

test('quy tắc dùng chung: khoảng ghi danh và lịch cố định', () => {
  const e = { enrollmentDate: '2026-12-05', status: 'DROPPED', dropDate: '2026-12-20', weekdayPlans: [{ effectiveFrom: '2026-12-05', days: ['SATURDAY'] }] }
  assert.equal(enrollmentCoversSession(e, '2026-12-01'), false, 'trước ngày ghi danh')
  assert.equal(enrollmentCoversSession(e, '2026-12-08'), false, 'T3 không học')
  assert.equal(enrollmentCoversSession(e, '2026-12-12'), true)
  assert.equal(enrollmentCoversSession(e, '2026-12-26'), false, 'sau ngày nghỉ')
  assert.equal(weekdaysOn({ weekdayPlans: [] }, '2026-12-12'), null, 'không có lịch riêng = học đủ')
})
