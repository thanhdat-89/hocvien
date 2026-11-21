// Điểm khôi phục trước thao tác nguy hiểm (middleware/checkpointGuard). pg_dump thật được thay bằng fixtures/fake-pg-dump.sh.
const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = 'test-secret'
process.env.DATABASE_URL = 'postgresql://u:p%40ss@127.0.0.1:5432/qlhv_test'
const { checkpointGuard, matchCheckpointRule } = require('../dist/middleware/checkpointGuard')
const { resetCheckpointThrottle } = require('../dist/lib/checkpoint')

const FAKE = path.resolve(__dirname, 'fixtures/fake-pg-dump.sh')
let dir
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlhv-cp-'))
  process.env.CHECKPOINT_DIR = dir
  process.env.PG_DUMP = FAKE
  delete process.env.TELEGRAM_BOT_TOKEN
  resetCheckpointThrottle()
})
after(() => { delete process.env.CHECKPOINT_DIR; delete process.env.PG_DUMP })

const token = jwt.sign({ userId: 'user123456789xyz', role: 'ADMIN' }, 'test-secret')
const call = (method, url, auth = `Bearer ${token}`) => new Promise(resolve => {
  checkpointGuard({ method, originalUrl: url, url, headers: auth ? { authorization: auth } : {} }, {}, err => resolve(err))
})
const dumps = () => fs.readdirSync(dir).filter(f => f.endsWith('.dump'))

test('rules match only the dangerous operations', () => {
  assert.deepEqual(matchCheckpointRule('DELETE', '/api/students/abc/hard'), { reason: 'xoa-hoc-vien', scopeKey: 'abc' })
  assert.equal(matchCheckpointRule('POST', '/api/tuition/calculate-bulk').reason, 'tinh-hoc-phi-hang-loat')
  assert.equal(matchCheckpointRule('DELETE', '/api/students/abc'), null)        // xoá mềm
  assert.equal(matchCheckpointRule('GET', '/api/students/bulk'), null)
  assert.equal(matchCheckpointRule('POST', '/api/tuition/calculate'), null)
})

test('dangerous operation with a valid token dumps before the handler runs', async () => {
  const err = await call('DELETE', '/api/students/stu1/hard')
  assert.equal(err, undefined)
  const files = dumps()
  assert.equal(files.length, 1)
  assert.match(files[0], /^pre-xoa-hoc-vien-\d{8}-\d{6}-stu1-user12345678\.dump$/)
  assert.equal(fs.statSync(path.join(dir, files[0])).mode & 0o777, 0o600)
})

test('repeat within 5 minutes reuses the checkpoint; another target makes a new one', async () => {
  await call('DELETE', '/api/students/stu1/hard')
  await call('DELETE', '/api/students/stu1/hard')
  assert.equal(dumps().length, 1)
  await call('DELETE', '/api/students/stu2/hard')
  assert.equal(dumps().length, 2)
})

test('no dump for harmless requests, missing or invalid token, or when disabled', async () => {
  assert.equal(await call('POST', '/api/students'), undefined)
  assert.equal(await call('POST', '/api/tuition/calculate-bulk', null), undefined)
  assert.equal(await call('POST', '/api/tuition/calculate-bulk', 'Bearer bad'), undefined)
  assert.equal(dumps().length, 0)
  delete process.env.CHECKPOINT_DIR
  assert.equal(await call('POST', '/api/tuition/calculate-bulk'), undefined)
  assert.equal(dumps().length, 0)
})

test('failed dump blocks the operation with 503 and leaves no partial file', async () => {
  process.env.PG_DUMP = 'false'
  const err = await call('POST', '/api/students/bulk-delete')
  assert.equal(err.status, 503)
  assert.equal(fs.readdirSync(dir).length, 0)
})
