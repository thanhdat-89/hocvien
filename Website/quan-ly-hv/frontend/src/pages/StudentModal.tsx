import React, { useState, useEffect } from 'react'
import api from '../services/api'
import { Student, Class } from '../types'

interface Props {
  student: Student | null
  onClose: () => void
  onSaved: () => void
}

function gradeOfClass(cls: Class): number | null {
  const grade = Number(cls.gradeLevel)
  if (grade >= 1 && grade <= 12) return grade
  const match = cls.name.match(/(?:^|\s)(?:toán|lớp)\s*(\d{1,2})(?!\d)/i)
  return match ? Number(match[1]) : null
}

function todayLocalDate() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

export default function StudentModal({ student, onClose, onSaved }: Props) {
  const isEdit = !!student
  const [form, setForm] = useState({
    fullName: student?.fullName ?? '',
    gradeLevel: student?.gradeLevel?.toString() ?? '',
    enrollmentDate: todayLocalDate(),
  })
  const [classes, setClasses] = useState<Class[]>([])
  const [classesLoading, setClassesLoading] = useState(true)
  const [classesError, setClassesError] = useState(false)
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(
    new Set(student?.enrollments?.map((e) => e.classId) ?? [])
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/classes?status=ACTIVE&limit=100').then(({ data }) => {
      setClasses([...(data.data ?? [])].sort((a: Class, b: Class) =>
        a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' })
      ))
    }).catch(() => setClassesError(true)).finally(() => setClassesLoading(false))
  }, [])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleGradeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const gradeLevel = e.target.value
    setForm((f) => ({ ...f, gradeLevel }))
    const existingIds = new Set(student?.enrollments?.map((enrollment) => enrollment.classId) ?? [])
    setSelectedClassIds((previous) => new Set([...previous].filter((id) => {
      const cls = classes.find((item) => item.id === id)
      return existingIds.has(id) || (gradeLevel !== '' && cls && gradeOfClass(cls) === Number(gradeLevel))
    })))
  }

  const gradeClasses = form.gradeLevel
    ? classes.filter((cls) => gradeOfClass(cls) === Number(form.gradeLevel))
    : []
  const otherSelectedClasses = classes.filter((cls) =>
    selectedClassIds.has(cls.id) && !gradeClasses.some((visible) => visible.id === cls.id)
  )

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
        }
        await api.put(`/students/${student!.id}`, payload)
        studentId = student!.id
      } else {
        const payload: Record<string, unknown> = {
          fullName: form.fullName,
          gradeLevel: form.gradeLevel || null,
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[3px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="student-modal-title" className="relative z-10 flex max-h-[92dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary">
              <span className="material-symbols-outlined text-[22px]">{isEdit ? 'edit' : 'person_add'}</span>
            </div>
            <div className="min-w-0">
              <h3 id="student-modal-title" className="font-headline text-lg font-bold leading-6 text-on-surface">{isEdit ? 'Chỉnh sửa học viên' : 'Thêm học viên mới'}</h3>
              <p className="mt-0.5 text-sm text-slate-500">Thông tin cơ bản và lớp học đăng ký</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng cửa sổ học viên" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-7">
            {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

            <div>
              <label htmlFor="student-full-name" className="mb-1.5 block text-sm font-semibold text-on-surface">Họ và tên <span className="text-rose-600">*</span></label>
              <input id="student-full-name" value={form.fullName} onChange={set('fullName')} required autoFocus
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-on-surface placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Nhập họ và tên học viên" />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="student-grade" className="mb-1.5 block text-sm font-semibold text-on-surface">Khối lớp</label>
                <select id="student-grade" value={form.gradeLevel} onChange={handleGradeChange}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Chọn khối lớp</option>
                  {[6,7,8,9,10,11,12].map((g) => (
                    <option key={g} value={g}>Khối {g}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="student-enrollment-date" className="mb-1.5 block text-sm font-semibold text-on-surface">Ngày đăng ký lớp</label>
                <input id="student-enrollment-date" type="date" value={form.enrollmentDate} onChange={set('enrollmentDate')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>

            <div className="border-t border-slate-100 pt-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-on-surface">Đăng ký lớp học</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Học viên mới học riêng chưa cần chọn lớp học. Có thể bổ sung sau trong hồ sơ học viên.</p>
                </div>
                {selectedClassIds.size > 0 && <span className="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-primary">Đã chọn {selectedClassIds.size}</span>}
              </div>
              {!form.gradeLevel ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">Chọn khối lớp để xem các lớp học phù hợp.</div>
              ) : classesLoading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">Đang tải danh sách lớp học...</div>
              ) : classesError ? (
                <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Không tải được danh sách lớp. Bạn vẫn có thể thêm học viên và đăng ký lớp sau.</div>
              ) : gradeClasses.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">Chưa có lớp đang hoạt động cho khối {form.gradeLevel}. Bạn có thể đăng ký lớp sau.</div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {gradeClasses.map((cls) => {
                    const selected = selectedClassIds.has(cls.id)
                    return (
                      <button key={cls.id} type="button" onClick={() => toggleClass(cls.id)} aria-pressed={selected}
                        className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-slate-50'}`}>
                        <span className="min-w-0 break-words">{cls.name}</span>
                        <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[18px]">{selected ? 'check_circle' : 'add_circle'}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {isEdit && otherSelectedClasses.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-2 text-xs font-medium text-amber-900">Đang đăng ký ở khối khác. Bỏ chọn nếu muốn ngừng học lớp đó.</p>
                  <div className="flex flex-wrap gap-2">
                    {otherSelectedClasses.map((cls) => (
                      <button key={cls.id} type="button" onClick={() => toggleClass(cls.id)} aria-pressed="true"
                        className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        {cls.name} <span aria-hidden="true">×</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4 sm:px-7">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Hủy</button>
            <button type="submit" disabled={saving} className="inline-flex min-w-[145px] items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Thêm học viên'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
