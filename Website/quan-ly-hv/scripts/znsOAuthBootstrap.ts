/**
 * ZNS OAuth Bootstrap — chạy 1 lần để lấy access_token + refresh_token.
 *
 * Trước khi chạy:
 *   1. Đặt ZNS_APP_ID + ZNS_APP_SECRET trong file .env (gốc project)
 *   2. Trên developers.zalo.me → app của bạn → "Cài đặt" → ô "Miền ứng dụng"
 *      → thêm: http://localhost:8888  (bắt buộc, nếu không Zalo sẽ từ chối callback)
 *      → bấm Lưu thay đổi
 *   3. Chuyển sang tab Zalo cá nhân của ADMIN OA và đăng nhập sẵn (script sẽ
 *      mở browser tới trang xin quyền — phải đăng nhập đúng admin OA mới Đồng ý được)
 *
 * Cách chạy:
 *   cd /Users/thanhdat/Website/quan-ly-hv
 *   npx tsx scripts/znsOAuthBootstrap.ts
 *
 * Sau khi script in 2 dòng ZNS_ACCESS_TOKEN= / ZNS_REFRESH_TOKEN= →
 * paste cả 2 vào Vercel env vars (Production scope của hocvien-backend) → Redeploy.
 *
 * Refresh token sống ~90 ngày; access token sống ~1h và backend tự refresh
 * (xem zaloService.refreshZnsAccessToken). Sau 90 ngày phải chạy lại script này.
 */

import 'dotenv/config'
import http from 'http'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { URL } from 'url'

const PORT          = Number(process.env.ZNS_OAUTH_PORT ?? 8888)
const REDIRECT_URI  = process.env.ZNS_OAUTH_REDIRECT_URI ?? `http://localhost:${PORT}/callback`
const AUTH_URL      = 'https://oauth.zaloapp.com/v4/oa/permission'
const TOKEN_URL     = 'https://oauth.zaloapp.com/v4/oa/access_token'
const TIMEOUT_MS    = 5 * 60 * 1000

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makePkce() {
  const verifier  = base64Url(crypto.randomBytes(48))
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function tryOpenBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'cmd'
            : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // ignore — user can copy URL manually
  }
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: string
  error?: number | string
  message?: string
}

async function exchangeCode(code: string, verifier: string, appId: string, secret: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    app_id: appId,
    grant_type: 'authorization_code',
    code_verifier: verifier,
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
    console.error('   Lấy từ developers.zalo.me → app của bạn → Cài đặt')
    console.error('   (chỉ dùng tạm để chạy script, có thể xoá khỏi .env sau khi xong)')
    process.exit(1)
  }

  const { verifier, challenge } = makePkce()
  const state = base64Url(crypto.randomBytes(16))

  const authUrl =
    `${AUTH_URL}?app_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&state=${encodeURIComponent(state)}`

  console.log('═══════════════════════════════════════════════════════════')
  console.log('🔑 ZNS OAuth Bootstrap')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log(`App ID:       ${appId}`)
  console.log(`Redirect URI: ${REDIRECT_URI}`)
  console.log(`              (URI này phải có trong "Miền ứng dụng" trên developer portal)\n`)
  console.log('1. Browser sẽ tự mở (nếu không, copy URL bên dưới):\n')
  console.log(`   ${authUrl}\n`)
  console.log('2. Đăng nhập tài khoản Zalo của ADMIN OA → bấm "Đồng ý" cấp quyền')
  console.log('3. Đợi callback về localhost — script sẽ in token\n')
  console.log('   (Hết 5 phút mà chưa cấp quyền → script tự thoát.)\n')

  const server = http.createServer(async (req, res) => {
    // Bỏ qua favicon.ico request từ browser
    if (req.url === '/favicon.ico') {
      res.writeHead(204).end()
      return
    }
    if (!req.url || !req.url.startsWith('/callback')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
      return
    }

    const u         = new URL(req.url, `http://localhost:${PORT}`)
    const code      = u.searchParams.get('code')
    const recvState = u.searchParams.get('state')
    const errParam  = u.searchParams.get('error')
    const errDesc   = u.searchParams.get('error_description') ?? ''

    if (errParam) {
      const msg = `${errParam}${errDesc ? ' — ' + errDesc : ''}`
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<h1>❌ Authorization denied</h1><p>${msg}</p>`)
      console.error('\n❌ Zalo từ chối hoặc bạn không cấp quyền:', msg)
      server.close()
      process.exit(1)
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>❌ Missing code parameter</h1>')
      return
    }

    if (recvState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>❌ State mismatch</h1>')
      console.error('\n❌ State mismatch — có khả năng CSRF, dừng để an toàn.')
      server.close()
      process.exit(1)
    }

    console.log('✓ Đã nhận code từ Zalo. Đổi sang token...')
    let tokens: TokenResponse
    try {
      tokens = await exchangeCode(code, verifier, appId, secret)
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>❌ Lỗi gọi Zalo API</h1>')
      console.error('\n❌ Lỗi network khi đổi code:', err)
      server.close()
      process.exit(1)
      return
    }

    if (!tokens.access_token || !tokens.refresh_token) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<h1>❌ Đổi token thất bại</h1><pre>${JSON.stringify(tokens, null, 2)}</pre>`)
      console.error('\n❌ Đổi token thất bại:', tokens)
      server.close()
      process.exit(1)
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`
      <html><body style="font-family: sans-serif; padding: 40px; max-width: 600px;">
        <h1 style="color: #059669">✅ Thành công</h1>
        <p>Đã lấy được token cho ZNS app.</p>
        <p>Quay lại <strong>terminal</strong> để xem giá trị, copy vào Vercel env vars.</p>
        <p style="color: #666; font-size: 13px">Có thể đóng tab này.</p>
      </body></html>
    `)

    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('✅ Copy 2 dòng dưới vào Vercel env vars (Production):')
    console.log('═══════════════════════════════════════════════════════════\n')
    console.log(`ZNS_ACCESS_TOKEN=${tokens.access_token}`)
    console.log(`ZNS_REFRESH_TOKEN=${tokens.refresh_token}\n`)
    console.log('───────────────────────────────────────────────────────────')
    console.log(`Access token hết hạn sau ${tokens.expires_in ?? '?'} giây.`)
    console.log('Backend sẽ tự refresh khi cần (refresh_token sống ~90 ngày).')
    console.log('Sau khi paste vào Vercel → Redeploy → vào /zns tab Cấu hình verify.\n')

    server.close()
    setTimeout(() => process.exit(0), 100)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} đang bận. Đặt biến ZNS_OAUTH_PORT=khác hoặc kill process đang dùng.`)
    } else {
      console.error('❌ Lỗi server:', err)
    }
    process.exit(1)
  })

  server.listen(PORT, () => {
    console.log(`📡 Lắng nghe callback tại ${REDIRECT_URI}\n`)
    tryOpenBrowser(authUrl)
  })

  setTimeout(() => {
    console.error('\n⏰ Hết 5 phút mà chưa có callback — thoát.')
    server.close()
    process.exit(1)
  }, TIMEOUT_MS)
}

main().catch(err => {
  console.error('❌ Lỗi:', err)
  process.exit(1)
})
