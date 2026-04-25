import { db, C } from './firebase'

/**
 * Đếm lại số HV đang ACTIVE trong lớp, ghi xuống class doc để list view
 * không phải query ENROLLMENTS cho mỗi lớp.
 */
export async function recountClassActiveStudents(classId: string): Promise<void> {
  const snap = await db.collection(C.ENROLLMENTS)
    .where('classId', '==', classId)
    .where('status', '==', 'ACTIVE')
    .get()
  await db.collection(C.CLASSES).doc(classId).update({
    activeStudentCount: snap.size,
  })
}
