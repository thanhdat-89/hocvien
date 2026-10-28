// Bộ khung test trên PostgreSQL thật (database riêng, mặc định qlhv_test trong container dev).
//   TEST_DATABASE_URL=postgresql://... npm test
// Phải require file này TRƯỚC mọi module trong dist/ để Prisma client dùng database test.
const { execSync } = require('node:child_process')
const path = require('node:path')

const url = process.env.TEST_DATABASE_URL || 'postgresql://postgres:dev@localhost:55432/qlhv_test'
if (!/test/i.test(new URL(url).pathname)) throw new Error(`Từ chối chạy test trên database không phải test: ${url}`)
process.env.DATABASE_URL = url
process.env.NODE_ENV = 'test'

// Tạo database (nếu chưa có) và áp mọi migration — chạy một lần mỗi tiến trình test.
execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '../..'), env: process.env, stdio: 'ignore' })

const { prisma, newId } = require('../../dist/lib/db')

/** Xoá sạch dữ liệu mọi bảng (giữ schema). */
async function reset() {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(', ')} CASCADE`)
}

const day = value => new Date(`${value}T00:00:00Z`)

// ─── Dữ liệu mẫu tối thiểu ───────────────────────────────────

const seed = {
  user: (data = {}) => prisma.user.create({ data: { id: newId(), username: newId(), passwordHash: 'x', role: 'ADMIN', fullName: 'Quản trị', ...data } }),
  student: (data = {}) => prisma.student.create({ data: { id: newId(), fullName: 'Học viên', enrollmentDate: day('2026-01-01'), ...data } }),
  klass: (data = {}) => prisma.class.create({ data: { id: newId(), name: 'Toán', ...data } }),
  enrollment: ({ enrollmentDate = '2026-01-01', dropDate, ...data }) => prisma.classEnrollment.create({
    data: { id: newId(), enrollmentDate: day(enrollmentDate), dropDate: dropDate ? day(dropDate) : null, ...data },
  }),
  schedule: ({ effectiveFrom = '2026-01-01', ...data }) => prisma.schedule.create({ data: { id: newId(), effectiveFrom: day(effectiveFrom), ...data } }),
  session: ({ sessionDate, startTime = '18:00', endTime = '19:30', ...data }) => prisma.session.create({
    data: { id: newId(), sessionDate: day(sessionDate), startTime, endTime, ...data },
  }),
  tuition: ({ dueDate, ...data }) => prisma.tuitionRecord.create({
    data: { id: newId(), totalSessions: 1, chargedSessions: 1, baseAmount: data.finalAmount ?? 0, discountAmount: 0,
      finalAmount: 0, remainingAmount: data.finalAmount ?? 0, dueDate: dueDate ? day(dueDate) : null, ...data },
  }),
  payment: ({ paymentDate = '2026-10-01', ...data }) => prisma.payment.create({
    data: { id: newId(), paymentDate: day(paymentDate), method: 'CASH', ...data },
  }),
}

/** Gọi handler cuối của một route Express (không qua middleware xác thực). */
function routeHandler(router, routePath, method) {
  const layer = router.stack.find(l => l.route?.path === routePath && l.route.methods[method])
  if (!layer) throw new Error(`Không có route ${method.toUpperCase()} ${routePath}`)
  const handle = layer.route.stack[layer.route.stack.length - 1].handle
  return async req => {
    let body, status = 200, failure
    const res = { status(code) { status = code; return this }, json(value) { body = value; return this }, setHeader() {} }
    await handle({ params: {}, query: {}, body: {}, headers: {}, ...req }, res, err => { failure = err })
    if (failure) throw failure
    return { status, body }
  }
}

module.exports = { prisma, reset, seed, day, routeHandler, newId }
