import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj } from '../lib/firebase'
import { cloudinary } from '../lib/cloudinary'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Material } from '../types/models'

const router = Router()
router.use(authenticate)

const now = () => new Date().toISOString()

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

function canMutate(material: Material, user: AuthRequest['user']): boolean {
  if (!user) return false
  if (user.role === 'ADMIN' || user.role === 'STAFF') return true
  return user.userId === material.uploaderId
}

// POST /api/materials/upload-signature
// Trả về Cloudinary signed params để client upload thẳng (multipart) lên api.cloudinary.com
router.post('/upload-signature', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { mimeType, fileSize } = req.body as { mimeType?: string; fileSize?: number }
    if (!mimeType || !ALLOWED_MIME.has(mimeType)) { res.status(400).json({ message: 'Định dạng không được hỗ trợ' }); return }
    if (typeof fileSize === 'number' && fileSize > MAX_FILE_BYTES) {
      res.status(400).json({ message: `File quá ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB` }); return
    }

    const id = db.collection(C.MATERIALS).doc().id
    const folder = 'materials'
    const publicId = `${folder}/${id}`
    const timestamp = Math.floor(Date.now() / 1000)

    // Cloudinary đòi sign tất cả tham số ngoài file/api_key/cloud_name/resource_type
    const paramsToSign: Record<string, string | number> = {
      public_id: publicId,
      timestamp,
    }
    const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET!)

    res.json({
      id,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      signature,
      publicId,
      // mimeType=image/* → image, mọi thứ khác → raw
      resourceType: mimeType.startsWith('image/') ? 'image' : 'raw',
    })
  } catch (err) { next(err) }
})

// GET /api/materials
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

// POST /api/materials
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
      if (!b.url || !b.cloudinaryPublicId || !b.fileName) {
        res.status(400).json({ message: 'Thiếu thông tin file (url / publicId / fileName)' }); return
      }
    }

    const userDoc = await db.collection(C.USERS).doc(req.user!.userId).get()
    const uploaderName = userDoc.exists ? ((userDoc.data() as any).fullName ?? 'Giáo viên') : 'Giáo viên'

    const id = (b.id && typeof b.id === 'string') ? b.id : db.collection(C.MATERIALS).doc().id
    const data: Omit<Material, 'id'> = {
      title,
      description: b.description ? String(b.description).trim() : undefined,
      type: b.type,
      url: b.url,
      ...(b.type === 'FILE' ? {
        cloudinaryPublicId: b.cloudinaryPublicId,
        cloudinaryResourceType: b.cloudinaryResourceType,
        fileName: b.fileName,
        fileSize: typeof b.fileSize === 'number' ? b.fileSize : undefined,
        mimeType: b.mimeType,
      } : {}),
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

// PUT /api/materials/:id
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

// DELETE /api/materials/:id
router.delete('/:id', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ref = db.collection(C.MATERIALS).doc(s(req.params.id))
    const doc = await ref.get()
    if (!doc.exists) { res.status(404).json({ message: 'Không tìm thấy tài liệu' }); return }
    const existing = toObj<Material>(doc)
    if (!canMutate(existing, req.user)) { res.status(403).json({ message: 'Không có quyền xoá tài liệu này' }); return }

    if (existing.type === 'FILE' && existing.cloudinaryPublicId) {
      try {
        await cloudinary.uploader.destroy(existing.cloudinaryPublicId, {
          resource_type: existing.cloudinaryResourceType ?? 'raw',
          invalidate: true,
        })
      } catch (e) {
        console.warn('[materials] không xoá được file Cloudinary', existing.cloudinaryPublicId, e)
      }
    }
    await ref.delete()
    res.json({ message: 'Đã xoá tài liệu' })
  } catch (err) { next(err) }
})

export default router

// ─── Helper: lấy danh sách material hiển thị cho 1 học viên ──────────────
export async function listMaterialsForStudent(studentId: string): Promise<Material[]> {
  const enrollSnap = await db.collection(C.ENROLLMENTS)
    .where('studentId', '==', studentId)
    .where('status', '==', 'ACTIVE')
    .get()
  const classIds = [...new Set(enrollSnap.docs.map(d => (d.data() as any).classId).filter((x): x is string => !!x))]

  const personalSnap = await db.collection(C.MATERIALS)
    .where('audienceType', '==', 'STUDENT')
    .where('audienceIds', 'array-contains', studentId)
    .get()

  const classSnaps = await Promise.all(classIds.map(cid =>
    db.collection(C.MATERIALS)
      .where('audienceType', '==', 'CLASS')
      .where('audienceIds', 'array-contains', cid)
      .get()
  ))

  const map = new Map<string, Material>()
  toDocs<Material>(personalSnap).forEach(m => map.set(m.id, m))
  classSnaps.forEach(s => toDocs<Material>(s).forEach(m => { if (!map.has(m.id)) map.set(m.id, m) }))

  return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
