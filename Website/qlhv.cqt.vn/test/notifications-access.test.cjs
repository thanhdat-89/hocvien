const assert = require('node:assert/strict')
const { test } = require('node:test')
require('./helpers/pg.cjs')
const { notificationRouter } = require('../dist/routes/notifications')

/** Chạy middleware cấp router (sau authenticate) với vai trò cho trước; trả về status nếu bị chặn */
function roleGate(role) {
  const [, gate] = notificationRouter.stack.filter(layer => !layer.route).map(layer => layer.handle)
  return new Promise(resolve => {
    const res = { status(code) { resolve(code); return this }, json() { return this } }
    gate({ user: { userId: 'u', role } }, res, () => resolve(200))
  })
}

test('chỉ quản trị viên và nhân viên dùng được API thông báo (gửi Zalo tới phụ huynh)', async () => {
  assert.equal(await roleGate('TEACHER'), 403)
  assert.equal(await roleGate('STAFF'), 200)
  assert.equal(await roleGate('ADMIN'), 200)
})
