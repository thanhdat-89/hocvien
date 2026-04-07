import { Router, Request, Response, NextFunction } from 'express'
import { db, C, toDocs, paginate, serverTimestamp, s } from '../lib/firebase'
import { authenticate } from '../middleware/auth'
import { AuthRequest } from '../types'
import { ZALO_ENABLED, sendMessage, sendTuitionReminder, verifyWebhook } from '../services/zaloService'
import type { Notification } from '../types/models'

// ─── Webhook router (không yêu cầu xác thực — Zalo gọi vào) ──
export const webhookRouter = Router()

// GET /api/zalo/webhook — Zalo gửi challenge để xác minh URL
webhookRouter.get('/webhook', (req: Request, res: Response) => {
  const challenge = req.query.challenge as string | undefined
  if (challenge) {
    res.send(verifyWebhook(challenge))
  } else {
    res.json({ status: 'Zalo OA webhook endpoint' })
  }
})

// POST /api/zalo/webhook — Nhận sự kiện từ Zalo (tin nhắn đến, follow, unfollow, v.v.)
webhookRouter.post('/webhook', (req: Request, res: Response) => {
  console.log('[Zalo Webhook]', JSON.stringify(req.body))
  // TODO: Xử lý các loại event từ Zalo OA:
  // - follow: phụ huynh quan tâm OA
  // - unfollow: phụ huynh bỏ quan tâm
  // - user_send_text: phụ huynh nhắn tin
  res.json({ received: true })
})

// ─── Notification router (yêu cầu xác thực) ─────────────────
export const notificationRouter = Router()
notificationRouter.use(authenticate)

const now = () => new Date().toISOString()

// POST /api/notifications — Tạo thông báo mới, tùy chọn gửi qua Zalo
notificationRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, content, type = 'GENERAL', targetType = 'ALL', targetId, sendViaZalo = false } = req.body

    if (!title || !content) {
      res.status(400).json({ message: 'title và content là bắt buộc' })
      return
    }

    const ref = db.collection(C.NOTIFICATIONS).doc()
    const notification: Omit<Notification, 'id'> = {
      title,
      content,
      type,
      targetType,
      targetId: targetId ?? undefined,
      sendViaZalo: Boolean(sendViaZalo),
      sentAt: undefined,
      createdById: req.user?.userId,
      createdAt: now(),
    }

    await ref.set(notification)

    // Gửi qua Zalo nếu được yêu cầu
    if (sendViaZalo) {
      if (!ZALO_ENABLED) {
        // Env chưa cấu hình — lưu cờ để xử lý sau
        await ref.update({ zaloQueued: true })
        console.warn('[Zalo] Thông báo được đánh dấu zaloQueued — điền env vars để kích hoạt')
      } else {
        let zaloSuccess = false

        if (type === 'PAYMENT_DUE' && targetType === 'STUDENT' && targetId) {
          // Nhắc học phí: gửi đến phụ huynh của học viên cụ thể
          const result = await sendTuitionReminder(targetId, 0)
          zaloSuccess = result.success
        } else {
          // Thông báo chung: gửi broadcast (TODO: implement khi có danh sách followers)
          console.log('[Zalo] Broadcast chưa được hỗ trợ — cần triển khai sau')
          zaloSuccess = false
        }

        if (zaloSuccess) {
          await ref.update({ sentAt: now() })
          notification.sentAt = now()
        }
      }
    }

    res.status(201).json({ id: ref.id, ...notification })
  } catch (err) {
    next(err)
  }
})

// GET /api/notifications — Lấy danh sách thông báo (mới nhất trước)
notificationRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  as string) || 1)
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20)

    const snap = await db.collection(C.NOTIFICATIONS)
      .orderBy('createdAt', 'desc')
      .get()

    const all = toDocs<Notification>(snap)
    res.json(paginate(all, page, limit))
  } catch (err) {
    next(err)
  }
})

// POST /api/notifications/:id/send-zalo — Gửi lại qua Zalo cho thông báo đã tạo
notificationRouter.post('/:id/send-zalo', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await db.collection(C.NOTIFICATIONS).doc(s(req.params.id)).get()
    if (!doc.exists) {
      res.status(404).json({ message: 'Không tìm thấy thông báo' })
      return
    }

    if (!ZALO_ENABLED) {
      res.status(503).json({ message: 'Zalo OA chưa được cấu hình. Vui lòng điền ZALO_OA_ID và ZALO_ACCESS_TOKEN vào file .env' })
      return
    }

    const notification = doc.data() as Notification
    const result = await sendMessage('', `${notification.title}\n\n${notification.content}`)

    if (result.success) {
      await doc.ref.update({ sentAt: now(), zaloQueued: false })
      res.json({ message: 'Đã gửi qua Zalo', messageId: result.messageId })
    } else {
      res.status(500).json({ message: 'Gửi Zalo thất bại. Kiểm tra access_token và logs.' })
    }
  } catch (err) {
    next(err)
  }
})
