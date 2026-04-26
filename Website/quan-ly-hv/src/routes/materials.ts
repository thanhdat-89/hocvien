import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj, storageBucket } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Material } from '../types/models'

const router = Router()
router.use(authenticate)

const now = () => new Date().toISOString()

// Tài liệu cho phép — đồng bộ với UI accept attribute
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])
const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25MB

const sanitize = (name: string) => name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file'

function canMutate(material: Material, user: AuthRequest['user']): boolean {
  if (!user) return false
  if (user.role === 'ADMIN' || user.role === 'STAFF') return true
  // TEACHER: chỉ tài liệu của chính mình
  return user.userId === material.uploaderId
}

// POST /api/materials/upload-url — Lấy signed URL để client PUT file thẳng lên Storage
router.post('/upload-url', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fileName, mimeType, fileSize } = req.body as { fileName?: string; mimeType?: string; fileSize?: number }
    if (!fileName || !mimeType) { res.status(400).json({ message: 'Thiếu fileName / mimeType' }); return }
    if (!ALLOWED_MIME.has(mimeType)) { res.status(400).json({ message: 'Định dạng không được hỗ trợ' }); return }
    if (typeof fileSize === 'number' && fileSize > MAX_FILE_BYTES) {
      res.status(400).json({ message: `File quá ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB` }); return
    }
    const id = db.collection(C.MATERIALS).doc().id
    const storagePath = `materials/${id}/${sanitize(fileName)}`
    const file = storageBucket.file(storagePath)
    const [uploadUrl] = await file.getSignedUrl({
      action: 'write',
      version: 'v4',
      expires: Date.now() + 10 * 60 * 1000, // 10 phút để client upload xong
      contentType: mimeType,
    })
    res.json({ id, storagePath, uploadUrl })
  } catch (err) { next(err) }
})

// GET /api/materials — admin/teacher xem danh sách (filter studentId, classId, audienceType)
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, classId, audienceType } = req.query as Record<string, string>
    let q: FirebaseFirestore.Query = db.collection(C.MATERIALS)
    if (audienceType) q = q.where('audienceType', '==', audienceType)
    if (studentId) q = q.where('audienceType', '==', 'STUDENT').where('audienceIds', 'array-contains', studentId)
    else if (classId) q = q.where('audienceType', '==', 'CLASS').where('audienceIds', 'array-contains', classId)
    const snap = await q.get()
    const materials = toDocs<Material>(snap).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    res.json(materials)
  } catch (err) { next(err) }
})

// POST /api/materials — tạo material (sau khi đã upload file thành công, hoặc với link)
router.post('/', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = req.body as Partial<Material> & { id?: string }
    const title = (b.title ?? '').toString().trim()
    if (!title) { res.status(400).json({ message: 'Thiếu tiêu đề' }); return }
    if (b.type !== 'LINK' && b.type !== 'FILE') { res.status(400).json({ message: 'type không hợp lệ' }); return }
    if (b.audienceType !== 'STUDENT' && b.audienceType !== 'CLASS') { res.status(400).json({ message: 'audienceType không hợp lệ' }); return }
    const audienceIds = Array.isArray(b.audienceIds) ? b.audienceIds.filter((x): x is string => typeof x === 'string' && !!x) : []
    if (audienceIds.length === 0) { res.status(400).json({ message: 'Chọn ít nhất một học viên hoặc lớp học' }); return }

    if (b.type === 'LINK') {
      if (!b.url || !/^https?:\/\//.test(b.url)) { res.status(400).json({ message: 'URL không hợp lệ' }); return }
    } else {
      if (!b.storagePath || !b.fileName) { res.status(400).json({ message: 'Thiếu storagePath / fileName' }); return }
    }

    // Lookup uploaderName từ user
    const userDoc = await db.collection(C.USERS).doc(req.user!.userId).get()
    const uploaderName = userDoc.exists ? ((userDoc.data() as any).fullName ?? 'Giáo viên') : 'Giáo viên'

    const id = (b.id && typeof b.id === 'string') ? b.id : db.collection(C.MATERIALS).doc().id
    const data: Omit<Material, 'id'> = {
      title,
      description: b.description ? String(b.description).trim() : undefined,
      type: b.type,
      ...(b.type === 'LINK' ? { url: b.url } : {
        storagePath: b.storagePath,
        fileName: b.fileName,
        fileSize: typeof b.fileSize === 'number' ? b.fileSize : undefined,
        mimeType: b.mimeType,
      }),
      audienceType: b.audienceType,
      audienceIds,
      uploaderId: req.user!.userId,
      uploaderName,
      createdAt: now(),
      updatedAt: now(),
    }
    await db.collection(C.MATERIALS).doc(id).set(data)
    res.status(201).json({ id, ...data })
  } catch (err) { next(err) }
})

// PUT /api/materials/:id — chỉ cập nhật metadata (title, description, audience). Đổi file phải tạo mới.
router.put('/:id', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ref = db.collection(C.MATERIALS).doc(s(req.params.id))
    const doc = await ref.get()
    if (!doc.exists) { res.status(404).json({ message: 'Không tìm thấy tài liệu' }); return }
    const existing = toObj<Material>(doc)
    if (!canMutate(existing, req.user)) { res.status(403).json({ message: 'Không có quyền sửa tài liệu này' }); return }

    const b = req.body as Partial<Material>
    const updates: Record<string, unknown> = { updatedAt: now() }
    if (typeof b.title === 'string') updates.title = b.title.trim()
    if (typeof b.description === 'string') updates.description = b.description.trim()
    if (b.audienceType === 'STUDENT' || b.audienceType === 'CLASS') updates.audienceType = b.audienceType
    if (Array.isArray(b.audienceIds)) updates.audienceIds = b.audienceIds.filter(x => typeof x === 'string')
    if (typeof b.url === 'string' && existing.type === 'LINK') {
      if (!/^https?:\/\//.test(b.url)) { res.status(400).json({ message: 'URL không hợp lệ' }); return }
      updates.url = b.url
    }

    await ref.update(updates)
    res.json({ ...existing, ...updates, id: ref.id })
  } catch (err) { next(err) }
})

// DELETE /api/materials/:id — xoá doc + file trên Storage (nếu có)
router.delete('/:id', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ref = db.collection(C.MATERIALS).doc(s(req.params.id))
    const doc = await ref.get()
    if (!doc.exists) { res.status(404).json({ message: 'Không tìm thấy tài liệu' }); return }
    const existing = toObj<Material>(doc)
    if (!canMutate(existing, req.user)) { res.status(403).json({ message: 'Không có quyền xoá tài liệu này' }); return }

    if (existing.type === 'FILE' && existing.storagePath) {
      try { await storageBucket.file(existing.storagePath).delete() }
      catch (e) { console.warn('[materials] không xoá được file Storage', existing.storagePath, e) }
    }
    await ref.delete()
    res.json({ message: 'Đã xoá tài liệu' })
  } catch (err) { next(err) }
})

// GET /api/materials/:id/download-url — trả về signed URL 1h để tải file
router.get('/:id/download-url', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await db.collection(C.MATERIALS).doc(s(req.params.id)).get()
    if (!doc.exists) { res.status(404).json({ message: 'Không tìm thấy tài liệu' }); return }
    const material = toObj<Material>(doc)
    if (material.type !== 'FILE' || !material.storagePath) {
      res.status(400).json({ message: 'Tài liệu không phải file' }); return
    }
    const [downloadUrl] = await storageBucket.file(material.storagePath).getSignedUrl({
      action: 'read',
      version: 'v4',
      expires: Date.now() + 60 * 60 * 1000, // 1h
    })
    res.json({ downloadUrl })
  } catch (err) { next(err) }
})

export default router

// ─── Helper: lấy danh sách material hiển thị cho 1 học viên ──────────────
// Dùng bởi public endpoint. Không gắn auth.
export async function listMaterialsForStudent(studentId: string): Promise<Array<Material & { downloadUrl?: string }>> {
  // Lấy classId của ACTIVE enrollments
  const enrollSnap = await db.collection(C.ENROLLMENTS)
    .where('studentId', '==', studentId)
    .where('status', '==', 'ACTIVE')
    .get()
  const classIds = [...new Set(enrollSnap.docs.map(d => (d.data() as any).classId).filter((x): x is string => !!x))]

  // Material gửi cho cá nhân HV này
  const personalSnap = await db.collection(C.MATERIALS)
    .where('audienceType', '==', 'STUDENT')
    .where('audienceIds', 'array-contains', studentId)
    .get()

  // Material gửi cho các lớp HV đang theo (mỗi classId tối đa 1 query song song)
  const classSnaps = await Promise.all(classIds.map(cid =>
    db.collection(C.MATERIALS)
      .where('audienceType', '==', 'CLASS')
      .where('audienceIds', 'array-contains', cid)
      .get()
  ))

  const all = [
    ...toDocs<Material>(personalSnap),
    ...classSnaps.flatMap(s => toDocs<Material>(s)),
  ]
  // Khử trùng theo id
  const map = new Map<string, Material>()
  all.forEach(m => { if (!map.has(m.id)) map.set(m.id, m) })

  // Tạo signed URL cho file
  const out: Array<Material & { downloadUrl?: string }> = []
  for (const m of map.values()) {
    if (m.type === 'FILE' && m.storagePath) {
      try {
        const [url] = await storageBucket.file(m.storagePath).getSignedUrl({
          action: 'read', version: 'v4', expires: Date.now() + 60 * 60 * 1000,
        })
        out.push({ ...m, downloadUrl: url })
      } catch {
        out.push(m)
      }
    } else {
      out.push(m)
    }
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return out
}
