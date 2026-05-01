// ================================================================
// Zalo OA Service
// ================================================================
// Tích hợp Zalo Official Account: gửi tin nhắn, refresh token, verify webhook.
// Tài liệu API: https://developers.zalo.me/docs/api/official-account-api
// ================================================================

import crypto from 'crypto'
import { db, C } from '../lib/firebase'
import type { Parent, Student } from '../types/models'

const ZALO_MSG_API  = 'https://openapi.zalo.me/v3.0/oa/message/cs'
const ZALO_TOKEN_API = 'https://oauth.zaloapp.com/v4/oa/access_token'

/** true khi env đã được điền — dùng để bỏ qua gọi API khi chưa cấu hình */
export const ZALO_ENABLED = Boolean(
  process.env.ZALO_OA_ID && process.env.ZALO_ACCESS_TOKEN
)

// ─── Token refresh ────────────────────────────────────────────

let _tokenExpiresAt = 0 // unix ms; 0 = chưa biết hạn

/**
 * Làm mới access_token bằng refresh_token.
 * Zalo access_token hết hạn sau 24h; gọi hàm này trước khi hết hạn.
 */
export async function refreshAccessToken(): Promise<boolean> {
  const appId        = process.env.ZALO_OA_ID       ?? ''
  const secretKey    = process.env.ZALO_OA_SECRET   ?? ''
  const refreshToken = process.env.ZALO_REFRESH_TOKEN ?? ''

  if (!appId || !secretKey || !refreshToken) {
    console.warn('[Zalo] Thiếu ZALO_OA_ID / ZALO_OA_SECRET / ZALO_REFRESH_TOKEN — bỏ qua refresh')
    return false
  }

  try {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      app_id: appId,
      grant_type: 'refresh_token',
    })

    const res = await fetch(ZALO_TOKEN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        secret_key: secretKey,
      },
      body: body.toString(),
    })

    const data = await res.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: number
      message?: string
    }

    if (!data.access_token) {
      console.error('[Zalo] Refresh token thất bại:', data.message ?? JSON.stringify(data))
      return false
    }

    process.env.ZALO_ACCESS_TOKEN  = data.access_token
    if (data.refresh_token) process.env.ZALO_REFRESH_TOKEN = data.refresh_token

    // trừ 5 phút buffer
    const expiresIn = data.expires_in ?? 86400
    _tokenExpiresAt = Date.now() + expiresIn * 1000 - 5 * 60 * 1000

    console.log('[Zalo] Token làm mới thành công, hết hạn:', new Date(_tokenExpiresAt).toISOString())
    return true
  } catch (err) {
    console.error('[Zalo] Lỗi khi refresh token:', err)
    return false
  }
}

/** Trả về access_token hợp lệ, tự refresh nếu sắp hết hạn */
async function getToken(): Promise<string> {
  if (_tokenExpiresAt > 0 && Date.now() >= _tokenExpiresAt) {
    await refreshAccessToken()
  }
  return process.env.ZALO_ACCESS_TOKEN ?? ''
}

// ─── Gửi tin nhắn văn bản ─────────────────────────────────────

/**
 * Gửi tin nhắn văn bản đến một Zalo user ID.
 * Lưu ý: người dùng phải đã quan tâm (follow) OA mới nhận được tin.
 */
export async function sendMessage(
  zaloUserId: string,
  message: string
): Promise<{ success: boolean; messageId?: string }> {
  if (!ZALO_ENABLED) {
    console.warn('[Zalo] Chưa cấu hình env vars — bỏ qua gửi tin nhắn.')
    return { success: false }
  }

  if (!zaloUserId) {
    console.warn('[Zalo] zaloUserId trống — bỏ qua')
    return { success: false }
  }

  try {
    const token = await getToken()
    const res = await fetch(ZALO_MSG_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: token,
      },
      body: JSON.stringify({
        recipient: { user_id: zaloUserId },
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
 * Gửi nhắc nhở học phí đến phụ huynh chính của học viên.
 * Trường `parent.zalo` phải chứa Zalo user ID (lưu khi phụ huynh follow OA).
 */
export async function sendTuitionReminder(
  studentId: string,
  amount: number
): Promise<{ success: boolean }> {
  try {
    const studentDoc = await db.collection(C.STUDENTS).doc(studentId).get()
    if (!studentDoc.exists) {
      console.warn('[Zalo] Không tìm thấy học viên:', studentId)
      return { success: false }
    }
    const student = studentDoc.data() as Student

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
      console.warn('[Zalo] Phụ huynh của', student.fullName, 'chưa có Zalo user ID')
      return { success: false }
    }

    const formatted = new Intl.NumberFormat('vi-VN').format(amount)
    const message =
      `[Math Center]\n` +
      `Kính gửi Phụ huynh học viên ${student.fullName},\n\n` +
      `Học phí tháng này là ${formatted} đ.\n` +
      `Vui lòng thanh toán trước ngày 10. Cảm ơn Quý phụ huynh!`

    return await sendMessage(parent.zalo, message)
  } catch (err) {
    console.error('[Zalo] Lỗi gửi nhắc học phí:', err)
    return { success: false }
  }
}

// ─── Xác minh Webhook ─────────────────────────────────────────

/**
 * Challenge-response: Zalo GET /webhook?challenge=xxx → trả lại đúng chuỗi đó.
 */
export function verifyWebhook(challenge: string): string {
  return challenge
}

/**
 * Xác minh chữ ký HMAC-SHA256 của webhook POST từ Zalo.
 * Header: mac (hex string)
 * Nếu ZALO_WEBHOOK_SECRET chưa set → bỏ qua (môi trường dev).
 */
export function verifyWebhookSignature(rawBody: string, mac: string): boolean {
  const secret = process.env.ZALO_WEBHOOK_SECRET ?? ''
  if (!secret) return true // dev mode: không kiểm tra

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(mac, 'hex'))
  } catch {
    return false
  }
}

// ================================================================
// ZNS — Zalo Notification Service
// ================================================================
// Khác biệt với OA CS Message ở trên:
//   - OA Message: cần PH follow OA + chỉ trong cửa sổ 48h
//   - ZNS: gửi tới SĐT bất kỳ qua template được duyệt sẵn (transaction notice)
// Tài liệu: https://developers.zalo.me/docs/zns
//
// ZNS dùng app riêng (khác OA app), token quản lý độc lập.

const ZNS_TPL_API   = 'https://business.openapi.zalo.me/message/template'
const ZNS_TOKEN_API = 'https://oauth.zaloapp.com/v4/oa/access_token'

export const ZNS_ENABLED = Boolean(
  process.env.ZNS_APP_ID && process.env.ZNS_ACCESS_TOKEN
)

let _znsTokenExpiresAt = 0

export async function refreshZnsAccessToken(): Promise<boolean> {
  const appId        = process.env.ZNS_APP_ID       ?? ''
  const secretKey    = process.env.ZNS_APP_SECRET   ?? ''
  const refreshToken = process.env.ZNS_REFRESH_TOKEN ?? ''

  if (!appId || !secretKey || !refreshToken) {
    console.warn('[ZNS] Thiếu ZNS_APP_ID / ZNS_APP_SECRET / ZNS_REFRESH_TOKEN — bỏ qua refresh')
    return false
  }

  try {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      app_id: appId,
      grant_type: 'refresh_token',
    })

    const res = await fetch(ZNS_TOKEN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        secret_key: secretKey,
      },
      body: body.toString(),
    })

    const data = await res.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: number
      message?: string
    }

    if (!data.access_token) {
      console.error('[ZNS] Refresh token thất bại:', data.message ?? JSON.stringify(data))
      return false
    }

    process.env.ZNS_ACCESS_TOKEN = data.access_token
    if (data.refresh_token) process.env.ZNS_REFRESH_TOKEN = data.refresh_token

    const expiresIn = data.expires_in ?? 86400
    _znsTokenExpiresAt = Date.now() + expiresIn * 1000 - 5 * 60 * 1000

    console.log('[ZNS] Token làm mới thành công, hết hạn:', new Date(_znsTokenExpiresAt).toISOString())
    return true
  } catch (err) {
    console.error('[ZNS] Lỗi khi refresh token:', err)
    return false
  }
}

async function getZnsToken(): Promise<string> {
  if (_znsTokenExpiresAt > 0 && Date.now() >= _znsTokenExpiresAt) {
    await refreshZnsAccessToken()
  }
  return process.env.ZNS_ACCESS_TOKEN ?? ''
}

/** Chuyển SĐT VN sang format quốc tế (84xxx). Trả '' nếu input rỗng. */
export function normalizeVnPhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D+/g, '')
  if (!digits) return ''
  if (digits.startsWith('84')) return digits
  if (digits.startsWith('0'))  return '84' + digits.slice(1)
  return '84' + digits
}

export type ZnsParams = Record<string, string | number | null | undefined>

export interface ZnsSendResult {
  success: boolean
  msgId?: string
  error?: string
  quotaRemaining?: number
  rawResponse?: unknown
}

/**
 * Gửi 1 tin ZNS theo template đã duyệt.
 * Param values sẽ được ép sang string (ZNS yêu cầu string).
 */
export async function sendZnsTemplate(
  phone: string,
  templateId: string,
  params: ZnsParams,
  trackingId?: string
): Promise<ZnsSendResult> {
  if (!ZNS_ENABLED) {
    console.warn('[ZNS] Chưa cấu hình env vars — bỏ qua gửi.')
    return { success: false, error: 'ZNS_NOT_CONFIGURED' }
  }

  const phone84 = normalizeVnPhone(phone)
  if (!phone84 || phone84.length < 10) {
    return { success: false, error: 'INVALID_PHONE' }
  }
  if (!templateId) {
    return { success: false, error: 'MISSING_TEMPLATE_ID' }
  }

  const template_data: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    template_data[k] = String(v ?? '')
  }

  try {
    const token = await getZnsToken()
    const res = await fetch(ZNS_TPL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: token,
      },
      body: JSON.stringify({
        phone: phone84,
        template_id: templateId,
        template_data,
        ...(trackingId ? { tracking_id: trackingId } : {}),
      }),
    })

    const data = await res.json() as {
      error: number
      message: string
      data?: { msg_id?: string; sent_quota?: number; remaining_quota?: number }
    }

    if (data.error !== 0) {
      console.error('[ZNS] Lỗi gửi:', data.error, data.message)
      return { success: false, error: data.message, rawResponse: data }
    }

    return {
      success: true,
      msgId: data.data?.msg_id,
      quotaRemaining: data.data?.remaining_quota,
      rawResponse: data,
    }
  } catch (err) {
    console.error('[ZNS] Lỗi kết nối API:', err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Verify chữ ký HMAC-SHA256 webhook ZNS. */
export function verifyZnsWebhookSignature(rawBody: string, mac: string): boolean {
  const secret = process.env.ZNS_WEBHOOK_SECRET ?? ''
  if (!secret) return true

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(mac, 'hex'))
  } catch {
    return false
  }
}
