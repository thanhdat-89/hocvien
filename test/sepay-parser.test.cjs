const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseTransferNote } = require('../dist/services/sepayMatcher')

test('student code is read after T<month> or from the end, never from a 5–6 letter name', () => {
  // Tên không dấu có từ 5–6 chữ cái không được lấy làm mã học viên.
  assert.deepEqual(parseTransferNote('HP NGUYEN VAN A T10 ABC12'), {
    shortId: 'ABC12', candidates: ['ABC12', 'NGUYEN'], month: 10, rawName: 'NGUYEN VAN A' })
  assert.equal(parseTransferNote('HP TRAN THANH PHUONG T9 XYZ9Q').shortId, 'XYZ9Q')
  assert.equal(parseTransferNote('hp tran minh hieu t10 abc12').shortId, 'ABC12')
  // Ngân hàng chèn tiền tố/hậu tố và dấu chấm quanh nội dung.
  const banked = parseTransferNote('MBVCB.1234567.HP NGUYEN AN T10 ABC12.CT tu 0123456789 toi 9876')
  assert.equal(banked.shortId, 'ABC12')
  assert.equal(banked.month, 10)
  assert.ok(banked.candidates.includes('NGUYEN'))
  // Mã đặt trước tháng vẫn là ứng viên (thứ tự từ cuối lên).
  assert.ok(parseTransferNote('ABC12 HP AN T10').candidates.includes('ABC12'))
  // Thiếu tháng hoặc không có từ 5–6 ký tự → không đọc được.
  assert.equal(parseTransferNote('HP NGUYEN VAN A ABC12'), null)
  assert.equal(parseTransferNote('HP AN T10'), null)
  assert.equal(parseTransferNote('HP AN T13 ABC12'), null)
  assert.equal(parseTransferNote(''), null)
})
