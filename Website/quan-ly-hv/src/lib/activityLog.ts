import { db, C } from './firebase'

export type ActivityAction = 'CREATE' | 'UPDATE' | 'DELETE'

export interface ActivityLogInput {
  userId: string
  userRole: string
  action: ActivityAction
  resourceType: string
  resourceId?: string
  description: string
  method: string
  path: string
  statusCode: number
  ip?: string
  before?: unknown
  after?: unknown
}

const SENSITIVE_KEYS = new Set([
  'password', 'passwordHash', 'hash', 'token', 'accessToken', 'refreshToken',
  'apiKey', 'api_key', 'apiSecret', 'api_secret', 'secret', 'signature',
])

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 4) return '[deep]'
  if (Array.isArray(value)) return value.slice(0, 50).map(v => sanitize(v, depth + 1))
  if (typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) continue
    result[k] = sanitize(v, depth + 1)
  }
  return result
}

const userNameCache = new Map<string, { name: string; until: number }>()
const NAME_TTL = 5 * 60 * 1000

async function getUserName(userId: string): Promise<string> {
  const now = Date.now()
  const cached = userNameCache.get(userId)
  if (cached && cached.until > now) return cached.name
  try {
    const doc = await db.collection(C.USERS).doc(userId).get()
    const name = doc.exists ? ((doc.data() as { fullName?: string }).fullName ?? 'N/A') : 'Đã xoá'
    userNameCache.set(userId, { name, until: now + NAME_TTL })
    return name
  } catch {
    return 'N/A'
  }
}

export async function logActivity(input: ActivityLogInput): Promise<void> {
  const userName = await getUserName(input.userId)
  await db.collection(C.ACTIVITY_LOGS).add({
    createdAt: new Date().toISOString(),
    userId: input.userId,
    userName,
    userRole: input.userRole,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    description: input.description,
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    ip: input.ip,
    before: sanitize(input.before),
    after: sanitize(input.after),
  })
}
