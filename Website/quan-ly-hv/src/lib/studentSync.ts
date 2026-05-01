import { db, C } from './firebase'

/**
 * Đồng bộ primary parent info xuống student doc (denorm) để list view
 * không phải query subcollection parents/ cho từng HV.
 */
export async function syncPrimaryParentToStudent(studentId: string): Promise<void> {
  const parentsRef = db.collection(C.STUDENTS).doc(studentId).collection('parents')
  const primarySnap = await parentsRef.where('isPrimaryContact', '==', true).limit(1).get()
  const pickedDoc = primarySnap.empty
    ? (await parentsRef.limit(1).get()).docs[0]
    : primarySnap.docs[0]

  const updates = pickedDoc
    ? {
        primaryParentName: pickedDoc.data().fullName ?? null,
        primaryParentPhone: pickedDoc.data().phone ?? null,
        primaryParentZalo: pickedDoc.data().zalo ?? null,
      }
    : { primaryParentName: null, primaryParentPhone: null, primaryParentZalo: null }

  await db.collection(C.STUDENTS).doc(studentId).update(updates)
}
