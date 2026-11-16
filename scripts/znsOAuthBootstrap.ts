/**
 * ZNS OAuth Bootstrap — chạy 1 lần để lấy access_token + refresh_token.
 *
 * Trước khi chạy:
 *   1. ZNS_APP_ID + ZNS_APP_SECRET trong .env (gốc project).
 *   2. Trên developers.zalo.me → app ZNS:
 *      - Cài đặt → "Miền ứng dụng" có qlhv.cqt.vn (đã làm)
 *      - Sản phẩm → Official Account → Thiết lập chung →
 *        "Official Account Callback Url" = https://qlhv.cqt.vn (đã set + Cập nhật)
 *      - Tick "Quyền: Gửi tin qua số điện thoại" + "Quyền: Quản lý Message Template"
 *   3. Đăng nhập tài khoản Zalo cá nhân của ADMIN OA Math Center sẵn trong browser.
 *
 * Chạy:
 *   cd /Users/thanhdat/Website/quan-ly-hv
 *   npx tsx scripts/znsOAuthBootstrap.ts
 *
 * Sau khi script in 2 dòng ZNS_ACCESS_TOKEN= / ZNS_REFRESH_TOKEN= →
 * paste cả 2 vào Vercel env vars (Production của hocvien-backend) → Redeploy.
 *
 * Refresh token sống ~90 ngày; backend tự refresh access_token trong khoảng đó.
 *
 * Lưu ý: KHÔNG dùng PKCE (code_challenge/code_verifier) vì Zalo OA OAuth v4
 * không hỗ trợ PKCE qua URL params. Bảo vệ CSRF bằng state.
 */

import 'dotenv/config'
import crypto from 'crypto'
import readline from 'readline'
import { spawn } from 'child_process'
import { URL } from 'url'

const REDIRECT_URI =
  process.env.ZNS_OAUTH_REDIRECT_URI ?? 'https://qlhv.cqt.vn'
const AUTH_URL  = 'https://oauth.zaloapp.com/v4/oa/permission'
const TOKEN_URL = 'https://oauth.zaloapp.com/v4/oa/access_token'

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function tryOpenBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'cmd'
            : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // ignore — user will copy URL manually
  }
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, ans => {
      rl.close()
      resolve(ans.trim())
    })
  })
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: string
  error?: number | string
  message?: string
}

async function exchangeCode(
  code: string,
  appId: string,
  secret: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    app_id: appId,
    grant_type: 'authorization_code',
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      secret_key: secret,
    },
    body: body.toString(),
  })

  return res.json() as Promise<TokenResponse>
}

async function main() {
  const appId  = process.env.ZNS_APP_ID
  const secret = process.env.ZNS_APP_SECRET

  if (!appId || !secret) {
    console.error('❌ Cần set ZNS_APP_ID và ZNS_APP_SECRET trong .env trước.')
    process.exit(1)
  }

  // State chỉ để chống CSRF, không bắt buộc nhưng dùng cho an toàn.
  const state = base64Url(crypto.randomBytes(16))

  const authUrl =
    `${AUTH_URL}?app_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`

  console.log('═══════════════════════════════════════════════════════════')
  console.log('🔑 ZNS OAuth Bootstrap (no PKCE — Zalo OA v4)')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log(`App ID:       ${appId}`)
  console.log(`Redirect URI: ${REDIRECT_URI}\n`)
  console.log('Bước 1. Browser sẽ tự mở (nếu không, copy URL bên dưới):\n')
  console.log(`  ${authUrl}\n`)
  console.log('Bước 2. Đăng nhập tài khoản Zalo của ADMIN OA → bấm "Cho phép"/"Đồng ý"\n')
  console.log('Bước 3. Browser sẽ redirect tới:')
  console.log(`  ${REDIRECT_URI}/?code=XXXXX&state=YYYY  (hoặc có oa_id=...)\n`)
  console.log('  Copy TOÀN BỘ URL từ thanh địa chỉ paste vào đây:\n')

  tryOpenBrowser(authUrl)

  const callbackUrl = await prompt('Paste callback URL: ')
  if (!callbackUrl) {
    console.error('❌ Bạn chưa paste URL.')
    process.exit(1)
  }

  let parsed: URL
  try {
    parsed = new URL(callbackUrl)
  } catch {
    console.error('❌ URL không hợp lệ:', callbackUrl)
    process.exit(1)
    return
  }

  const code      = parsed.searchParams.get('code')
  const recvState = parsed.searchParams.get('state')
  const errParam  = parsed.searchParams.get('error')
  const errDesc   = parsed.searchParams.get('error_description') ?? ''

  if (errParam) {
    console.error(`❌ Zalo trả lỗi: ${errParam}${errDesc ? ' — ' + errDesc : ''}`)
    process.exit(1)
  }
  if (!code) {
    console.error('❌ URL không có ?code= — paste sai URL hoặc OAuth thất bại.')
    process.exit(1)
  }
  if (recvState && recvState !== state) {
    console.error('❌ State mismatch — paste URL từ session khác. Chạy lại script.')
    process.exit(1)
  }

  console.log('\n✓ URL hợp lệ. Đổi code lấy token...')

  let tokens: TokenResponse
  try {
    tokens = await exchangeCode(code, appId, secret)
  } catch (err) {
    console.error('❌ Lỗi gọi Zalo API:', err)
    process.exit(1)
    return
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    console.error('❌ Đổi token thất bại:', tokens)
    process.exit(1)
    return
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('✅ Copy 2 dòng dưới vào Vercel env vars (Production):')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log(`ZNS_ACCESS_TOKEN=${tokens.access_token}`)
  console.log(`ZNS_REFRESH_TOKEN=${tokens.refresh_token}\n`)
  console.log('───────────────────────────────────────────────────────────')
  console.log(`Access token hết hạn sau ${tokens.expires_in ?? '?'} giây.`)
  console.log('Backend tự refresh khi cần (refresh_token sống ~90 ngày).')
  console.log('Sau khi paste vào Vercel → Redeploy → vào /zns tab Cấu hình verify.\n')
}

main().catch(err => {
  console.error('❌ Lỗi không bắt được:', err)
  process.exit(1)
})
