import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'

import authRoutes from './routes/auth'
import studentRoutes from './routes/students'
import parentRoutes from './routes/parents'
import subjectRoutes from './routes/subjects'
import classRoutes from './routes/classes'
import scheduleRoutes from './routes/schedules'
import sessionRoutes from './routes/sessions'
import tuitionRoutes from './routes/tuition'
import misaInvoiceCron from './routes/misaInvoiceCron'
import teacherRoutes from './routes/teachers'
import dashboardRoutes from './routes/dashboard'
import { notificationRouter, webhookRouter } from './routes/notifications'
import leadRoutes from './routes/leads'
import reviewRoutes from './routes/reviews'
import materialRoutes from './routes/materials'
import publicRoutes from './routes/public'
import activityRoutes from './routes/activity'
import monthlyScoresRoutes from './routes/monthlyScores'
import sepayWebhookRoutes from './routes/webhooks'
import znsRoutes from './routes/zns'
import holidayRoutes from './routes/holidays'
import reportRoutes from './routes/reports'
import telegramRoutes from './routes/telegram'
import userRoutes from './routes/users'
import branchRoutes from './routes/branches'
import schoolYearRoutes from './routes/schoolYears'
import alertRoutes from './routes/alerts'

import { errorHandler, notFound } from './middleware/errorHandler'
import { prisma } from './lib/db'
import { activityLogMiddleware } from './middleware/activityLog'
import { readViewInvalidation } from './middleware/readViewInvalidation'

const app = express()
const PORT = process.env.PORT || 3000

// Chạy sau nginx trên cùng máy: tin X-Forwarded-For do nginx (loopback) thêm vào → req.ip là IP thật của client.
app.set('trust proxy', 'loopback')

// ─── Middleware ────────────────────────────────────────────────
app.use(helmet())
app.use(cors())
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
app.use(express.json())

// ─── Chế độ bảo trì (MAINTENANCE_MODE=true) ───────────────────
// Dùng khi chuyển máy chủ: vẫn xem và đăng nhập được; chặn mọi thao tác ghi, webhook và cron
// để không phát sinh dữ liệu mới sau lần xuất dữ liệu cuối.
const MAINTENANCE_ALLOWED_WRITES = new Set(['/api/auth/login', '/api/auth/verify-password'])
app.use((req, res, next) => {
  if (process.env.MAINTENANCE_MODE !== 'true') return next()
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !MAINTENANCE_ALLOWED_WRITES.has(req.path)
  const job = /\/cron\/|^\/api\/activity\/cleanup/.test(req.path)
  if (!write && !job) return next()
  res.setHeader('Retry-After', '1800')
  res.status(503).json({ message: 'Hệ thống đang bảo trì để chuyển máy chủ. Bạn vẫn xem được dữ liệu; thao tác lưu tạm khoá, vui lòng thử lại sau ít phút.' })
})

app.use(activityLogMiddleware)
app.use(readViewInvalidation)

// ─── Health check ─────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'ok' })
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' })
  }
})

// ─── Zalo domain verification ────────────────────────────────
app.get('/zalo_verifierMeNX2R-7MmvqfE0Z_fTD87ZfzWAKdoDSDpCn.html', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta property="zalo-platform-site-verification" content="MeNX2R-7MmvqfE0Z_fTD87ZfzWAKdoDSDpCn" />
</head>
<body>
There Is No Limit To What You Can Accomplish Using Zalo!
</body>
</html>`)
})

// ─── Routes ───────────────────────────────────────────────────
app.use('/api/auth',       authRoutes)
app.use('/api/dashboard',  dashboardRoutes)
app.use('/api/students',   studentRoutes)
app.use('/api/parents',    parentRoutes)
app.use('/api/subjects',   subjectRoutes)
app.use('/api/classes',    classRoutes)
app.use('/api/schedules',  scheduleRoutes)
app.use('/api/sessions',   sessionRoutes)
app.use('/api/tuition',    misaInvoiceCron)
app.use('/api/tuition',    tuitionRoutes)
app.use('/api/teachers',       teacherRoutes)
app.use('/api/notifications',  notificationRouter)
app.use('/api/leads',          leadRoutes)
app.use('/api/zalo',           webhookRouter)
app.use('/api/reviews',        reviewRoutes)
app.use('/api/materials',      materialRoutes)
app.use('/api/public',         publicRoutes)
app.use('/api/activity',       activityRoutes)
app.use('/api/monthly-scores', monthlyScoresRoutes)
app.use('/api/webhooks',       sepayWebhookRoutes)
app.use('/api/zns',            znsRoutes)
app.use('/api/holidays',       holidayRoutes)
app.use('/api/reports',        reportRoutes)
app.use('/api/telegram',       telegramRoutes)
app.use('/api/users',          userRoutes)
app.use('/api/branches',       branchRoutes)
app.use('/api/school-years',   schoolYearRoutes)
app.use('/api/alerts',         alertRoutes)

// ─── Error handlers ───────────────────────────────────────────
app.use(notFound)
app.use(errorHandler)

// Chỉ listen khi chạy như tiến trình (VPS/PM2 hoặc local), không phải Vercel serverless
if (!process.env.VERCEL) {
  const server = app.listen(Number(PORT), process.env.HOST || '127.0.0.1', () => {
    console.log(`🚀 Server chạy tại http://${process.env.HOST || '127.0.0.1'}:${PORT}`)
  })
  // PM2 reload/stop: ngừng nhận request mới, chờ request đang chạy xong rồi đóng kết nối database.
  const shutdown = (signal: string) => {
    console.log(`[shutdown] ${signal}`)
    server.close(() => { void prisma.$disconnect().finally(() => process.exit(0)) })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

export default app
