const { test } = require('node:test')
const assert = require('node:assert/strict')
const router = require('../dist/routes/misaInvoiceCron').default
const { dispatchMonthlyInvoiceWorker, continueMonthlyInvoiceWork } = require('../dist/routes/misaInvoiceCron')
const { monthlyInvoiceReconciler } = require('../dist/services/monthlyInvoiceReconciliation')

function invoke(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this },
      json(data) { resolve({ status: this.statusCode, data }) } }
    router.handle({ method: 'GET', url: path, headers }, res, error => reject(error || Error('No route')))
  })
}
test('all monthly cron routes require the secret, including readiness and worker', async () => {
  for (const path of ['/cron/reconcile-monthly-invoices', '/cron/monthly-invoice-worker', '/cron/monthly-invoice-readiness']) {
    assert.equal((await invoke(path)).status, 401)
    assert.equal((await invoke(path, { authorization: 'Bearer wrong' })).status, 401)
  }
})

test('watchdog does not dispatch when there is no active monthly run', async () => {
  const oldSecret = process.env.CRON_SECRET
  const oldStart = monthlyInvoiceReconciler.start, oldHasWork = monthlyInvoiceReconciler.hasWork
  process.env.CRON_SECRET = 'test-cron-secret'
  monthlyInvoiceReconciler.start = async () => ({ started: false, reason: 'NOT_DUE' })
  monthlyInvoiceReconciler.hasWork = async () => false
  try {
    const response = await invoke('/cron/reconcile-monthly-invoices', { authorization: 'Bearer test-cron-secret' })
    assert.equal(response.status, 200)
    assert.equal(response.data.workerDispatched, false)
  } finally {
    if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret
    monthlyInvoiceReconciler.start = oldStart; monthlyInvoiceReconciler.hasWork = oldHasWork
  }
})

test('continuation dispatches only after progress; stops on idle, completion, busy or notification failure', async () => {
  let dispatched = 0
  for (const state of ['RUNNING', 'INITIALIZED', 'REPORT_PENDING', 'IDLE', 'COMPLETE', 'BUSY', 'NOTIFICATION_RETRY']) {
    await continueMonthlyInvoiceWork(async () => ({ processed: 0, state }), async () => { dispatched++ })
  }
  assert.equal(dispatched, 3)
})

test('worker dispatcher authenticates only to the fixed backend and requires immediate acknowledgement', async () => {
  const oldSecret = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'fixture-secret'
  try {
    await dispatchMonthlyInvoiceWorker(async (url, init) => {
      assert.equal(url, `http://127.0.0.1:${process.env.PORT || 3000}/api/tuition/cron/monthly-invoice-worker`)
      assert.equal(init.headers.Authorization, 'Bearer fixture-secret')
      assert.equal(init.redirect, 'error')
      return { status: 202 }
    })
    await assert.rejects(dispatchMonthlyInvoiceWorker(async () => ({ status: 503 })), /HTTP 503/)
  } finally { if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret }
})

test('production schedule (VPS cron) runs the month-end reconciliation daily and never schedules the worker', () => {
  const jobs = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../deploy/cron/qlhv-api'), 'utf8')
    .split('\n').filter(line => /^\d/.test(line))
  const reconcile = jobs.find(line => line.endsWith('/api/tuition/cron/reconcile-monthly-invoices'))
  assert.match(reconcile, /^0 7 \* \* \* /, 'mỗi ngày 07:00; chỉ chạy thật vào ngày cuối tháng')
  assert.equal(jobs.some(line => line.includes('/api/tuition/cron/monthly-invoice-worker')), false)
  assert.equal(require('../vercel.json').crons, undefined, 'backend Vercel cũ không được chạy lịch song song')
})
