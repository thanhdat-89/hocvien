import { db, C } from '../lib/firebase'
import { readView } from './readViews'

type StudentIndexEntry = { id: string; fullName: string; status?: string; gradeLevel?: number }
type Options = { page: number; limit: number; search?: string; status?: string; gradeLevel?: string; classId?: string; cursor?: string }

/** A shared compact index preserves contains-search and numbered page jumps without billed offsets. */
export function getStudentIndex() {
  return readView('studentsIndex', 'all', async () => {
    const snap = await db.collection(C.STUDENTS).select('fullName', 'status', 'gradeLevel').get()
    return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }) as StudentIndexEntry)
      .sort((a, b) => Buffer.compare(Buffer.from(a.fullName || ''), Buffer.from(b.fullName || '')) || a.id.localeCompare(b.id))
  })
}

export async function getStudentPage(options: Options) {
  const view = await getStudentIndex()
  const all = view.data!
  let classIds: Set<string> | undefined
  if (options.classId) {
    const snap = await db.collection(C.ENROLLMENTS).where('classId', '==', options.classId).where('status', '==', 'ACTIVE').select('studentId').get()
    classIds = new Set(snap.docs.map(doc => doc.data().studentId))
  }
  const search = options.search?.trim().toLowerCase() || ''
  const filters = JSON.stringify([search, options.status || '', options.gradeLevel || '', options.classId || '', options.limit])
  const matched = all.filter(student => (!search || student.fullName.toLowerCase().includes(search))
    && (!options.status || student.status === options.status)
    && (!options.gradeLevel || student.gradeLevel === Number(options.gradeLevel))
    && (!classIds || classIds.has(student.id)))
  if (classIds) matched.sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi') || a.id.localeCompare(b.id))
  let start = (options.page - 1) * options.limit
  if (options.cursor) {
    let cursor: any
    try { cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString()) }
    catch { throw Object.assign(new Error('Cursor không hợp lệ'), { status: 400 }) }
    if (!cursor || typeof cursor.id !== 'string' || typeof cursor.version !== 'string' || typeof cursor.filters !== 'string') {
      throw Object.assign(new Error('Cursor không hợp lệ'), { status: 400 })
    }
    if (cursor.version !== view.version || cursor.filters !== filters) {
      throw Object.assign(new Error('Danh sách đã thay đổi, vui lòng tải lại'), { status: 409 })
    }
    const position = matched.findIndex(student => student.id === cursor.id)
    if (position < 0) throw Object.assign(new Error('Danh sách đã thay đổi, vui lòng tải lại'), { status: 409 })
    start = position + 1
  }
  const selected = matched.slice(start, start + options.limit)
  const last = selected[selected.length - 1]
  return {
    ids: selected.map(student => student.id), total: matched.length,
    totalAll: all.length, totalActive: all.filter(student => student.status === 'ACTIVE').length,
    page: Math.floor(start / options.limit) + 1, limit: options.limit, totalPages: Math.ceil(matched.length / options.limit),
    nextCursor: last && start + selected.length < matched.length
      ? Buffer.from(JSON.stringify({ id: last.id, version: view.version, filters })).toString('base64url') : null,
  }
}
