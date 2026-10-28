const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed } = require('./helpers/pg.cjs')
const service = require('../dist/services/readViews')
const { readViewInvalidation } = require('../dist/middleware/readViewInvalidation')
const { saveInvoiceCopies } = require('../dist/services/misaInvoiceStore')

before(reset)
after(() => prisma.$disconnect())

test('shared views keep version/unchanged, preserve private eligibility and paginate billing periods', async () => {
  const s1 = await seed.student({ id: 's1', fullName: 'An', gradeLevel: 8 })
  const s2 = await seed.student({ id: 's2', fullName: 'Bình', gradeLevel: 9 })
  await seed.student({ id: 's3', fullName: 'Chi', gradeLevel: 6 })
  const cls = await seed.klass()
  await seed.enrollment({ studentId: s1.id, classId: cls.id, status: 'ACTIVE' })
  await prisma.privateSession.create({ data: { id: 'p1', studentId: s2.id, sessionDate: new Date('2026-10-14T00:00:00Z'), status: 'CANCELLED', ratePerSession: 0 } })

  const first = await service.getMissingPrivateStudents(10, 2026)
  // Cancelled sessions still count as scheduled, preserving existing behavior.
  assert.deepEqual(first.data.map(s => s.id), ['s3'])
  const unchanged = await service.getMissingPrivateStudents(10, 2026, first.version)
  assert.equal(unchanged.unchanged, true)
  assert.equal(unchanged.data, undefined)

  // Dữ liệu đổi nhưng chưa huỷ cache: client mới vẫn nhận snapshot cũ trong thời hạn.
  await prisma.privateSession.deleteMany()
  assert.deepEqual((await service.getMissingPrivateStudents(10, 2026)).data, first.data)

  // Middleware huỷ cache trước khi trả kết quả thành công; lỗi 403 không huỷ.
  let delivered
  const response = { statusCode: 200, json(payload) { delivered = payload; return this } }
  readViewInvalidation({ method: 'PUT', path: '/api/students/s2' }, response, () => {})
  response.json({ saved: true })
  assert.deepEqual(delivered, { saved: true })
  const changed = await service.getMissingPrivateStudents(10, 2026, first.version)
  assert.deepEqual(changed.data.map(s => s.id), ['s2', 's3'])
  const denied = { statusCode: 403, json() { return this } }
  readViewInvalidation({ method: 'PUT', path: '/api/students/s2' }, denied, () => {})
  denied.json({ message: 'Forbidden' })
  assert.equal((await service.getMissingPrivateStudents(10, 2026, changed.version)).unchanged, true)

  const source = (id, month) => ({ recordId: id, studentId: 's1', studentName: 'An', className: 'Math', month, year: 2026, finalAmount: 100000 })
  const base = { status: 'DRAFT_CREATED', invoiceDate: '2026-10-12', template: {}, buyer: {}, createdBy: 'test', revision: 0 }
  await saveInvoiceCopies(['f1'], { ...base, refId: 'r1', recordIds: ['f1'], source: source('f1', 10), billingPeriods: ['2026-10'], createdAt: '2026-10-12T10:00:00Z' })
  const grouped = { ...base, refId: 'r2', recordIds: ['f2', 'f3'], source: source('f2', 10), sources: [source('f2', 10), source('f3', 7)],
    billingPeriods: ['2026-10', '2026-07'], createdAt: '2026-10-14T10:00:00Z' }
  await saveInvoiceCopies(['f2', 'f3'], grouped)

  const page1 = await service.getInvoiceList(10, 2026, 1)
  assert.equal(page1.total, 2); assert.equal(page1.counts.DRAFT_CREATED, 2)
  assert.equal(page1.rows[0].id, 'f2')
  const page2 = await service.getInvoiceList(10, 2026, 1, page1.nextCursor)
  assert.equal(page2.rows[0].id, 'f1'); assert.equal(page2.nextCursor, null)
  const july = await service.getInvoiceList(7, 2026, 30)
  assert.deepEqual(july.rows.map(row => row.id), ['f3'])
  assert.deepEqual(service.invoiceBillingPeriods(grouped), ['2026-10', '2026-07'])
  await service.invalidateReadView('invoices')
  await assert.rejects(service.getInvoiceList(10, 2026, 1, page1.nextCursor), error => error.status === 409)
  await assert.rejects(service.getInvoiceList(10, 2026, 1, 'bnVsbA'), error => error.status === 400)
})
