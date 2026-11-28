const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const { prisma, reset, seed, routeHandler, newId } = require('./helpers/pg.cjs')
const access = require('../dist/lib/parentAccess')
const router = require('../dist/routes/public').default

const lookup = routeHandler(router, '/lookup', 'get')
const gate = routeHandler(router, '/student/:id/gate', 'get')
const verify = routeHandler(router, '/student/:id/verify', 'post')
const setup = routeHandler(router, '/student/:id/setup', 'post')
const studentPage = routeHandler(router, '/student/:id', 'get')

let ipSeq = 0
const ip = () => `10.0.0.${++ipSeq}` // mỗi lần gọi một IP để không dính giới hạn theo IP
const withParent = async (fullName, phone, studentData = {}) => {
  const st = await seed.student({ fullName, ...studentData })
  if (phone !== undefined) {
    await prisma.parent.create({ data: { id: newId(), studentId: st.id, fullName: 'Mẹ', phone, isPrimaryContact: true } })
  }
  return st
}

beforeEach(async () => { await reset(); access.resetAllLimits() })

test('chuẩn hoá SĐT và tìm tên không dấu', () => {
  assert.equal(access.normalizePhone('+84 912.345.678'), '0912345678')
  assert.equal(access.normalizePhone('0912-345-678'), '0912345678')
  assert.equal(access.normalizePhone('091234567'), null)
  assert.equal(access.normalizePhone('abc'), null)
  assert.ok(access.nameMatches('Nguyễn Đức An', 'duc an'))
  assert.ok(access.nameMatches('Nguyễn Đức An', 'NGUYEN'))
  assert.ok(!access.nameMatches('Nguyễn Thị Lan', 'an'))
})

test('tra cứu theo tên chỉ trả học viên đang học, kèm khối và lớp', async () => {
  const an = await withParent('Nguyễn Văn An', '0912345678', { gradeLevel: 9 })
  await withParent('Trần An Nghỉ', undefined, { status: 'INACTIVE' })
  const cls = await seed.klass({ name: 'Toán 9A1' })
  await seed.enrollment({ studentId: an.id, classId: cls.id, status: 'ACTIVE' })

  const { body } = await lookup({ query: { q: 'van an' }, ip: ip() })
  assert.equal(body.results.length, 1)
  assert.deepEqual(body.results[0], { id: an.id, fullName: 'Nguyễn Văn An', gradeLevel: 9, classes: [{ name: 'Toán 9A1' }] })
  assert.equal((await lookup({ query: { q: 'a' }, ip: ip() })).body.results.length, 0)
})

test('xác minh đúng SĐT (kể cả số zalo của phụ huynh khác) thì nhận token mở được trang', async () => {
  const st = await withParent('Lê Minh', '0912345678')
  await prisma.parent.create({ data: { id: newId(), studentId: st.id, fullName: 'Bố', zalo: '0987 654 321' } })
  assert.deepEqual((await gate({ params: { id: st.id }, ip: ip() })).body, { fullName: 'Lê Minh', needsSetup: false })

  const ok = await verify({ params: { id: st.id }, body: { phone: '+84987654321' }, ip: ip() })
  assert.equal(ok.status, 200)
  const page = await studentPage({ params: { id: st.id }, headers: { authorization: `Bearer ${ok.body.token}` }, ip: ip() })
  assert.equal(page.status, 200)
  assert.equal(page.body.student.fullName, 'Lê Minh')

  // Token của học viên này không mở được học viên khác
  const other = await withParent('Học viên khác', '0911111111')
  const denied = await studentPage({ params: { id: other.id }, headers: { authorization: `Bearer ${ok.body.token}` }, ip: ip() })
  assert.equal(denied.status, 401)

  // Không có token thì không xem được
  const anonymous = await studentPage({ params: { id: st.id }, ip: ip() })
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.body.needsSetup, false)
})

test('sai SĐT 5 lần thì khoá tạm; đổi SĐT trong qlhv thì token cũ hết hiệu lực', async () => {
  const st = await withParent('Phạm Hà', '0912345678')
  for (let i = 0; i < 5; i++) {
    assert.equal((await verify({ params: { id: st.id }, body: { phone: '0900000000' }, ip: ip() })).status, 401)
  }
  assert.equal((await verify({ params: { id: st.id }, body: { phone: '0912345678' }, ip: ip() })).status, 429)
  access.resetAllLimits()

  const { body } = await verify({ params: { id: st.id }, body: { phone: '0912345678' }, ip: ip() })
  await prisma.parent.updateMany({ where: { studentId: st.id }, data: { phone: '0933333333' } })
  const page = await studentPage({ params: { id: st.id }, headers: { authorization: `Bearer ${body.token}` }, ip: ip() })
  assert.equal(page.status, 401)
})

test('mật khẩu quản trị mở được mọi học viên', async () => {
  const a = await withParent('A', '0912345678')
  const b = await withParent('B', undefined)
  assert.equal((await verify({ params: { id: a.id }, body: { adminPassword: 'sai' }, ip: ip() })).status, 401)
  const { body } = await verify({ params: { id: a.id }, body: { adminPassword: 'cqt.vn' }, ip: ip() })
  assert.equal(body.role, 'admin')
  const page = await studentPage({ params: { id: b.id }, headers: { authorization: `Bearer ${body.token}` }, ip: ip() })
  assert.equal(page.status, 200)
})

test('học viên chưa có SĐT: phụ huynh đăng ký lần đầu, số được lưu và đánh dấu tự đăng ký', async () => {
  const st = await withParent('Đỗ Nam', undefined)
  assert.equal((await gate({ params: { id: st.id }, ip: ip() })).body.needsSetup, true)
  assert.equal((await verify({ params: { id: st.id }, body: { phone: '0912345678' }, ip: ip() })).status, 409)

  const first = await setup({ params: { id: st.id }, body: { phone: '0912 345 678', parentName: 'Chị Hoa', relationship: 'Mẹ' }, ip: ip() })
  assert.equal(first.status, 200)
  const parents = await prisma.parent.findMany({ where: { studentId: st.id } })
  assert.equal(parents.length, 1)
  assert.equal(parents[0].phone, '0912345678')
  assert.equal(parents[0].fullName, 'Chị Hoa')
  assert.ok(parents[0].selfRegisteredAt)

  // Người thứ hai không ghi đè được
  assert.equal((await setup({ params: { id: st.id }, body: { phone: '0999999999' }, ip: ip() })).status, 409)
  const page = await studentPage({ params: { id: st.id }, headers: { authorization: `Bearer ${first.body.token}` }, ip: ip() })
  assert.equal(page.status, 200)
})

test('đăng ký lần đầu điền vào phụ huynh đã có nhưng trống SĐT', async () => {
  const st = await seed.student({ fullName: 'Vũ Long' })
  await prisma.parent.create({ data: { id: newId(), studentId: st.id, fullName: 'Bố Long', isPrimaryContact: true } })
  assert.equal((await setup({ params: { id: st.id }, body: { phone: '0912345678' }, ip: ip() })).status, 200)
  const parents = await prisma.parent.findMany({ where: { studentId: st.id } })
  assert.equal(parents.length, 1)
  assert.equal(parents[0].fullName, 'Bố Long')
  assert.equal(parents[0].phone, '0912345678')
})

test('token giả mạo hoặc hết hạn bị từ chối', () => {
  const t = access.signParentToken('s1', 'parent', '0912345678', Date.now() - 400 * 24 * 3600_000)
  assert.equal(access.verifyParentToken(t), null)
  const good = access.signParentToken('s1', 'parent', '0912345678')
  const [body] = good.split('.')
  assert.equal(access.verifyParentToken(`${body}.xxxx`), null)
  assert.ok(access.tokenGrants(access.verifyParentToken(good), 's1', new Set(['0912345678'])))
})
