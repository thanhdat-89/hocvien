import { Router, Request, Response, NextFunction } from 'express'
import { db, C, toDocs, paginate, serverTimestamp, s } from '../lib/firebase'
import { authenticate } from '../middleware/auth'
import { AuthRequest } from '../types'
import { ZALO_ENABLED, sendMessage, sendTuitionReminder, verifyWebhook, verifyWebhookSignature } from '../services/zaloService'
import type { Notification, Lead } from '../types/models'

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

// ─── Chatbot: kịch bản thu thập thông tin khách hàng ─────────

const CHAT_MESSAGES = {
  welcome:
    `Chào mừng Quý phụ huynh đến với Math Center! 🎓\n\n` +
    `Trung tâm chuyên dạy thêm Toán cho học sinh các khối lớp.\n\n` +
    `Để tư vấn phù hợp, em xin phép hỏi vài thông tin ngắn ạ.\n\n` +
    `👤 Cho em xin họ tên Phụ huynh ạ?`,
  askStudent:
    `Cảm ơn anh/chị! 🙏\n\n` +
    `📚 Cho em xin tên và lớp (khối) của con ạ?\n\n` +
    `Ví dụ: Nguyễn Văn A - Lớp 9`,
  askPhone:
    `Em xin cảm ơn! 📝\n\n` +
    `📱 Cho em xin SĐT để tiện liên hệ tư vấn ạ?\n\n` +
    `Ví dụ: 0987011289`,
  thanks:
    `Cảm ơn anh/chị đã cung cấp thông tin! ✅\n\n` +
    `Trung tâm sẽ liên hệ tư vấn trong thời gian sớm nhất ạ.\n\n` +
    `Nếu cần hỗ trợ gấp, vui lòng gọi: 0987 011 289`,
  alreadyDone:
    `Cảm ơn tin nhắn của anh/chị! Trung tâm sẽ phản hồi sớm nhất ạ. 🙏`,
}

function normalizePhone(input: string): string | null {
  let phone = input.replace(/[\s.\-()]/g, '')
  if (phone.startsWith('+84')) phone = '0' + phone.slice(3)
  if (phone.startsWith('84') && phone.length === 11) phone = '0' + phone.slice(2)
  if (/^0\d{9}$/.test(phone)) return phone
  return null
}

function parseStudentInfo(text: string): { name: string; grade?: string } {
  // Thử tách theo dấu "-" hoặc ","
  const parts = text.split(/[-,]/).map(s => s.trim()).filter(Boolean)
  if (parts.length >= 2) {
    return { name: parts[0], grade: parts.slice(1).join(' ') }
  }
  // Thử tìm "lớp X" trong text
  const gradeMatch = text.match(/l[oớ]p\s*(\d+\w*)/i)
  if (gradeMatch) {
    const grade = gradeMatch[0]
    const name = text.replace(grade, '').replace(/[-,]/g, '').trim()
    return { name: name || text, grade }
  }
  return { name: text }
}

async function getOrCreateLead(zaloUserId: string): Promise<Lead & { docId: string }> {
  const snap = await db.collection(C.LEADS)
    .where('zaloUserId', '==', zaloUserId).limit(1).get()

  if (!snap.empty) {
    const doc = snap.docs[0]
    return { id: doc.id, docId: doc.id, ...doc.data() } as Lead & { docId: string }
  }

  const ref = db.collection(C.LEADS).doc()
  const lead: Omit<Lead, 'id'> = {
    zaloUserId,
    status: 'NEW',
    chatStep: 0,
    source: 'zalo_oa',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await ref.set(lead)
  return { id: ref.id, docId: ref.id, ...lead }
}

// POST /api/zalo/webhook — Nhận sự kiện từ Zalo
webhookRouter.post('/webhook', async (req: Request, res: Response) => {
  const mac = req.headers['mac'] as string | undefined
  const rawBody = JSON.stringify(req.body)
  if (mac && !verifyWebhookSignature(rawBody, mac)) {
    res.status(401).json({ message: 'Invalid signature' })
    return
  }

  const event = req.body as {
    event_name?: string
    follower?: { id: string }
    sender?:   { id: string }
    message?:  { text: string }
  }

  console.log('[Zalo Webhook]', event.event_name, JSON.stringify(event))

  try {
    // ── Follow: chào mừng + bắt đầu thu thập thông tin ──
    if (event.event_name === 'follow' && event.follower?.id) {
      const zaloUserId = event.follower.id
      const lead = await getOrCreateLead(zaloUserId)

      if (lead.chatStep === 0 || lead.status === 'NEW') {
        await db.collection(C.LEADS).doc(lead.docId).update({
          chatStep: 1, status: 'COLLECTING', updatedAt: new Date().toISOString(),
        })
        await sendMessage(zaloUserId, CHAT_MESSAGES.welcome)
      }
    }

    // ── Message: xử lý từng bước chatbot ──
    if (event.event_name === 'user_send_text' && event.sender?.id && event.message?.text) {
      const zaloUserId = event.sender.id
      const text = event.message.text.trim()
      const lead = await getOrCreateLead(zaloUserId)
      const docRef = db.collection(C.LEADS).doc(lead.docId)
      const now = new Date().toISOString()

      switch (lead.chatStep) {
        case 0:
        case 1: {
          // Bước 1: nhận tên phụ huynh → hỏi tên con
          await docRef.update({ parentName: text, chatStep: 2, updatedAt: now })
          await sendMessage(zaloUserId, `Cảm ơn anh/chị ${text}! 🙏\n\n📚 Cho em xin tên và lớp (khối) của con ạ?\n\nVí dụ: Nguyễn Văn A - Lớp 9`)
          break
        }
        case 2: {
          // Bước 2: nhận tên con + lớp → hỏi SĐT
          const { name, grade } = parseStudentInfo(text)
          await docRef.update({ studentName: name, gradeLevel: grade, chatStep: 3, updatedAt: now })
          await sendMessage(zaloUserId, CHAT_MESSAGES.askPhone)
          break
        }
        case 3: {
          // Bước 3: nhận SĐT → hoàn tất
          const phone = normalizePhone(text)
          if (!phone) {
            await sendMessage(zaloUserId, `SĐT chưa đúng ạ. Vui lòng nhập lại (10 chữ số).\n\nVí dụ: 0987011289`)
            break
          }
          await docRef.update({ phone, chatStep: 4, status: 'COMPLETED', updatedAt: now })

          // Tự động liên kết với parent record nếu tìm thấy SĐT
          await tryLinkParent(phone, zaloUserId)

          await sendMessage(zaloUserId, CHAT_MESSAGES.thanks)
          break
        }
        default: {
          // Đã hoàn tất → trả lời mặc định
          await sendMessage(zaloUserId, CHAT_MESSAGES.alreadyDone)
          break
        }
      }
    }

    // ── Unfollow ──
    if (event.event_name === 'unfollow' && event.follower?.id) {
      console.log('[Zalo] Unfollow:', event.follower.id)
    }
  } catch (err) {
    console.error('[Zalo Webhook] Lỗi:', err)
  }

  res.json({ received: true })
})

// ─── Helper: tự động liên kết SĐT với parent record ─────────

async function tryLinkParent(phone: string, zaloUserId: string) {
  const studentsSnap = await db.collection(C.STUDENTS).get()
  for (const studentDoc of studentsSnap.docs) {
    const parentsSnap = await studentDoc.ref.collection('parents')
      .where('phone', '==', phone).limit(1).get()
    if (!parentsSnap.empty) {
      await parentsSnap.docs[0].ref.update({ zalo: zaloUserId })
      console.log(`[Zalo] Tự động liên kết ${phone} → ${zaloUserId}`)
      return
    }
  }
}

// ─── Helpers: lấy danh sách Zalo user ID theo đối tượng ──────

async function getZaloRecipients(targetType: string, targetId?: string): Promise<string[]> {
  const zaloIds: string[] = []

  if (targetType === 'STUDENT' && targetId) {
    // Gửi cho phụ huynh chính của 1 học viên
    const snap = await db.collection(C.STUDENTS).doc(targetId)
      .collection('parents').where('isPrimaryContact', '==', true).limit(1).get()
    snap.docs.forEach(d => { if (d.data().zalo) zaloIds.push(d.data().zalo) })

  } else if (targetType === 'CLASS' && targetId) {
    // Gửi cho phụ huynh của tất cả học viên trong lớp
    const enrollSnap = await db.collection(C.ENROLLMENTS)
      .where('classId', '==', targetId).get()
    for (const doc of enrollSnap.docs) {
      const studentId = doc.data().studentId
      const parentSnap = await db.collection(C.STUDENTS).doc(studentId)
        .collection('parents').where('isPrimaryContact', '==', true).limit(1).get()
      parentSnap.docs.forEach(d => { if (d.data().zalo) zaloIds.push(d.data().zalo) })
    }

  } else {
    // ALL: lấy tất cả phụ huynh có Zalo user ID
    const studentsSnap = await db.collection(C.STUDENTS)
      .where('status', '==', 'ACTIVE').get()
    for (const studentDoc of studentsSnap.docs) {
      const parentSnap = await db.collection(C.STUDENTS).doc(studentDoc.id)
        .collection('parents').where('isPrimaryContact', '==', true).limit(1).get()
      parentSnap.docs.forEach(d => { if (d.data().zalo) zaloIds.push(d.data().zalo) })
    }
  }

  // Loại bỏ trùng lặp
  return [...new Set(zaloIds)]
}

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
        await ref.update({ zaloQueued: true })
        console.warn('[Zalo] Thông báo được đánh dấu zaloQueued — điền env vars để kích hoạt')
      } else {
        const zaloMessage = `[Math Center]\n${title}\n\n${content}`
        const zaloUserIds = await getZaloRecipients(targetType, targetId)

        let sentCount = 0
        for (const uid of zaloUserIds) {
          const result = await sendMessage(uid, zaloMessage)
          if (result.success) sentCount++
        }

        if (sentCount > 0) {
          await ref.update({ sentAt: now(), zaloSentCount: sentCount, zaloTotalTargets: zaloUserIds.length })
          notification.sentAt = now()
        }

        console.log(`[Zalo] Đã gửi ${sentCount}/${zaloUserIds.length} tin nhắn`)
      }
    }

    res.status(201).json({ id: ref.id, ...notification })
  } catch (err) {
    next(err)
  }
})

// GET /api/notifications/targets — Lấy danh sách lớp & học viên cho dropdown
notificationRouter.get('/targets', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [classesSnap, studentsSnap] = await Promise.all([
      db.collection(C.CLASSES).where('status', '==', 'ACTIVE').get(),
      db.collection(C.STUDENTS).where('status', '==', 'ACTIVE').get(),
    ])
    res.json({
      classes: classesSnap.docs.map(d => ({ id: d.id, name: d.data().name })),
      students: studentsSnap.docs.map(d => ({ id: d.id, fullName: d.data().fullName })),
    })
  } catch (err) { next(err) }
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
    const zaloMessage = `[Math Center]\n${notification.title}\n\n${notification.content}`
    const zaloUserIds = await getZaloRecipients(notification.targetType, notification.targetId)

    if (zaloUserIds.length === 0) {
      res.status(400).json({ message: 'Không tìm thấy phụ huynh nào có Zalo user ID để gửi' })
      return
    }

    let sentCount = 0
    for (const uid of zaloUserIds) {
      const result = await sendMessage(uid, zaloMessage)
      if (result.success) sentCount++
    }

    if (sentCount > 0) {
      await doc.ref.update({ sentAt: now(), zaloQueued: false, zaloSentCount: sentCount })
      res.json({ message: `Đã gửi ${sentCount}/${zaloUserIds.length} tin nhắn qua Zalo` })
    } else {
      res.status(500).json({ message: 'Gửi Zalo thất bại. Kiểm tra access_token và logs.' })
    }
  } catch (err) {
    next(err)
  }
})
