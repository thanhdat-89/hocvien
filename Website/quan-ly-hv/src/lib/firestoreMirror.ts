import type { Firestore } from 'firebase-admin/firestore'

/** Legacy entry point; all operations now use native Firestore directly. */
export function createMirroredFirestore(rawDb: Firestore): Firestore {
  return rawDb
}
