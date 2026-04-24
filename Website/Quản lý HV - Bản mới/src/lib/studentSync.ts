import { db, C } from './firebase'

/**
 * Đồng bộ primary parent info xuống student doc (denorm) để list view
 * không phải query subcollection parents/ cho từng HV.
 */
export async function syncPrimaryParentToStudent(studentId: string): Promise<void> {
  const snap = await db.collection(C.STUDENTS).doc(studentId).collection('parents')
    .where('isPrimaryContact', '==', true)
    .limit(1)
    .get()

  const updates = snap.empty
    ? { primaryParentName: null, primaryParentPhone: null, primaryParentZalo: null }
    : {
        primaryParentName: snap.docs[0].data().fullName ?? null,
        primaryParentPhone: snap.docs[0].data().phone ?? null,
        primaryParentZalo: snap.docs[0].data().zalo ?? null,
      }

  await db.collection(C.STUDENTS).doc(studentId).update(updates)
}
