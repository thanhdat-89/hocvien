import { db, C } from './firebase'

let cachedRevision = ''
let cachedNames = new Map<string, string | null>()

/** Resolve labels by the stable class ID for operational screens. Stored snapshots stay unchanged. */
export async function currentClassNames(classIds: Iterable<string>): Promise<Map<string, string>> {
  const ids = [...new Set(classIds)].filter(id => id && id !== 'private')
  if (!ids.length) return new Map()
  // A class mutation updates this revision before responding to the user.
  // One revision read lets warm serverless instances reuse class labels safely.
  const revisionDoc = await db.collection('readViewRevisions').doc('studentsIndex').get()
  const revision = String(revisionDoc.data()?.revision || 'initial')
  if (revision !== cachedRevision) {
    cachedRevision = revision
    cachedNames = new Map()
  }
  const names = cachedNames
  const missing = ids.filter(id => !names.has(id))
  if (missing.length) {
    const docs = await Promise.all(missing.map(id => db.collection(C.CLASSES).doc(id).get()))
    for (const doc of docs) names.set(doc.id, doc.exists ? String(doc.data()?.name || '') : null)
  }
  return new Map(ids.flatMap(id => {
    const name = names.get(id)
    return name ? [[id, name] as [string, string]] : []
  }))
}

export function displayClassName<T extends { classId: string; className: string }>(row: T, names: Map<string, string>): T {
  const current = names.get(row.classId)
  return current ? { ...row, className: current } : row
}
