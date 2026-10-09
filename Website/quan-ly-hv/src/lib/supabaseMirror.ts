import { getSupabasePool } from './supabase'

export interface MirrorOperation {
  operationId: string
  kind: 'set' | 'update' | 'delete'
  path: string
  data?: any
  merge?: boolean
}

const TRANSFORM_KEY = '__qlhv_supabase_transform__'

export function serializeMirrorValue(value: any): any {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return { __qlhv_buffer__: value.toString('base64') }
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value?.constructor?.name?.endsWith('Transform')) {
    const name = value.constructor.name
    const kind = name === 'NumericIncrementTransform' ? 'increment'
      : name === 'ServerTimestampTransform' ? 'serverTimestamp'
      : name === 'DeleteTransform' ? 'delete'
      : name === 'ArrayUnionTransform' ? 'arrayUnion'
      : name === 'ArrayRemoveTransform' ? 'arrayRemove' : 'unsupported'
    return { [TRANSFORM_KEY]: kind, operand: serializeMirrorValue(value.operand), elements: serializeMirrorValue(value.elements) }
  }
  if (Array.isArray(value)) return value.map(serializeMirrorValue)
  if (Array.isArray(value?.segments)) return { __qlhv_field_path__: value.segments }
  if (typeof value?.path === 'string' && typeof value?.id === 'string') return { __qlhv_reference__: value.path }
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, serializeMirrorValue(child)]))
  return String(value)
}

function isObject(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function resolveValue(previous: any, incoming: any): any {
  if (isObject(incoming) && TRANSFORM_KEY in incoming) {
    switch (incoming[TRANSFORM_KEY]) {
      case 'serverTimestamp': return new Date().toISOString()
      case 'increment': return Number(previous ?? 0) + Number(incoming.operand ?? 0)
      case 'arrayUnion': {
        const result = Array.isArray(previous) ? [...previous] : []
        for (const item of incoming.elements ?? []) if (!result.some(value => JSON.stringify(value) === JSON.stringify(item))) result.push(item)
        return result
      }
      case 'arrayRemove': return (Array.isArray(previous) ? previous : []).filter(value => !(incoming.elements ?? []).some((item: any) => JSON.stringify(value) === JSON.stringify(item)))
      case 'delete': return DELETE
      default: throw new Error('Supabase mirror encountered an unsupported Firestore field transform')
    }
  }
  if (Array.isArray(incoming)) return incoming.map((item, index) => resolveValue(previous?.[index], item))
  if (isObject(incoming)) {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(incoming)) {
      const resolved = resolveValue(previous?.[key], value)
      if (resolved !== DELETE) result[key] = resolved
    }
    return result
  }
  return incoming
}

const DELETE = Symbol('delete')

function deepMerge(previous: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
  const result = { ...previous }
  for (const [key, value] of Object.entries(incoming)) {
    const resolved = resolveValue(previous[key], value)
    if (resolved === DELETE) delete result[key]
    else if (isObject(previous[key]) && isObject(resolved) && !(TRANSFORM_KEY in value)) result[key] = deepMerge(previous[key], resolved)
    else result[key] = resolved
  }
  return result
}

function fieldPath(value: any): string[] {
  if (typeof value === 'string') return value.split('.')
  if (isObject(value) && Array.isArray(value.__qlhv_field_path__)) return value.__qlhv_field_path__
  throw new Error('Supabase mirror received an unsupported Firestore update field path')
}

function setAtPath(data: Record<string, any>, path: string[], incoming: any) {
  const [head, ...tail] = path
  if (!head) throw new Error('Supabase mirror received an empty update path')
  if (tail.length === 0) {
    const resolved = resolveValue(data[head], incoming)
    if (resolved === DELETE) delete data[head]
    else data[head] = resolved
    return
  }
  const child = isObject(data[head]) ? { ...data[head] } : {}
  setAtPath(child, tail, incoming)
  data[head] = child
}

function applyUpdate(previous: Record<string, any>, args: any[]): Record<string, any> {
  const result = { ...previous }
  const first = args[0]
  if (isObject(first) && !('__qlhv_field_path__' in first)) {
    for (const [key, value] of Object.entries(first)) setAtPath(result, key.split('.'), value)
    return result
  }
  for (let i = 0; i < args.length; i += 2) setAtPath(result, fieldPath(args[i]), args[i + 1])
  return result
}

async function applyOperation(client: any, operation: MirrorOperation) {
  const alreadyApplied = await client.query('SELECT 1 FROM qlhv_migration.sync_operations WHERE operation_id = $1', [operation.operationId])
  if (alreadyApplied.rowCount) return
  const pathParts = operation.path.split('/')
  const documentId = pathParts.pop()!
  const collectionPath = pathParts.join('/')
  const existing = await client.query('SELECT data FROM qlhv_migration.documents WHERE path = $1 FOR UPDATE', [operation.path])
  const previous = existing.rows[0]?.data ?? {}

  if (operation.kind === 'delete') {
    await client.query('DELETE FROM qlhv_migration.documents WHERE path = $1', [operation.path])
  } else {
    let data: Record<string, any>
    if (operation.kind === 'set' && operation.merge !== true) data = resolveValue(previous, operation.data)
    else if (operation.kind === 'set') data = deepMerge(previous, operation.data)
    else {
      if (!existing.rowCount) throw new Error(`Supabase mirror is missing the existing document ${operation.path}`)
      data = applyUpdate(previous, operation.data)
    }
    await client.query(
      `INSERT INTO qlhv_migration.documents(path, collection_path, document_id, data)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT(path) DO UPDATE SET collection_path = EXCLUDED.collection_path,
         document_id = EXCLUDED.document_id, data = EXCLUDED.data, imported_at = now()`,
      [operation.path, collectionPath, documentId, JSON.stringify(data)],
    )
  }
  await client.query('INSERT INTO qlhv_migration.sync_operations(operation_id) VALUES ($1) ON CONFLICT DO NOTHING', [operation.operationId])
}

export async function mirrorFirestoreOperations(operations: MirrorOperation[]) {
  if (!operations.length) return
  const client = await getSupabasePool().connect()
  try {
    await client.query('BEGIN')
    await client.query(`CREATE TABLE IF NOT EXISTS qlhv_migration.sync_operations (
      operation_id text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now()
    )`)
    for (const operation of operations) await applyOperation(client, operation)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
