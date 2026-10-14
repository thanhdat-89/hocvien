import { Request, Response, NextFunction } from 'express'
import { waitUntil } from '@vercel/functions'
import { invalidateReadView } from '../services/readViews'

/** Deliver mutation responses after the shared view revision has changed. */
export function readViewInvalidation(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !/^\/api\/(students|classes)(\/|$)/.test(req.path)) {
    next(); return
  }
  const originalJson = res.json
  res.json = function(payload: any) {
    if (res.statusCode < 200 || res.statusCode >= 300) return originalJson.call(res, payload)
    const delivery = invalidateReadView('privateMissing').then(() => { originalJson.call(res, payload) })
    waitUntil(delivery)
    return res
  }
  next()
}
