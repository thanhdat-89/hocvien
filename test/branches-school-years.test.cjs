const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const { prisma, reset, seed, routeHandler, context } = require('./helpers/pg.cjs')
const branches = require('../dist/routes/branches').default
const years = require('../dist/routes/schoolYears').default

beforeEach(reset)
const admin = async () => ({ userId: (await seed.user()).id, role: 'ADMIN' })

test('năm học: không chồng ngày, đặt năm hiện tại thì năm cũ đóng, chỉ xoá năm trống', async () => {
  const { schoolYearId } = await context()
  await seed.klass()
  const user = await admin()
  const post = routeHandler(years, '/', 'post'), put = routeHandler(years, '/:id', 'put'), del = routeHandler(years, '/:id', 'delete')

  assert.equal((await post({ user, body: { name: '2027–2028', startDate: '2027-06-15', endDate: '2028-06-30' } })).status, 409, 'chồng lên năm 2026–2027')
  assert.equal((await post({ user, body: { name: 'x', startDate: '2028-07-01', endDate: '2028-06-01' } })).status, 400)
  const next = await post({ user, body: { name: '2027–2028', startDate: '2027-07-01', endDate: '2028-06-30' } })
  assert.equal(next.status, 201)
  assert.equal(next.body.status, 'UPCOMING')

  assert.equal((await put({ user, params: { id: schoolYearId }, body: { status: 'CLOSED' } })).status, 400, 'năm hiện tại không tự đóng được')
  const activated = await put({ user, params: { id: next.body.id }, body: { status: 'CURRENT' } })
  assert.equal(activated.status, 200)
  assert.deepEqual((await prisma.schoolYear.findMany({ orderBy: { startDate: 'asc' }, select: { status: true } })).map(y => y.status), ['CLOSED', 'CURRENT'])

  assert.equal((await del({ user, params: { id: schoolYearId } })).status, 400, 'năm đã có lớp')
  assert.equal((await del({ user, params: { id: next.body.id } })).status, 400, 'năm hiện tại')
  const empty = await post({ user, body: { name: '2028–2029', startDate: '2028-07-01', endDate: '2029-06-30' } })
  assert.equal((await del({ user, params: { id: empty.body.id } })).status, 200)
})

test('cơ sở: tên không trùng, luôn còn một cơ sở hoạt động; nhân viên chỉ thấy cơ sở được phân công', async () => {
  const { branchId: A } = await context()
  const user = await admin()
  const post = routeHandler(branches, '/', 'post'), put = routeHandler(branches, '/:id', 'put'), list = routeHandler(branches, '/', 'get')

  assert.equal((await post({ user, body: { name: 'CQT 263' } })).status, 409)
  assert.equal((await put({ user, params: { id: A }, body: { isActive: false } })).status, 400, 'cơ sở hoạt động cuối cùng')
  const B = await post({ user, body: { name: '  Cơ sở 2 ', address: 'Hà Nội' } })
  assert.equal(B.status, 201)
  assert.equal(B.body.name, 'Cơ sở 2')
  assert.equal((await put({ user, params: { id: A }, body: { isActive: false } })).status, 200)

  const staff = await seed.user({ role: 'STAFF', branches: { create: [{ branchId: A }, { branchId: B.body.id }] } })
  const seen = await list({ user: { userId: staff.id, role: 'STAFF' } })
  assert.deepEqual(seen.body.map(b => b.name), ['Cơ sở 2'], 'không hiện cơ sở đã ngừng hoạt động')
  assert.equal((await list({ user })).body.length, 2, 'ADMIN thấy cả cơ sở ngừng hoạt động')
})
