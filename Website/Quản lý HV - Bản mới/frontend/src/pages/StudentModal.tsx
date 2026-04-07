import React, { useState, useEffect } from 'react'
import api from '../services/api'
import { Student, Class } from '../types'

interface Props {
  student: Student | null
  onClose: () => void
  onSaved: () => void
}

export default function StudentModal({ student, onClose, onSaved }: Props) {
  const isEdit = !!student
  const [form, setForm] = useState({
    fullName: student?.fullName ?? '',
    gradeLevel: student?.gradeLevel?.toString() ?? '',
    parentName: student?.primaryParent?.fullName ?? '',
    phone: student?.primaryParent?.phone ?? '',
    enrollmentDate: new Date().toISOString().slice(0, 10),
  })
  const [classes, setClasses] = useState<Class[]>([])
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(
    new Set(student?.enrollments?.map((e) => e.classId) ?? [])
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/classes?status=ACTIVE&limit=100').then(({ data }) => {
      setClasses(data.data ?? [])
    }).catch(() => {})
  }, [])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const toggleClass = (classId: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev)
      if (next.has(classId)) next.delete(classId)
      else next.add(classId)
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.fullName.trim()) { setError('Vui lòng nhập họ tên'); return }
    setSaving(true)
    setError('')
    try {
      let studentId: string

      if (isEdit) {
        const payload: Record<string, unknown> = {
          fullName: form.fullName,
          gradeLevel: form.gradeLevel || null,
          parentName: form.parentName,
          phone: form.phone,
          parentId: student!.primaryParent?.id ?? null,
        }
        await api.put(`/students/${student!.id}`, payload)
        studentId = student!.id
      } else {
        const payload: Record<string, unknown> = {
          fullName: form.fullName,
          gradeLevel: form.gradeLevel || null,
        }
        if (form.parentName.trim() || form.phone.trim()) {
          payload.parents = [{ fullName: form.parentName, phone: form.phone, isPrimaryContact: true }]
        }
        const { data } = await api.post('/students', payload)
        studentId = data.id
      }

      // Xử lý đăng ký lớp học
      const currentIds = new Set(student?.enrollments?.map((e) => e.classId) ?? [])

      // Enroll lớp mới được chọn
      const toEnroll = [...selectedClassIds].filter((id) => !currentIds.has(id))
      await Promise.all(toEnroll.map((classId) =>
        api.post(`/students/${studentId}/enroll`, { classId, enrollmentDate: form.enrollmentDate || undefined })
      ))

      // Drop lớp bị bỏ chọn (chỉ khi edit)
      if (isEdit && student!.enrollments) {
        const toDrop = student!.enrollments.filter((e) => !selectedClassIds.has(e.classId))
        await Promise.all(toDrop.map((e) =>
          api.put(`/students/${studentId}/enroll/${e.id}/drop`, {})
        ))
      }

      onSaved()
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-container-lowest rounded-2xl shadow-2xl p-8 z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-headline font-bold text-on-surface">
            {isEdit ? 'Chỉnh sửa học viên' : 'Thêm học viên mới'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-container-low rounded-lg transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error-container/10 text-error rounded-xl text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Họ và tên *</label>
            <input value={form.fullName} onChange={set('fullName')} required
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Nguyễn Văn A" />
          </div>

          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Khối lớp</label>
            <select value={form.gradeLevel} onChange={set('gradeLevel')}
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">Chọn khối...</option>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map((g) => (
                <option key={g} value={g}>Lớp {g}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Phụ huynh</label>
            <input value={form.parentName} onChange={set('parentName')}
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Họ tên phụ huynh" />
          </div>

          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Số điện thoại</label>
            <input value={form.phone} onChange={set('phone')} type="tel"
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="0901 234 567" />
          </div>

          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Đăng ký lớp học</label>
            {classes.length === 0 ? (
              <p className="text-sm text-outline py-2">Không có lớp đang hoạt động</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {classes.map((c) => {
                  const selected = selectedClassIds.has(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleClass(c.id)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                        selected
                          ? 'bg-primary text-on-primary border-primary'
                          : 'bg-surface-container-low text-on-surface-variant border-transparent hover:border-primary/30'
                      }`}
                    >
                      {c.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Ngày đăng ký</label>
            <input
              type="date"
              value={form.enrollmentDate}
              onChange={set('enrollmentDate')}
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary justify-center">Huỷ</button>
            <button type="submit" disabled={saving} className="flex-1 btn-primary justify-center disabled:opacity-60">
              {saving ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Thêm học viên'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
