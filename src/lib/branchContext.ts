import { prisma, Tx } from './db'
import { createError } from '../middleware/errorHandler'
import { currentScope } from './scope'

// ─── Cơ sở & năm học mặc định ─────────────────────────────────
// Bản ghi mới vào cơ sở đang chọn và năm học đang xem (mặc định năm học đang chạy). Đang xem nhiều cơ sở
// thì chỉ tự chọn khi trong phạm vi có đúng một cơ sở hoạt động, tránh ghi nhầm cơ sở.

export async function defaultBranchId(db: Tx | typeof prisma = prisma): Promise<string> {
  const ids = currentScope()?.branchIds
  const branches = await db.branch.findMany({ where: { isActive: true, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true }, take: 2 })
  if (!branches.length) throw createError('Chưa có cơ sở nào đang hoạt động', 409)
  if (branches.length > 1) throw createError('Chọn một cơ sở ở thanh trên cùng trước khi thêm', 400)
  return branches[0].id
}

export async function currentSchoolYearId(db: Tx | typeof prisma = prisma): Promise<string> {
  const year = await db.schoolYear.findFirst({ where: { status: 'CURRENT' }, select: { id: true } })
  if (!year) throw createError('Chưa có năm học đang chạy', 409)
  return year.id
}

/**
 * Danh sách cơ sở phân công gửi lên (Cài đặt → Người dùng / Giáo viên): undefined = không đổi,
 * mảng mã cơ sở có thật = thay toàn bộ; sai định dạng hoặc mã không tồn tại → lỗi 400.
 */
export async function parseBranchIds(input: unknown, db: Tx | typeof prisma = prisma): Promise<string[] | undefined> {
  if (input === undefined) return undefined
  if (!Array.isArray(input) || input.some(id => typeof id !== 'string')) throw createError('Danh sách cơ sở không hợp lệ', 400)
  const ids = [...new Set(input as string[])]
  if ((await db.branch.count({ where: { id: { in: ids } } })) !== ids.length) throw createError('Không tìm thấy cơ sở', 400)
  return ids
}

/** Năm học để tạo lớp: năm đang xem, trừ năm đã đóng (chỉ xem) */
export async function openSchoolYearId(db: Tx | typeof prisma = prisma): Promise<string> {
  const id = await viewedSchoolYearId(db)
  const year = await db.schoolYear.findUniqueOrThrow({ where: { id }, select: { status: true } })
  if (year.status === 'CLOSED') throw createError('Năm học đã đóng, chỉ xem được', 409)
  return id
}

/** Năm học đang xem: X-School-Year-Id của request, mặc định năm học đang chạy */
export async function viewedSchoolYearId(db: Tx | typeof prisma = prisma): Promise<string> {
  const chosen = currentScope()?.schoolYearId
  if (chosen) {
    if (!(await db.schoolYear.findUnique({ where: { id: chosen }, select: { id: true } }))) throw createError('Không tìm thấy năm học', 404)
    return chosen
  }
  return currentSchoolYearId(db)
}
