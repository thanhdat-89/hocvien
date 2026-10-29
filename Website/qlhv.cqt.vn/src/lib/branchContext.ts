import { prisma, Tx } from './db'
import { createError } from '../middleware/errorHandler'

// ─── Cơ sở & năm học mặc định ─────────────────────────────────
// Chưa có ô chọn cơ sở / năm học trên giao diện: bản ghi mới vào cơ sở đang hoạt động đầu tiên
// và năm học đang chạy. Khi request mang cơ sở / năm học đã chọn, các route dùng giá trị đó thay thế.

export async function defaultBranchId(db: Tx | typeof prisma = prisma): Promise<string> {
  const branch = await db.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })
  if (!branch) throw createError('Chưa có cơ sở nào đang hoạt động', 409)
  return branch.id
}

export async function currentSchoolYearId(db: Tx | typeof prisma = prisma): Promise<string> {
  const year = await db.schoolYear.findFirst({ where: { status: 'CURRENT' }, select: { id: true } })
  if (!year) throw createError('Chưa có năm học đang chạy', 409)
  return year.id
}
