import { prisma, type Tx } from './db'

/**
 * Đếm lại số HV đang ACTIVE trong lớp, ghi xuống classes.activeStudentCount để list view
 * không phải đếm ghi danh cho mỗi lớp. Truyền `tx` để chạy cùng transaction với thay đổi ghi danh.
 */
export async function recountClassActiveStudents(classId: string, tx: Tx = prisma): Promise<void> {
  const count = await tx.classEnrollment.count({ where: { classId, status: 'ACTIVE' } })
  await tx.class.update({ where: { id: classId }, data: { activeStudentCount: count } })
}
