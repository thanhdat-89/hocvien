/** Read-only Firestore-shaped store backed by mirrored Supabase document snapshots. */
export function firestoreSnapshotStore(documents: { collection_path: string; document_id: string; data: Record<string, any> }[]) {
  const collections = new Map<string, typeof documents>()
  for (const row of documents) {
    const group = collections.get(row.collection_path) ?? []
    group.push(row)
    collections.set(row.collection_path, group)
  }
  const snapshot = (row?: typeof documents[number]) => ({ id: row?.document_id, exists: !!row, data: () => row?.data })
  function query(path: string, filters: ((data: Record<string, any>) => boolean)[] = []) {
    return {
      where(field: string, operator: string, value: any) {
        return query(path, [...filters, data => {
          if (operator === '==') return data[field] === value
          if (operator === '>=') return data[field] >= value
          if (operator === '<=') return data[field] <= value
          if (operator === 'in') return value.includes(data[field])
          throw new Error('Unsupported snapshot query operator')
        }])
      },
      doc(id: string) { return { get: async () => snapshot((collections.get(path) ?? []).find(row => row.document_id === id)) } },
      async get() {
        const docs = (collections.get(path) ?? []).filter(row => filters.every(filter => filter(row.data))).map(snapshot)
        return { docs, size: docs.length, empty: docs.length === 0, forEach: (callback: (doc: any) => void) => docs.forEach(callback) }
      },
    }
  }
  return { collection: query } as unknown as Pick<FirebaseFirestore.Firestore, 'collection'>
}
