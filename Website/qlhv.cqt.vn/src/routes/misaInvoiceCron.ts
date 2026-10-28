import { timingSafeEqual } from 'node:crypto'
import { Router, type RequestHandler } from 'express'
import { processPendingInvoices } from '../services/invoiceOutbox'
import { monthlyInvoiceReconciler } from '../services/monthlyInvoiceReconciliation'
import { waitUntil } from '@vercel/functions'
import { checkTelegramConnection } from '../services/telegramService'
import { listInvoiceTemplates } from '../services/misaInvoicePreview'
import { chooseDefaultInvoiceTemplate } from '../services/misaAutoDraft'
import { monthlyInvoiceSchedule } from '../services/monthlyInvoiceReconciliation'

export async function dispatchMonthlyInvoiceWorker(request: typeof fetch = fetch) {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('Thiếu CRON_SECRET cho worker đối chiếu hóa đơn.')
  const response = await request('https://api.qlhv.cqt.vn/api/tuition/cron/monthly-invoice-worker', {
    method: 'GET', headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(5000),
  })
  if (response.status !== 202) throw new Error(`Worker đối chiếu chưa nhận việc (HTTP ${response.status}).`)
}

export async function continueMonthlyInvoiceWork(tick = () => monthlyInvoiceReconciler.tick(), dispatch = () => dispatchMonthlyInvoiceWorker()) {
  const result = await tick()
  if (['RUNNING', 'INITIALIZED', 'REPORT_PENDING'].includes(result.state)) await dispatch()
  return result
}

const router = Router()
const authorizeCron: RequestHandler = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  const secret = process.env.CRON_SECRET
  const supplied = req.headers.authorization
  const expected = secret ? `Bearer ${secret}` : ''
  if (!expected || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    res.status(401).json({ message: 'Không có quyền xử lý hàng đợi hóa đơn.' }); return
  }
  next()
}
router.get('/cron/process-invoices', authorizeCron, async (_req, res, next) => {
  try { res.json(await processPendingInvoices()) } catch (error) { next(error) }
})
router.get('/cron/reconcile-monthly-invoices', authorizeCron, async (_req, res, next) => {
  try {
    const result = await monthlyInvoiceReconciler.start()
    // Daily watchdog also resumes saved work/report delivery from previous dates.
    const active = await monthlyInvoiceReconciler.hasWork()
    if (active) await dispatchMonthlyInvoiceWorker()
    res.json({ ...result, workerDispatched: active })
  } catch (error) { next(error) }
})
router.get('/cron/monthly-invoice-readiness', authorizeCron, async (_req, res, next) => {
  try {
    const schedule = monthlyInvoiceSchedule()
    const telegram = await checkTelegramConnection()
    const template = chooseDefaultInvoiceTemplate(await listInvoiceTemplates(schedule.year))
    res.json({ telegram: telegram.state, template: template ? 'READY' : 'MISSING_OR_AMBIGUOUS',
      period: schedule.period, due: schedule.due })
  } catch (error) { next(error) }
})
router.get('/cron/monthly-invoice-worker', authorizeCron, async (_req, res, next) => {
  try {
    // Acknowledge before doing provider I/O so the previous worker can finish.
    waitUntil(continueMonthlyInvoiceWork().catch(() => { console.warn('[Monthly invoices] worker interrupted; saved progress will resume at the next daily watchdog.') }))
    res.status(202).json({ accepted: true })
  } catch (error) { next(error) }
})
export default router
