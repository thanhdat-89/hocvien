import { timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import { processPendingInvoices } from '../services/invoiceOutbox'

const router = Router()
router.get('/cron/process-invoices', async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  const secret = process.env.CRON_SECRET
  const supplied = req.headers.authorization
  const expected = secret ? `Bearer ${secret}` : ''
  if (!expected || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    res.status(401).json({ message: 'Không có quyền xử lý hàng đợi hóa đơn.' }); return
  }
  try { res.json(await processPendingInvoices()) } catch (error) { next(error) }
})
export default router
