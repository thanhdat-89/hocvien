import { Request, Response, NextFunction } from 'express'

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error(err)

  if (err instanceof Error) {
    const status = (err as { status?: number }).status ?? 500
    res.status(status).json({ message: err.message || 'Lỗi server' })
    return
  }

  res.status(500).json({ message: 'Lỗi server không xác định' })
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ message: 'Endpoint không tồn tại' })
}

export function createError(message: string, status: number): Error & { status: number } {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}
