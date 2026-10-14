import { Request, Response, NextFunction } from 'express'
import { waitUntil } from '@vercel/functions'
import { invalidateReadView, ViewKind } from '../services/readViews'

/** Deliver mutation responses after the shared view revision has changed. */
export function readViewInvalidation(req: Request, res: Response, next: NextFunction) {
  const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
  const studentOrClass = mutation && /^\/api\/(students|classes)(\/|$)/.test(req.path)
  const financial = mutation && /^\/api\/(tuition|schedules|sessions|holidays|attendance|parents)(\/|$)/.test(req.path)
    && !/^\/api\/tuition\/misa(\/|$)/.test(req.path)
  const sepay = mutation && req.path === '/api/webhooks/sepay'
  const cron = req.method === 'GET' && req.path === '/api/schedules/cron/generate-monthly'
  if (!studentOrClass && !financial && !sepay && !cron) {
    next(); return
  }
  const originalJson = res.json
  res.json = function(payload: any) {
    if (res.statusCode < 200 || res.statusCode >= 300) return originalJson.call(res, payload)
    if (sepay && (payload?.idempotent === true || ['unmatched', 'ignored_outbound'].includes(payload?.status))) {
      return originalJson.call(res, payload)
    }
    const kinds: ViewKind[] = studentOrClass
      ? ['privateMissing', 'studentsIndex', 'tuition', 'dashboard'] : ['tuition', 'dashboard']
    const delivery = Promise.all(kinds.map(invalidateReadView)).then(() => { originalJson.call(res, payload) })
    waitUntil(delivery)
    return res
  }
  next()
}
