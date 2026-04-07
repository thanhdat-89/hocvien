// ================================================================
// Zalo OA Service
// ================================================================
// Scaffold để chuẩn bị tích hợp Zalo Official Account.
// Khi đã có OA và điền đủ env vars, các hàm này sẽ hoạt động thực sự.
//
// Tài liệu API: https://developers.zalo.me/docs/api/official-account-api
// ================================================================

import { db, C } from '../lib/firebase'
import type { Parent, Student } from '../types/models'

const ZALO_API = 'https://openapi.zalo.me/v2.0/oa'

/** true khi env đã được điền — dùng để bỏ qua gọi API khi chưa cấu hình */
export const ZALO_ENABLED = Boolean(
  process.env.ZALO_OA_ID && process.env.ZALO_ACCESS_TOKEN
)

// ─── Gửi tin nhắn văn bản ─────────────────────────────────────

/**
 * Gửi tin nhắn văn bản đến một số điện thoại Zalo.
 * Lưu ý: Số điện thoại phải là người đã quan tâm (follow) OA thì mới nhận được.
 */
export async function sendMessage(
  phone: string,
  message: string
): Promise<{ success: boolean; messageId?: string }> {
  if (!ZALO_ENABLED) {
    console.warn('[Zalo] ZALO_OA_ID hoặc ZALO_ACCESS_TOKEN chưa được cấu hình. Bỏ qua gửi tin nhắn.')
    return { success: false }
  }

  try {
    const res = await fetch(`${ZALO_API}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': process.env.ZALO_ACCESS_TOKEN!,
      },
      body: JSON.stringify({
        recipient: { user_id: phone },
        message: { text: message },
      }),
    })

    const data = await res.json() as { error: number; message: string; data?: { message_id: string } }

    if (data.error !== 0) {
      console.error('[Zalo] Lỗi gửi tin nhắn:', data.message)
      return { success: false }
    }

    return { success: true, messageId: data.data?.message_id }
  } catch (err) {
    console.error('[Zalo] Lỗi kết nối API:', err)
    return { success: false }
  }
}

// ─── Nhắc học phí ─────────────────────────────────────────────

/**
 * Gửi nhắc nhở học phí đến phụ huynh chính có SĐT Zalo của học viên.
 */
export async function sendTuitionReminder(
  studentId: string,
  amount: number
): Promise<{ success: boolean }> {
  try {
    // Lấy thông tin học viên
    const studentDoc = await db.collection(C.STUDENTS).doc(studentId).get()
    if (!studentDoc.exists) {
      console.warn('[Zalo] Không tìm thấy học viên:', studentId)
      return { success: false }
    }
    const student = studentDoc.data() as Student

    // Tìm phụ huynh chính có SĐT Zalo
    const parentsSnap = await db.collection(C.STUDENTS).doc(studentId)
      .collection('parents')
      .where('isPrimaryContact', '==', true)
      .limit(1)
      .get()

    if (parentsSnap.empty) {
      console.warn('[Zalo] Học viên', studentId, 'không có phụ huynh chính')
      return { success: false }
    }

    const parent = parentsSnap.docs[0].data() as Parent

    if (!parent.zalo) {
      console.warn('[Zalo] Phụ huynh của', student.fullName, 'chưa có SĐT Zalo')
      return { success: false }
    }

    const formatted = new Intl.NumberFormat('vi-VN').format(amount)
    const message = `Kính gửi Phụ huynh học viên ${student.fullName},\n\nHọc phí tháng này là ${formatted} đ. Vui lòng thanh toán trước ngày 10. Cảm ơn Quý phụ huynh!`

    return await sendMessage(parent.zalo, message)
  } catch (err) {
    console.error('[Zalo] Lỗi gửi nhắc học phí:', err)
    return { success: false }
  }
}

// ─── Xác minh Webhook ─────────────────────────────────────────

/**
 * Xác minh webhook theo cơ chế challenge-response của Zalo OA.
 * Zalo sẽ gửi GET request với query param `challenge` và kỳ vọng nhận lại đúng chuỗi đó.
 */
export function verifyWebhook(challenge: string): string {
  return challenge
}
