import { Request, Response, NextFunction } from 'express'

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error(err)

  // Lỗi Prisma: bản ghi cần sửa/xoá không tồn tại, hoặc vi phạm ràng buộc unique (thay cho kiểm tra trùng trong transaction Firestore).
  const code = (err as { code?: string } | null)?.code
  if (code === 'P2025') { res.status(404).json({ message: 'Không tìm thấy dữ liệu' }); return }
  if (code === 'P2002') { res.status(409).json({ message: 'Dữ liệu đã tồn tại (trùng lặp)' }); return }
  if (code === 'P2003') { res.status(409).json({ message: 'Dữ liệu đang được tham chiếu hoặc tham chiếu không tồn tại' }); return }

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
