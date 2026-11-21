import { execFile } from 'node:child_process'
import { chmod, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { createError } from '../middleware/errorHandler'
import { sendTelegramMessage } from '../services/telegramService'

const run = promisify(execFile)

/**
 * Điểm khôi phục trước thao tác nguy hiểm (xoá học viên, tính học phí hàng loạt, tạo lịch tháng…): pg_dump cả database
 * qlhv vào CHECKPOINT_DIR, tên file ghi lý do + người làm. Không đặt CHECKPOINT_DIR → tắt (dev / kiểm thử).
 * Sao lưu lỗi → ném 503, thao tác KHÔNG được thực hiện (không ghi khi chưa có đường lui) và báo Telegram.
 * Danh sách thao tác: middleware/checkpointGuard.ts. Khôi phục: db/vps/README.md (qlhv-restore-rows).
 */
export const CHECKPOINT_KEEP_DAYS = 14
/** Cùng người + cùng phạm vi + cùng lý do trong khoảng này → dùng lại điểm khôi phục vừa tạo (bấm lại liên tục) */
const THROTTLE_MS = 5 * 60_000

const recent = new Map<string, number>()
let queue: Promise<unknown> = Promise.resolve()

function config() {
  const dir = process.env.CHECKPOINT_DIR
  if (!dir) return null
  // Truyền kết nối qua biến PG* (không đặt mật khẩu trên dòng lệnh → không lộ trong ps / thông báo lỗi)
  const u = new URL(process.env.DATABASE_URL ?? '')
  const pgEnv = {
    PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
  }
  return { dir, bin: process.env.PG_DUMP || 'pg_dump', env: { ...process.env, ...pgEnv } }
}

const slug = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40)

function stamp(d = new Date()) {
  // Giờ Việt Nam cho dễ đọc: 20261120-143205
  const vn = new Date(d.getTime() + 7 * 3600_000).toISOString()
  return vn.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
}

/**
 * Tạo điểm khôi phục rồi mới cho thao tác chạy tiếp. Trả về tên file (null nếu tắt / dùng lại bản vừa tạo).
 * `scopeKey` phân biệt đối tượng (học viên, lớp…) để chống tạo trùng khi bấm lại liên tục.
 */
export async function checkpoint(user: string, reason: string, scopeKey: string): Promise<string | null> {
  const cfg = config()
  if (!cfg) return null
  const key = `${reason}|${scopeKey}|${user}`
  const last = recent.get(key)
  if (last && Date.now() - last < THROTTLE_MS) return null

  // Lần lượt từng bản (nhiều request cùng lúc không chạy song song nhiều pg_dump)
  const job = queue.then(async () => {
    await mkdir(cfg.dir, { recursive: true, mode: 0o700 })
    const file = path.join(cfg.dir, `pre-${slug(reason)}-${stamp()}-${slug(scopeKey)}-${slug(user)}.dump`)
    try {
      await run(cfg.bin, ['-Fc', '-f', `${file}.tmp`], { timeout: 60_000, env: cfg.env })
      if (!(await stat(`${file}.tmp`)).size) throw new Error('bản sao lưu rỗng')
      await rename(`${file}.tmp`, file)
      await chmod(file, 0o600)
      return path.basename(file)
    } catch (err) {
      await rm(`${file}.tmp`, { force: true })
      throw err
    }
  })
  queue = job.catch(() => undefined)

  try {
    const name = await job
    recent.set(key, Date.now())
    prune(cfg.dir).catch(err => console.error('checkpoint prune:', err.message))
    return name
  } catch (err) {
    // Chỉ stderr / mã thoát — message của execFile chứa nguyên dòng lệnh
    const e = err as { stderr?: string; code?: number | string; killed?: boolean; message: string }
    const msg = e.stderr?.trim() || (e.killed ? 'quá 60 giây' : e.code !== undefined ? `${cfg.bin} thoát mã ${e.code}` : e.message)
    console.error(`checkpoint ${reason} lỗi:`, msg)
    void sendTelegramMessage(`⚠️ [qlhv.cqt.vn] KHÔNG tạo được điểm khôi phục trước "${reason}" (${scopeKey}, ${user}) — thao tác đã bị chặn.\n${msg.slice(0, 500)}`)
      .catch(() => undefined)
    throw createError('Không tạo được bản sao lưu trước thao tác này nên chưa thực hiện. Thử lại sau ít phút hoặc báo quản trị.', 503)
  }
}

async function prune(dir: string) {
  const cutoff = Date.now() - CHECKPOINT_KEEP_DAYS * 86400_000
  for (const f of await readdir(dir)) {
    if (!f.startsWith('pre-') || !f.endsWith('.dump')) continue
    const p = path.join(dir, f)
    if ((await stat(p)).mtimeMs < cutoff) await rm(p, { force: true })
  }
}

/** Chỉ cho kiểm thử: quên các lần tạo gần đây */
export function resetCheckpointThrottle() { recent.clear() }
