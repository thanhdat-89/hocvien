const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed, routeHandler } = require('./helpers/pg.cjs')
const { recordPayment, clearPayments, getPaymentStatus } = require('../dist/services/tuitionCalculator')
const { studentShortId } = require('../dist/services/sepayMatcher')

beforeEach(reset)
after(() => prisma.$disconnect())

async function feeFor(month = 9) {
  const student = await seed.student({ fullName: 'Nguyễn Văn A' })
  const fee = await seed.tuition({ studentId: student.id, classId: null, className: 'Học riêng', billingMonth: month, billingYear: 2026,
    baseAmount: 1200000, finalAmount: 1200000, remainingAmount: 1200000, status: 'PENDING' })
  return { student, fee }
}

test('confirming "paid in full" several times at once records the remaining amount once', async () => {
  const { fee } = await feeFor()
  await recordPayment(fee.id, { amount: 200000, receivedByName: 'Thu ngân' })
  const results = await Promise.all([1, 2, 3].map(() => recordPayment(fee.id, { amount: 'remaining', receivedByName: 'Thu ngân' })))
  assert.equal(results.filter(Boolean).length, 1)
  const payments = await prisma.payment.findMany({ where: { tuitionRecordId: fee.id } })
  assert.deepEqual(payments.map(p => p.amount).sort((a, b) => a - b), [200000, 1000000])
  const record = await prisma.tuitionRecord.findUnique({ where: { id: fee.id } })
  assert.equal(record.status, 'PAID'); assert.equal(record.paidAmount, 1200000); assert.equal(record.remainingAmount, 0)

  await clearPayments(fee.id)
  assert.deepEqual(await getPaymentStatus(fee.id), { finalAmount: 1200000, totalPaid: 0, remaining: 1200000, status: 'PENDING' })
})

test('SePay webhook delivered twice concurrently records one payment and one bank transaction', async () => {
  process.env.SEPAY_WEBHOOK_KEY = 'test-key'
  process.env.SEPAY_SKIP_IP_CHECK = 'true'
  const router = require('../dist/routes/webhooks').default
  const handler = routeHandler(router, '/sepay', 'post')
  const { student, fee } = await feeFor(9) // T9/2026: trước mốc lập hoá đơn MISA → không gọi MISA
  const body = { id: 987654, gateway: 'VPBank', transactionDate: '2026-09-15 10:20:30', accountNumber: '123', code: null,
    // Tên có từ 5–6 chữ cái (NGUYEN) không được đọc nhầm thành mã học viên.
    content: `HP NGUYEN VAN A T9 ${studentShortId(student.id)}`, transferType: 'in', transferAmount: 1200000, accumulated: 5000000,
    subAccount: null, referenceCode: 'FT123', description: '' }
  const req = () => ({ body, header: name => ({ authorization: 'Apikey test-key' })[name.toLowerCase()], ip: '127.0.0.1' })

  const responses = await Promise.all([handler(req()), handler(req())])
  const statuses = responses.map(r => r.body.status ?? (r.body.idempotent ? 'idempotent' : '?')).sort()
  assert.deepEqual(statuses, ['idempotent', 'matched'])
  assert.equal(await prisma.payment.count({ where: { tuitionRecordId: fee.id } }), 1)
  const tx = await prisma.bankTransaction.findUnique({ where: { sepayId: 987654n } })
  assert.equal(tx.status, 'matched')
  assert.equal(tx.matchedTuitionRecordId, fee.id)
  assert.equal(tx.transactionDate.toISOString(), '2026-09-15T10:20:30.000Z', 'Giữ nguyên giờ địa phương SePay gửi')
  assert.equal((await prisma.tuitionRecord.findUnique({ where: { id: fee.id } })).status, 'PAID')

  // Gửi lại lần nữa sau đó: vẫn idempotent, không thêm khoản thu.
  assert.equal((await handler(req())).body.idempotent, true)
  assert.equal(await prisma.payment.count(), 1)

  // Không khớp được học viên: chỉ ghi sổ, không có khoản thu.
  const unknown = await handler({ ...req(), body: { ...body, id: 111, content: 'CHUYEN KHOAN T9 ZZZZZ' } })
  assert.equal(unknown.body.status, 'unmatched')
  assert.equal(await prisma.payment.count(), 1)
  assert.equal(await prisma.bankTransaction.count(), 2)
})
