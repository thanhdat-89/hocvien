import { randomUUID } from 'crypto'
import type { Firestore } from 'firebase-admin/firestore'
import { mirrorFirestoreOperations, MirrorOperation, serializeMirrorValue } from './supabaseMirror'

const QUEUE = '__supabaseSyncQueue'
const proxyTargets = new WeakMap<object, any>()

function unwrap<T>(value: T): T {
  return value && typeof value === 'object' ? (proxyTargets.get(value as object) ?? value) : value
}

async function mirrorOrQueue(db: Firestore, operations: MirrorOperation[]) {
  if (process.env.SUPABASE_DUAL_WRITE !== 'true' || operations.length === 0) return
  try {
    await mirrorFirestoreOperations(operations)
  } catch (error: any) {
    // Firebase remains canonical. Keep failed mirror operations in Firestore for replay.
    await Promise.all(operations.map(op => db.collection(QUEUE).doc(op.operationId).set({
      ...op,
      createdAt: new Date().toISOString(),
    })))
    console.error('[Supabase mirror] queued failed operation(s)', error?.code ?? error?.name ?? 'unknown')
  }
}

function makeOperation(kind: MirrorOperation['kind'], ref: FirebaseFirestore.DocumentReference, data?: unknown, merge?: boolean): MirrorOperation {
  return {
    operationId: randomUUID(),
    kind,
    path: ref.path,
    data: data === undefined ? undefined : serializeMirrorValue(data),
    merge,
  }
}

function wrapSnapshot(snapshot: any, db: Firestore): any {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  return new Proxy(snapshot, {
    get(target, prop) {
      if (prop === 'ref' && target.ref) return wrapDocument(target.ref, db)
      if (prop === 'docs' && Array.isArray(target.docs)) return target.docs.map((doc: any) => wrapSnapshot(doc, db))
      if (prop === 'docChanges') return (...args: any[]) => target.docChanges(...args).map((change: any) => ({ ...change, doc: wrapSnapshot(change.doc, db) }))
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function wrapDocument(ref: FirebaseFirestore.DocumentReference, db: Firestore): any {
  if (!ref || typeof ref !== 'object') return ref
  const proxy = new Proxy(ref, {
    get(target, prop) {
      if (prop === 'collection') return (name: string) => wrapCollection(target.collection(name), db)
      if (prop === 'get') return async (...args: any[]) => wrapSnapshot(await (target.get as any)(...args), db)
      if (prop === 'set') return async (data: any, options?: any) => {
        const result = await target.set(data, options)
        await mirrorOrQueue(db, [makeOperation('set', target, data, options?.merge === true)])
        return result
      }
      if (prop === 'update') return async (...args: any[]) => {
        const result = await (target.update as any)(...args)
        await mirrorOrQueue(db, [makeOperation('update', target, args)])
        return result
      }
      if (prop === 'delete') return async (...args: any[]) => {
        const result = await target.delete(...args)
        await mirrorOrQueue(db, [makeOperation('delete', target)])
        return result
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  proxyTargets.set(proxy, ref)
  return proxy
}

function wrapSnapshotQuery(query: any, db: Firestore): any {
  if (!query || typeof query !== 'object') return query
  const proxy = new Proxy(query, {
    get(target, prop) {
      if (prop === 'get') return async (...args: any[]) => wrapSnapshot(await target.get(...args), db)
      if (prop === 'doc') return (id?: string) => wrapDocument(target.doc(id), db)
      if (prop === 'add') return async (data: any) => {
        const ref = await target.add(data)
        await mirrorOrQueue(db, [makeOperation('set', ref, data, false)])
        return wrapDocument(ref, db)
      }
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      return (...args: any[]) => {
        const result = value.apply(target, args.map(unwrap))
        return wrapSnapshotQuery(result, db)
      }
    },
  })
  proxyTargets.set(proxy, query)
  return proxy
}

function wrapCollection(collection: FirebaseFirestore.CollectionReference, db: Firestore): any {
  return wrapSnapshotQuery(collection, db)
}

function wrapBatch(batch: FirebaseFirestore.WriteBatch, db: Firestore): any {
  const operations: MirrorOperation[] = []
  const proxy = new Proxy(batch, {
    get(target, prop) {
      if (prop === 'set') return (ref: any, data: any, options?: any) => {
        const rawRef = unwrap(ref)
        operations.push(makeOperation('set', rawRef, data, options?.merge === true))
        target.set(rawRef, data, options)
        return proxy
      }
      if (prop === 'update') return (ref: any, ...args: any[]) => {
        const rawRef = unwrap(ref)
        operations.push(makeOperation('update', rawRef, args))
        ;(target.update as any)(rawRef, ...args)
        return proxy
      }
      if (prop === 'delete') return (ref: any, ...args: any[]) => {
        const rawRef = unwrap(ref)
        operations.push(makeOperation('delete', rawRef))
        target.delete(rawRef, ...args)
        return proxy
      }
      if (prop === 'commit') return async () => {
        const result = await target.commit()
        await mirrorOrQueue(db, operations)
        return result
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  proxyTargets.set(proxy, batch)
  return proxy
}

function wrapTransaction(transaction: FirebaseFirestore.Transaction, db: Firestore, operations: MirrorOperation[]): any {
  return new Proxy(transaction, {
    get(target, prop) {
      if (prop === 'get') return async (ref: any) => wrapSnapshot(await target.get(unwrap(ref)), db)
      if (prop === 'set') return (ref: any, data: any, options?: any) => {
        const rawRef = unwrap(ref)
        operations.push(makeOperation('set', rawRef, data, options?.merge === true))
        target.set(rawRef, data, options)
        return transaction
      }
      if (prop === 'update') return (ref: any, ...args: any[]) => {
        const rawRef = unwrap(ref)
        operations.push(makeOperation('update', rawRef, args))
        ;(target.update as any)(rawRef, ...args)
        return transaction
      }
      if (prop === 'delete') return (ref: any, ...args: any[]) => {
        const rawRef = unwrap(ref)
        operations.push(makeOperation('delete', rawRef))
        target.delete(rawRef, ...args)
        return transaction
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function createMirroredFirestore(rawDb: Firestore): Firestore {
  return new Proxy(rawDb, {
    get(target, prop) {
      if (prop === 'collection') return (name: string) => wrapCollection(target.collection(name), rawDb)
      if (prop === 'collectionGroup') return (name: string) => wrapSnapshotQuery(target.collectionGroup(name), rawDb)
      if (prop === 'batch') return () => wrapBatch(target.batch(), rawDb)
      if (prop === 'runTransaction') return async (callback: (transaction: any) => any, options?: any) => {
        const operations: MirrorOperation[] = []
        const result = await target.runTransaction(tx => {
          // Firestore may invoke the transaction callback again after a conflict.
          operations.length = 0
          return callback(wrapTransaction(tx, rawDb, operations))
        }, options)
        await mirrorOrQueue(rawDb, operations)
        return result
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Firestore
}

export async function flushSupabaseSyncQueue(rawDb: Firestore) {
  if (process.env.SUPABASE_DUAL_WRITE !== 'true') return
  const snapshot = await rawDb.collection(QUEUE).orderBy('createdAt').limit(100).get()
  if (snapshot.empty) return
  const operations = snapshot.docs.map(doc => {
    const { createdAt: _createdAt, ...op } = doc.data()
    return op as MirrorOperation
  })
  await mirrorFirestoreOperations(operations)
  const batch = rawDb.batch()
  snapshot.docs.forEach(doc => batch.delete(doc.ref))
  await batch.commit()
}
