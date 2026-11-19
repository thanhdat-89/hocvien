const { test, before, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed, day, routeHandler, newId, context } = require('./helpers/pg.cjs')
const router = require('../dist/routes/students').default

const preview = routeHandler(router, '/private-schedule/import/preview', 'post')
const commit = routeHandler(router, '/private-schedule/import', 'post')

before(reset)
beforeEach(reset)
after(() => prisma.$disconnect())

// Tháng 11/2026: T2 = 2, 9, 16, 23, 30; T5 = 5, 12, 19, 26
const row = (extra = {}) => ({ row: 2, studentName: 'Song Lam', gradeLevel: 6, weekdays: [1, 4], fromMonth: '2026-11', toMonth: '2026-11',
  startTime: '18:00', endTime: '19:30', teacherName: 'Cô Hoa', ratePerSession: 200000, ...extra })

test('preview does not write; commit creates one session per weekday in range', async () => {
  const st = await seed.student({ fullName: 'Song Lam', gradeLevel: 6 })
  const p = (await preview({ body: { rows: [row()] } })).body
  assert.equal(p.rows[0].status, 'ok')
  assert.equal(p.rows[0].studentId, st.id)
  assert.equal(p.rows[0].dates.length, 9)
  assert.equal(await prisma.privateSession.count(), 0)

  const c = await commit({ body: { rows: [row()] } })
  assert.equal(c.status, 201)
  assert.equal(c.body.created, 9)
  const saved = await prisma.privateSession.findMany({ orderBy: { sessionDate: 'asc' } })
  assert.equal(saved[0].sessionDate.toISOString().slice(0, 10), '2026-11-02')
  assert.ok(saved.every(s => s.teacherName === 'Cô Hoa' && s.ratePerSession === 200000 && s.startTime === '18:00'))
})

test('missing name, unknown name and same-name students are reported', async () => {
  await seed.student({ fullName: 'Bảo Anh', gradeLevel: 6 })
  await seed.student({ fullName: 'Bảo Anh', gradeLevel: 6 })
  const b = await seed.student({ fullName: 'Bảo Anh', gradeLevel: 7 })
  const p = (await preview({ body: { rows: [
    row({ row: 2, studentName: '' }),
    row({ row: 3, studentName: 'Không Có' }),
    row({ row: 4, studentName: 'bảo  anh', gradeLevel: 6 }),
    row({ row: 5, studentName: 'Bảo Anh', gradeLevel: 7 }),
    row({ row: 6, studentName: 'Bảo Anh', gradeLevel: 9 }),
  ] } })).body.rows
  assert.equal(p[0].issues[0].code, 'NO_NAME')
  assert.equal(p[1].issues[0].code, 'NOT_FOUND')
  assert.equal(p[2].issues[0].code, 'AMBIGUOUS')
  assert.equal(p[2].candidates.length, 2)
  assert.equal(p[3].status, 'ok')
  assert.equal(p[3].studentId, b.id)
  assert.equal(p[4].issues[0].code, 'GRADE_MISMATCH')

  // Chọn học viên cụ thể khi trùng tên
  const picked = p[2].candidates[0].id
  const again = (await preview({ body: { rows: [row({ studentName: 'Bảo Anh', studentId: picked })] } })).body.rows[0]
  assert.equal(again.status, 'ok')
  assert.equal(again.studentId, picked)
})

test('duplicates are errors unless the old private sessions are replaced', async () => {
  const st = await seed.student({ fullName: 'Song Lam', gradeLevel: 6 })
  await prisma.privateSession.create({ data: { id: newId(), studentId: st.id, sessionDate: day('2026-11-02'), ratePerSession: 150000 } })
  await prisma.privateSession.create({ data: { id: newId(), studentId: st.id, sessionDate: day('2026-11-03'), ratePerSession: 150000 } })

  const p = (await preview({ body: { rows: [row()] } })).body.rows[0]
  assert.equal(p.status, 'error')
  assert.deepEqual(p.duplicateDates, ['2026-11-02'])
  assert.equal((await commit({ body: { rows: [row()] } })).status, 400)

  const c = (await commit({ body: { rows: [row()], replaceExisting: true } })).body
  assert.equal(c.deleted, 2, 'xoá toàn bộ lịch riêng cũ trong tháng import')
  assert.equal(c.created, 9)
  assert.equal(await prisma.privateSession.count({ where: { studentId: st.id } }), 9)

  const inFile = (await preview({ body: { rows: [row({ row: 2, fromMonth: '2026-12', toMonth: '2026-12' }), row({ row: 3, fromMonth: '2026-12', toMonth: '2026-12', weekdays: [1] })] } })).body.rows
  assert.equal(inFile[1].issues.find(i => i.code === 'DUPLICATE_IN_FILE').level, 'error')
})

test('holidays warn and can be skipped; paid months are blocked', async () => {
  const st = await seed.student({ fullName: 'Song Lam', gradeLevel: 6 })
  const { branchId } = await context()
  await prisma.holiday.create({ data: { id: newId(), name: 'Nghỉ', startDate: day('2026-11-19'), endDate: day('2026-11-19'),
    branches: { create: { branchId } } } })
  const warned = (await preview({ body: { rows: [row()] } })).body.rows[0]
  assert.equal(warned.status, 'warning')
  assert.deepEqual(warned.holidayDates, ['2026-11-19'])
  assert.equal(warned.dates.length, 9)
  const skipped = (await preview({ body: { rows: [row()], skipHolidays: true } })).body.rows[0]
  assert.equal(skipped.dates.length, 8)

  const rec = await seed.tuition({ studentId: st.id, classId: null, billingMonth: 12, billingYear: 2026, finalAmount: 100000, paidAmount: 100000 })
  assert.ok(rec)
  const blocked = (await preview({ body: { rows: [row({ toMonth: '2026-12' })] } })).body.rows[0]
  assert.equal(blocked.status, 'error')
  assert.ok(blocked.issues.some(i => i.code === 'PAID_MONTH'))
})

test('students in a regular class need confirmation', async () => {
  const st = await seed.student({ fullName: 'Song Lam', gradeLevel: 6 })
  const cls = await seed.klass({ name: 'Toán 6A' })
  await seed.enrollment({ classId: cls.id, studentId: st.id, status: 'ACTIVE' })
  const p = (await preview({ body: { rows: [row()] } })).body.rows[0]
  assert.equal(p.status, 'error')
  assert.deepEqual(p.activeClasses, ['Toán 6A'])
  const ok = (await preview({ body: { rows: [row()], confirmedStudentIds: [st.id] } })).body.rows[0]
  assert.equal(ok.status, 'ok')
})
