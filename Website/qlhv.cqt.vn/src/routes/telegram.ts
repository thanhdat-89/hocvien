import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import { checkTelegramConnection, sendTelegramMessage, telegramConfigStatus } from '../services/telegramService'

const router = Router()
router.use(authenticate, requireRole('ADMIN'))
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })

router.get('/connection', async (_req, res, next) => {
  try { res.json(await checkTelegramConnection()) } catch (error) { next(error) }
})

router.post('/test', async (_req, res, next) => {
  try {
    const config = telegramConfigStatus()
    if (!config.configured) { res.status(503).json({ ...config, sent: false }); return }
    const result = await sendTelegramMessage('✅ Math Center: kết nối Telegram thành công. Bot sẽ thông báo khi MISA xác nhận tạo hóa đơn mới chưa phát hành.')
    res.status(result.sent ? 200 : 502).json(result)
  } catch (error) { next(error) }
})

export default router
