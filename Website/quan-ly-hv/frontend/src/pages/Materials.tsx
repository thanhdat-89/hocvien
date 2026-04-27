import React, { useEffect, useMemo, useState } from 'react'
import TopBar from '../components/TopBar'
import { useAlert, useConfirm } from '../components/ConfirmDialog'
import api from '../services/api'
import { useAuth } from '../hooks/useAuth'

interface Material {
  id: string
  title: string
  description?: string
  type: 'LINK' | 'FILE'
  url?: string
  cloudinaryPublicId?: string
  cloudinaryResourceType?: 'image' | 'raw' | 'video'
  fileName?: string
  fileSize?: number
  mimeType?: string
  audienceType: 'STUDENT' | 'CLASS'
  audienceIds: string[]
  uploaderId: string
  uploaderName: string
  createdAt: string
}

interface StudentLite { id: string; fullName: string; gradeLevel?: number | null }
interface ClassLite { id: string; name: string; gradeLevel?: number | null }

const MAX_FILE_BYTES = 25 * 1024 * 1024
const ALLOWED_MIME = [
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
]
const ACCEPT_ATTR = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg,.gif,.webp'

const fmtSize = (b?: number) => {
  if (!b) return ''
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`
  return `${(b / 1024 / 1024).toFixed(1)}MB`
}
const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export default function Materials() {
  const { user } = useAuth()
  const [materials, setMaterials] = useState<Material[]>([])
  const [students, setStudents] = useState<StudentLite[]>([])
  const [classes, setClasses] = useState<ClassLite[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'LINK' | 'FILE'>('all')
  const [filterAudience, setFilterAudience] = useState<'all' | 'STUDENT' | 'CLASS'>('all')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const alert = useAlert()
  const confirm = useConfirm()

  const load = async () => {
    setLoading(true)
    try {
      const [r1, r2, r3] = await Promise.all([
        api.get('/materials'),
        api.get('/students?page=1&limit=500'),
        api.get('/classes?page=1&limit=200'),
      ])
      setMaterials(Array.isArray(r1.data) ? r1.data : [])
      const sd: any = r2.data
      setStudents((Array.isArray(sd) ? sd : (sd?.data ?? [])).map((s: any) => ({ id: s.id, fullName: s.fullName, gradeLevel: s.gradeLevel })))
      const cd: any = r3.data
      setClasses((Array.isArray(cd) ? cd : (cd?.data ?? [])).map((c: any) => ({ id: c.id, name: c.name, gradeLevel: c.gradeLevel })))
    } catch {
      setMaterials([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const studentMap = useMemo(() => new Map(students.map(s => [s.id, s])), [students])
  const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return materials.filter(m => {
      if (filterType !== 'all' && m.type !== filterType) return false
      if (filterAudience !== 'all' && m.audienceType !== filterAudience) return false
      if (q) {
        const hay = [m.title, m.description ?? '', m.fileName ?? '', m.uploaderName].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [materials, filterType, filterAudience, search])

  const canMutate = (m: Material): boolean => {
    if (!user) return false
    if (user.role === 'ADMIN' || user.role === 'STAFF') return true
    return user.userId === m.uploaderId
  }

  const handleDelete = async (m: Material) => {
    const ok = await confirm({
      title: 'Xoá tài liệu?',
      message: `Xoá "${m.title}"? Phụ huynh sẽ không còn xem được tài liệu này.`,
      confirmLabel: 'Xoá',
      danger: true,
    })
    if (!ok) return
    try {
      await api.delete(`/materials/${m.id}`)
      setMaterials(ms => ms.filter(x => x.id !== m.id))
    } catch (err: any) {
      await alert({ title: 'Lỗi xoá', message: err?.response?.data?.message ?? 'Không xoá được.' })
    }
  }

  const handleDownload = (m: Material) => {
    if (m.url) window.open(m.url, '_blank')
  }

  const renderAudience = (m: Material) => {
    if (m.audienceType === 'STUDENT') {
      const names = m.audienceIds.map(id => studentMap.get(id)?.fullName ?? '???').filter(Boolean)
      const display = names.slice(0, 2).join(', ')
      const extra = names.length > 2 ? ` +${names.length - 2}` : ''
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium">👤 {display}{extra}</span>
    }
    const names = m.audienceIds.map(id => classMap.get(id)?.name ?? '???').filter(Boolean)
    const display = names.slice(0, 2).join(', ')
    const extra = names.length > 2 ? ` +${names.length - 2}` : ''
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium">📚 {display}{extra}</span>
  }

  return (
    <div>
      <TopBar title="Tài liệu học tập" />
      <div className="px-8 py-8 space-y-6">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Kho học liệu</span>
            <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Tài liệu học tập</h2>
          </div>
          <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true) }}>
            <span className="material-symbols-outlined">upload_file</span>
            Tải lên tài liệu
          </button>
        </div>

        <div className="bg-surface-container-low/60 rounded-2xl p-4 space-y-3">
          <div className="flex items-start gap-3 flex-wrap">
            <span className="text-[10px] font-bold text-outline uppercase tracking-wider w-20 pt-2 shrink-0">Loại</span>
            <div className="flex flex-wrap gap-2 flex-1">
              {([
                { v: 'all', label: 'Tất cả' },
                { v: 'FILE', label: 'File đính kèm' },
                { v: 'LINK', label: 'Đường dẫn' },
              ] as const).map(opt => (
                <button key={opt.v} onClick={() => setFilterType(opt.v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    filterType === opt.v
                      ? 'bg-primary text-on-primary border-primary shadow-sm'
                      : 'bg-surface text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary'
                  }`}>{opt.label}</button>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-3 flex-wrap">
            <span className="text-[10px] font-bold text-outline uppercase tracking-wider w-20 pt-2 shrink-0">Phạm vi</span>
            <div className="flex flex-wrap gap-2 flex-1">
              {([
                { v: 'all', label: 'Tất cả' },
                { v: 'STUDENT', label: 'Cá nhân học viên' },
                { v: 'CLASS', label: 'Theo lớp học' },
              ] as const).map(opt => (
                <button key={opt.v} onClick={() => setFilterAudience(opt.v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    filterAudience === opt.v
                      ? 'bg-primary text-on-primary border-primary shadow-sm'
                      : 'bg-surface text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary'
                  }`}>{opt.label}</button>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-3 flex-wrap">
            <span className="text-[10px] font-bold text-outline uppercase tracking-wider w-20 pt-2 shrink-0">Tìm</span>
            <div className="relative flex-1 max-w-sm">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-outline pointer-events-none">search</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tiêu đề, tên file..."
                className="w-full bg-surface border border-outline-variant/30 rounded-lg py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-3xl overflow-hidden shadow-sm border border-outline-variant/10">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low/50">
                  <th className="table-header w-12 text-center">STT</th>
                  <th className="table-header">Tiêu đề</th>
                  <th className="table-header">Loại</th>
                  <th className="table-header">Phạm vi</th>
                  <th className="table-header">Người upload</th>
                  <th className="table-header">Ngày</th>
                  <th className="table-header text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {loading ? (
                  <tr><td colSpan={7} className="py-16 text-center"><div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan={7} className="py-16 text-center text-outline">
                    <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">folder_open</span>
                    Chưa có tài liệu nào
                  </td></tr>
                ) : visible.map((m, i) => (
                  <tr key={m.id} className="hover:bg-surface-container-low/30 transition-colors group">
                    <td className="table-cell text-center text-sm text-outline font-medium">{i + 1}</td>
                    <td className="table-cell">
                      <p className="font-semibold text-on-surface">{m.title}</p>
                      {m.description && <p className="text-xs text-outline mt-0.5 line-clamp-1">{m.description}</p>}
                      {m.type === 'FILE' && m.fileName && (
                        <p className="text-[11px] text-outline mt-0.5 flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs">attachment</span>
                          {m.fileName} <span className="text-outline/60">· {fmtSize(m.fileSize)}</span>
                        </p>
                      )}
                    </td>
                    <td className="table-cell">
                      {m.type === 'FILE' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-bold">📎 File</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-xs font-bold">🔗 Link</span>
                      )}
                    </td>
                    <td className="table-cell">{renderAudience(m)}</td>
                    <td className="table-cell text-sm text-outline">{m.uploaderName}</td>
                    <td className="table-cell text-sm text-outline">{fmtDate(m.createdAt)}</td>
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleDownload(m)} className="p-2 text-outline hover:text-primary hover:bg-primary-container/10 rounded-lg transition-all" title="Tải về / Mở">
                          <span className="material-symbols-outlined text-[20px]">{m.type === 'FILE' ? 'download' : 'open_in_new'}</span>
                        </button>
                        {canMutate(m) && (
                          <>
                            <button onClick={() => { setEditing(m); setShowModal(true) }} className="p-2 text-outline hover:text-primary hover:bg-primary-container/10 rounded-lg transition-all" title="Sửa">
                              <span className="material-symbols-outlined text-[20px]">edit_square</span>
                            </button>
                            <button onClick={() => handleDelete(m)} className="p-2 text-outline hover:text-error hover:bg-error-container/10 rounded-lg transition-all" title="Xoá">
                              <span className="material-symbols-outlined text-[20px]">delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <MaterialModal
          editing={editing}
          students={students}
          classes={classes}
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSaved={() => { setShowModal(false); setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function MaterialModal({ editing, students, classes, onClose, onSaved }: {
  editing: Material | null
  students: StudentLite[]
  classes: ClassLite[]
  onClose: () => void
  onSaved: () => void
}) {
  const alert = useAlert()
  const [title, setTitle] = useState(editing?.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [type, setType] = useState<'LINK' | 'FILE'>(editing?.type ?? 'FILE')
  const [url, setUrl] = useState(editing?.url ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [audienceType, setAudienceType] = useState<'STUDENT' | 'CLASS'>(editing?.audienceType ?? 'CLASS')
  const [audienceIds, setAudienceIds] = useState<string[]>(editing?.audienceIds ?? [])
  const [audienceQuery, setAudienceQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)

  const audienceOptions = useMemo(() => {
    const q = audienceQuery.trim().toLowerCase()
    if (audienceType === 'STUDENT') {
      const list = students.filter(s => !q || s.fullName.toLowerCase().includes(q))
      return list.slice(0, 100).map(s => ({ id: s.id, label: s.fullName, sub: s.gradeLevel ? `Lớp ${s.gradeLevel}` : '' }))
    }
    const list = classes.filter(c => !q || c.name.toLowerCase().includes(q))
    return list.slice(0, 100).map(c => ({ id: c.id, label: c.name, sub: c.gradeLevel ? `Khối ${c.gradeLevel}` : '' }))
  }, [audienceType, audienceQuery, students, classes])

  const toggleAudience = (id: string) => {
    setAudienceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleFilePick = (f: File | null) => {
    if (!f) { setFile(null); return }
    if (f.size > MAX_FILE_BYTES) { alert({ title: 'File quá lớn', message: `Tối đa ${MAX_FILE_BYTES / 1024 / 1024}MB.` }); return }
    if (f.type && !ALLOWED_MIME.includes(f.type)) { alert({ title: 'Định dạng không hỗ trợ', message: f.type }); return }
    setFile(f)
  }

  const handleSubmit = async () => {
    if (!title.trim()) { await alert({ title: 'Thiếu tiêu đề', message: 'Vui lòng nhập tiêu đề.' }); return }
    if (audienceIds.length === 0) { await alert({ title: 'Thiếu phạm vi', message: 'Chọn ít nhất một học viên hoặc lớp.' }); return }
    if (!editing) {
      if (type === 'LINK' && !/^https?:\/\//.test(url.trim())) { await alert({ title: 'URL không hợp lệ', message: 'URL phải bắt đầu bằng http:// hoặc https://' }); return }
      if (type === 'FILE' && !file) { await alert({ title: 'Chưa chọn file', message: 'Hãy chọn file để tải lên.' }); return }
    }
    setSaving(true)
    try {
      // EDIT mode: chỉ cập nhật metadata
      if (editing) {
        await api.put(`/materials/${editing.id}`, {
          title: title.trim(),
          description: description.trim() || undefined,
          audienceType,
          audienceIds,
          ...(editing.type === 'LINK' ? { url: url.trim() } : {}),
        })
        onSaved()
        return
      }

      // CREATE mode
      if (type === 'LINK') {
        await api.post('/materials', {
          title: title.trim(),
          description: description.trim() || undefined,
          type: 'LINK',
          url: url.trim(),
          audienceType,
          audienceIds,
        })
      } else if (file) {
        // 1. Xin Cloudinary signed params từ backend
        const sign = await api.post('/materials/upload-signature', {
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
        })
        const { id, cloudName, apiKey, timestamp, signature, publicId, resourceType } = sign.data

        // 2. Upload thẳng lên Cloudinary
        const form = new FormData()
        form.append('file', file)
        form.append('api_key', apiKey)
        form.append('timestamp', String(timestamp))
        form.append('signature', signature)
        form.append('public_id', publicId)

        const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`
        const uploaded: { secure_url: string; public_id: string; bytes: number; resource_type: string } =
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)) }
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)) } catch (e) { reject(e) }
              } else {
                let msg = `Upload failed (${xhr.status})`
                try { msg = JSON.parse(xhr.responseText)?.error?.message ?? msg } catch {}
                reject(new Error(msg))
              }
            }
            xhr.onerror = () => reject(new Error('Upload network error'))
            xhr.open('POST', cloudinaryUrl)
            xhr.send(form)
          })

        // 3. Tạo material record
        await api.post('/materials', {
          id,
          title: title.trim(),
          description: description.trim() || undefined,
          type: 'FILE',
          url: uploaded.secure_url,
          cloudinaryPublicId: uploaded.public_id,
          cloudinaryResourceType: uploaded.resource_type,
          fileName: file.name,
          fileSize: uploaded.bytes ?? file.size,
          mimeType: file.type || 'application/octet-stream',
          audienceType,
          audienceIds,
        })
      }
      onSaved()
    } catch (err: any) {
      await alert({ title: 'Lỗi lưu', message: err?.response?.data?.message ?? err?.message ?? 'Không lưu được.' })
    } finally {
      setSaving(false)
      setProgress(0)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="p-6 border-b border-outline-variant/10 flex items-center justify-between">
          <h3 className="font-headline text-xl font-bold text-on-surface">{editing ? 'Sửa tài liệu' : 'Tải lên tài liệu mới'}</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-container-low text-outline hover:text-on-surface rounded-lg transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Tiêu đề *</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="VD: Đề cương ôn tập HK2" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Mô tả</label>
            <textarea className="input min-h-[60px]" value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          {!editing && (
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-2">Loại tài liệu</label>
              <div className="grid grid-cols-2 gap-2">
                {([{ v: 'FILE', icon: 'attach_file', label: 'File đính kèm', sub: 'PDF, DOCX, XLSX, PPTX, ZIP, ảnh — tối đa 25MB' },
                   { v: 'LINK', icon: 'link', label: 'Đường dẫn', sub: 'Google Drive, YouTube, blog, ...' }] as const).map(opt => (
                  <button key={opt.v} type="button" onClick={() => setType(opt.v)}
                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                      type === opt.v ? 'border-primary bg-primary/5' : 'border-outline-variant/20 hover:border-primary/40'
                    }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`material-symbols-outlined ${type === opt.v ? 'text-primary' : 'text-outline'}`}>{opt.icon}</span>
                      <span className="font-semibold text-on-surface text-sm">{opt.label}</span>
                    </div>
                    <p className="text-xs text-outline">{opt.sub}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!editing && type === 'FILE' && (
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">File *</label>
              <label className="block border-2 border-dashed border-outline-variant/30 rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all">
                <input type="file" className="hidden" accept={ACCEPT_ATTR}
                  onChange={e => handleFilePick(e.target.files?.[0] ?? null)} />
                {file ? (
                  <div>
                    <span className="material-symbols-outlined text-3xl text-primary block mb-1">description</span>
                    <p className="font-semibold text-sm text-on-surface">{file.name}</p>
                    <p className="text-xs text-outline mt-1">{fmtSize(file.size)} · Bấm để chọn lại</p>
                  </div>
                ) : (
                  <div>
                    <span className="material-symbols-outlined text-3xl text-outline block mb-1">cloud_upload</span>
                    <p className="text-sm text-on-surface">Bấm để chọn file</p>
                    <p className="text-xs text-outline mt-1">PDF, DOCX, XLSX, PPTX, ZIP, ảnh — tối đa 25MB</p>
                  </div>
                )}
              </label>
              {progress > 0 && progress < 100 && (
                <div className="mt-2 h-1.5 bg-outline-variant/20 rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          )}

          {(!editing && type === 'LINK') || (editing && editing.type === 'LINK') ? (
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">URL *</label>
              <input className="input" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
            </div>
          ) : null}

          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-2">Phạm vi chia sẻ *</label>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {([{ v: 'CLASS', icon: 'school', label: 'Theo lớp học' },
                 { v: 'STUDENT', icon: 'person', label: 'Cá nhân học viên' }] as const).map(opt => (
                <button key={opt.v} type="button"
                  onClick={() => { setAudienceType(opt.v); setAudienceIds([]) }}
                  className={`p-3 rounded-xl border-2 transition-all flex items-center gap-2 ${
                    audienceType === opt.v ? 'border-primary bg-primary/5' : 'border-outline-variant/20 hover:border-primary/40'
                  }`}>
                  <span className={`material-symbols-outlined ${audienceType === opt.v ? 'text-primary' : 'text-outline'}`}>{opt.icon}</span>
                  <span className="font-semibold text-on-surface text-sm">{opt.label}</span>
                </button>
              ))}
            </div>

            <input className="input mb-2" value={audienceQuery} onChange={e => setAudienceQuery(e.target.value)}
              placeholder={audienceType === 'STUDENT' ? 'Tìm học viên...' : 'Tìm lớp...'} />

            {audienceIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2 p-2 bg-primary/5 rounded-lg">
                {audienceIds.map(id => {
                  const label = audienceType === 'STUDENT'
                    ? students.find(s => s.id === id)?.fullName ?? id
                    : classes.find(c => c.id === id)?.name ?? id
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary text-on-primary rounded-md text-xs font-medium">
                      {label}
                      <button onClick={() => toggleAudience(id)} className="hover:bg-white/20 rounded">
                        <span className="material-symbols-outlined text-xs">close</span>
                      </button>
                    </span>
                  )
                })}
              </div>
            )}

            <div className="max-h-60 overflow-y-auto bg-surface-container-low rounded-xl border border-outline-variant/20 divide-y divide-outline-variant/10">
              {audienceOptions.length === 0 ? (
                <p className="p-4 text-sm text-outline text-center">Không có kết quả</p>
              ) : audienceOptions.map(opt => {
                const selected = audienceIds.includes(opt.id)
                return (
                  <button key={opt.id} type="button" onClick={() => toggleAudience(opt.id)}
                    className={`w-full p-3 text-left hover:bg-surface-container transition-colors flex items-center gap-3 ${selected ? 'bg-primary/5' : ''}`}>
                    <span className={`material-symbols-outlined text-base ${selected ? 'text-primary' : 'text-outline'}`}>{selected ? 'check_box' : 'check_box_outline_blank'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface">{opt.label}</p>
                      {opt.sub && <p className="text-xs text-outline">{opt.sub}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-outline-variant/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors">Huỷ</button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? (progress > 0 && progress < 100 ? `Đang upload ${progress}%` : 'Đang lưu...') : (editing ? 'Cập nhật' : 'Tải lên')}
          </button>
        </div>
      </div>
    </div>
  )
}
