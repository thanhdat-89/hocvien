import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'
import { useConfirm, useAlert } from '../components/ConfirmDialog'
import api from '../services/api'
import { Student, ClassEnrollment, TuitionRecord, Parent, Class, StudentPromotion, PrivateSession } from '../types'
import { useAuth } from '../hooks/useAuth'
import { gradeOfClass } from '../lib/classGrade'
import { buildParentUrl } from '../lib/parentUrl'

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(date?: string | null) {
  if (!date) return '—'
  if (date.includes('/')) return date
  const [y, m, d] = date.slice(0, 10).split('-')
  if (!d || !m || !y) return date
  return `${d}/${m}/${y}`
}

function fmtMoney(n: number) {
  return n.toLocaleString('vi-VN') + 'đ'
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase font-bold text-outline tracking-wider">{label}</span>
      <p className="text-on-surface font-medium">{value || '—'}</p>
    </div>
  )
}

function TuitionStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PAID: 'bg-secondary-container/50 text-on-secondary-container',
    PARTIAL: 'bg-primary-container/20 text-primary',
    PENDING: 'bg-error-container/20 text-error',
    OVERPAID: 'bg-secondary-container text-on-secondary-container',
  }
  const labels: Record<string, string> = {
    PAID: 'Đã thanh toán',
    PARTIAL: 'Một phần',
    PENDING: 'Chưa nộp',
    OVERPAID: 'Thừa',
  }
  return (
    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${map[status] ?? 'bg-surface-container-high text-outline'}`}>
      {labels[status] ?? status}
    </span>
  )
}

// ─── Edit Student Modal ──────────────────────────────────────────────────────

function EditStudentModal({ student, onClose, onSaved }: { student: Student; onClose: () => void; onSaved: (s: Student) => void }) {
  const [form, setForm] = useState({
    fullName: student.fullName ?? '',
    dateOfBirth: student.dateOfBirth ?? '',
    gender: student.gender ?? '',
    school: student.school ?? '',
    gradeLevel: student.gradeLevel?.toString() ?? '',
    address: student.address ?? '',
    status: student.status ?? 'ACTIVE',
    notes: student.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.fullName.trim()) { setError('Vui lòng nhập họ tên'); return }
    setSaving(true); setError('')
    try {
      const res = await api.put(`/students/${student.id}`, {
        fullName: form.fullName,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        school: form.school || null,
        gradeLevel: form.gradeLevel || null,
        address: form.address || null,
        status: form.status,
        notes: form.notes || null,
      })
      onSaved(res.data)
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Chỉnh sửa hồ sơ" onClose={onClose}>
      {error && <div className="mb-4 p-3 bg-error-container/10 text-error rounded-xl text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Họ và tên *">
              <input value={form.fullName} onChange={set('fullName')} required className="input" placeholder="Nguyễn Văn A" />
            </Field>
          </div>
          <Field label="Ngày sinh">
            <input value={form.dateOfBirth} onChange={set('dateOfBirth')} type="date" className="input" />
          </Field>
          <Field label="Giới tính">
            <select value={form.gender} onChange={set('gender')} className="input">
              <option value="">Không rõ</option>
              <option value="MALE">Nam</option>
              <option value="FEMALE">Nữ</option>
            </select>
          </Field>
          <Field label="Trường học">
            <input value={form.school} onChange={set('school')} className="input" placeholder="THCS Nguyễn Du" />
          </Field>
          <Field label="Khối lớp">
            <select value={form.gradeLevel} onChange={set('gradeLevel')} className="input">
              <option value="">—</option>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(g => <option key={g} value={g}>Lớp {g}</option>)}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Địa chỉ">
              <input value={form.address} onChange={set('address')} className="input" placeholder="123 Đường ABC, Quận 1" />
            </Field>
          </div>
          <Field label="Trạng thái">
            <select value={form.status} onChange={set('status')} className="input">
              <option value="ACTIVE">Đang học</option>
              <option value="INACTIVE">Đã nghỉ</option>
              <option value="RESERVED">Bảo lưu</option>
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Ghi chú">
              <textarea value={form.notes} onChange={set('notes')} className="input resize-none" rows={2} placeholder="Ghi chú thêm..." />
            </Field>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 btn-secondary justify-center">Huỷ</button>
          <button type="submit" disabled={saving} className="flex-1 btn-primary justify-center disabled:opacity-60">
            {saving ? 'Đang lưu...' : 'Cập nhật'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Parent Modal ────────────────────────────────────────────────────────────

function ParentModal({ studentId, parent, onClose, onSaved }: {
  studentId: string
  parent: (Parent & { id: string }) | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!parent
  const [form, setForm] = useState({
    fullName: parent?.fullName ?? '',
    relationship: parent?.relationship ?? '',
    phone: parent?.phone ?? parent?.zalo ?? '',
    email: parent?.email ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.fullName.trim()) { setError('Vui lòng nhập tên phụ huynh'); return }
    setSaving(true); setError('')
    const payload = {
      ...form,
      zalo: form.phone,
      isPrimaryContact: true,
    }
    try {
      if (isEdit) {
        await api.put(`/parents/${studentId}/${parent!.id}`, payload)
      } else {
        await api.post('/parents', { ...payload, studentId })
      }
      onSaved()
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={isEdit ? 'Chỉnh sửa phụ huynh' : 'Thêm phụ huynh'} onClose={onClose}>
      {error && <div className="mb-4 p-3 bg-error-container/10 text-error rounded-xl text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Họ và tên *">
              <input value={form.fullName} onChange={set('fullName')} required className="input" placeholder="Nguyễn Thị B" />
            </Field>
          </div>
          <Field label="Quan hệ">
            <select value={form.relationship} onChange={set('relationship')} className="input">
              <option value="">—</option>
              <option value="Bố">Bố</option>
              <option value="Mẹ">Mẹ</option>
              <option value="Anh/Chị">Anh/Chị</option>
              <option value="Ông/Bà">Ông/Bà</option>
              <option value="Người giám hộ">Người giám hộ</option>
            </select>
          </Field>
          <Field label="Số điện thoại / Zalo">
            <input value={form.phone} onChange={set('phone')} type="tel" className="input" placeholder="0901 234 567" />
          </Field>
          <Field label="Email">
            <input value={form.email} onChange={set('email')} type="email" className="input" placeholder="email@example.com" />
          </Field>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 btn-secondary justify-center">Huỷ</button>
          <button type="submit" disabled={saving} className="flex-1 btn-primary justify-center disabled:opacity-60">
            {saving ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Thêm phụ huynh'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Enroll Modal ────────────────────────────────────────────────────────────

function EnrollModal({ student, enrollments, onClose, onSaved }: { student: Student; enrollments: ClassEnrollment[]; onClose: () => void; onSaved: () => void }) {
  const [classes, setClasses] = useState<Class[]>([])
  const [classId, setClassId] = useState('')
  const [enrollmentDate, setEnrollmentDate] = useState(() => {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  })
  const [classesLoading, setClassesLoading] = useState(true)
  const [classesError, setClassesError] = useState(false)
  const [showOtherGrades, setShowOtherGrades] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/classes', { params: { status: 'ACTIVE', limit: 100 } })
      .then(r => setClasses([...(r.data?.data ?? r.data ?? [])].sort((a: Class, b: Class) =>
        a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' })
      )))
      .catch(() => setClassesError(true))
      .finally(() => setClassesLoading(false))
  }, [])

  const activeClassIds = new Set(enrollments.filter(e => e.status === 'ACTIVE').map(e => e.classId))
  const availableClasses = classes.filter(cls => !activeClassIds.has(cls.id))
  const studentGrade = student.gradeLevel ? Number(student.gradeLevel) : null
  const suggestedClasses = studentGrade
    ? availableClasses.filter(cls => gradeOfClass(cls) === studentGrade)
    : availableClasses
  const otherClasses = studentGrade
    ? availableClasses.filter(cls => gradeOfClass(cls) !== studentGrade)
    : []
  const selectedClass = availableClasses.find(cls => cls.id === classId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!classId) { setError('Vui lòng chọn lớp học'); return }
    setSaving(true); setError('')
    try {
      await api.post(`/students/${student.id}/enroll`, { classId, enrollmentDate })
      onSaved()
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra')
    } finally {
      setSaving(false)
    }
  }

  const renderClass = (cls: Class) => {
    const selected = classId === cls.id
    return (
      <button key={cls.id} type="button" onClick={() => setClassId(cls.id)} aria-pressed={selected}
        aria-label={`Chọn lớp ${cls.name}`}
        className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-slate-50'}`}>
        <span className="min-w-0">
          <span className="block break-words text-sm font-semibold">{cls.name}</span>
          {cls.teacherName && <span className="mt-0.5 block text-xs font-normal text-slate-500">Giáo viên: {cls.teacherName}</span>}
        </span>
        <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[20px]">{selected ? 'check_circle' : 'radio_button_unchecked'}</span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[3px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="enroll-modal-title" className="relative z-10 flex max-h-[92dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary">
              <span className="material-symbols-outlined text-[22px]">how_to_reg</span>
            </div>
            <div className="min-w-0">
              <h3 id="enroll-modal-title" className="font-headline text-lg font-bold leading-6 text-on-surface">Đăng ký lớp học</h3>
              <p className="mt-0.5 truncate text-sm text-slate-500" title={student.fullName}>{student.fullName}{studentGrade ? ` · Khối ${studentGrade}` : ''}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng cửa sổ đăng ký lớp" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-7">
            {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
            <div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-on-surface">{studentGrade ? `Lớp phù hợp với khối ${studentGrade}` : 'Lớp học đang hoạt động'}</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Chọn một lớp để đăng ký. Các lớp đang học đã được ẩn.</p>
                </div>
                {suggestedClasses.length > 0 && <span className="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-primary">{suggestedClasses.length} lớp</span>}
              </div>
              {classesLoading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">Đang tải danh sách lớp...</div>
              ) : classesError ? (
                <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Không tải được danh sách lớp. Vui lòng đóng và thử lại.</div>
              ) : suggestedClasses.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">{studentGrade ? `Không còn lớp phù hợp với khối ${studentGrade} để đăng ký.` : 'Không có lớp đang hoạt động để đăng ký.'}</div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{suggestedClasses.map(renderClass)}</div>
              )}
              {!studentGrade && !classesLoading && !classesError && (
                <p className="mt-3 text-xs text-slate-500">Học viên chưa có khối lớp. Bạn có thể bổ sung khối trong phần chỉnh sửa hồ sơ.</p>
              )}
              {otherClasses.length > 0 && !classesLoading && !classesError && (
                <div className="mt-4">
                  <button type="button" onClick={() => setShowOtherGrades(value => !value)} aria-expanded={showOtherGrades}
                    className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <span className="material-symbols-outlined text-[18px]">{showOtherGrades ? 'expand_less' : 'expand_more'}</span>
                    {showOtherGrades ? 'Ẩn lớp khối khác' : `Xem lớp khối khác (${otherClasses.length})`}
                  </button>
                  {showOtherGrades && <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{otherClasses.map(renderClass)}</div>}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-5">
              <label htmlFor="enrollment-date" className="mb-1.5 block text-sm font-semibold text-on-surface">Ngày đăng ký</label>
              <input id="enrollment-date" value={enrollmentDate} onChange={e => setEnrollmentDate(e.target.value)} type="date"
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-7">
            <span className="hidden min-w-0 truncate text-xs text-slate-500 sm:block" title={selectedClass?.name}>{selectedClass ? `Đã chọn: ${selectedClass.name}` : 'Chưa chọn lớp học'}</span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Hủy</button>
              <button type="submit" disabled={saving || !classId} className="inline-flex min-w-[112px] items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? 'Đang lưu...' : 'Đăng ký'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Payment Modal ───────────────────────────────────────────────────────────

function PaymentModal({ record, onClose, onSaved }: { record: TuitionRecord; onClose: () => void; onSaved: () => void }) {
  const remaining = record.finalAmount - record.paidAmount
  const [form, setForm] = useState({
    amount: remaining > 0 ? remaining.toString() : '',
    method: 'CASH',
    paymentDate: new Date().toISOString().slice(0, 10),
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!amount || amount <= 0) { setError('Số tiền không hợp lệ'); return }
    setSaving(true); setError('')
    try {
      await api.post(`/tuition/${record.id}/payment`, {
        amount,
        method: form.method,
        paymentDate: form.paymentDate,
        notes: form.notes || undefined,
      })
      onSaved()
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Ghi nhận thanh toán" onClose={onClose}>
      <div className="mb-4 p-4 bg-surface-container-low rounded-xl">
        <p className="text-sm text-outline mb-1">{record.className} — Tháng {record.billingMonth}/{record.billingYear}</p>
        <div className="flex justify-between text-sm">
          <span className="text-on-surface-variant">Phải nộp:</span>
          <span className="font-bold text-on-surface">{fmtMoney(record.finalAmount)}</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-on-surface-variant">Đã nộp:</span>
          <span className="font-medium text-secondary">{fmtMoney(record.paidAmount)}</span>
        </div>
        <div className="flex justify-between text-sm mt-1 border-t border-outline-variant/10 pt-1">
          <span className="text-on-surface-variant">Còn lại:</span>
          <span className={`font-bold ${remaining > 0 ? 'text-error' : 'text-secondary'}`}>{fmtMoney(remaining)}</span>
        </div>
      </div>
      {error && <div className="mb-4 p-3 bg-error-container/10 text-error rounded-xl text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Số tiền nộp (đ) *">
          <input value={form.amount} onChange={set('amount')} type="number" min="1000" required className="input" placeholder="0" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Hình thức">
            <select value={form.method} onChange={set('method')} className="input">
              <option value="CASH">Tiền mặt</option>
              <option value="BANK_TRANSFER">Chuyển khoản</option>
              <option value="MOMO">MoMo</option>
              <option value="ZALOPAY">ZaloPay</option>
            </select>
          </Field>
          <Field label="Ngày nộp">
            <input value={form.paymentDate} onChange={set('paymentDate')} type="date" className="input" />
          </Field>
        </div>
        <Field label="Ghi chú">
          <input value={form.notes} onChange={set('notes')} className="input" placeholder="Ghi chú..." />
        </Field>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 btn-secondary justify-center">Huỷ</button>
          <button type="submit" disabled={saving} className="flex-1 btn-primary justify-center disabled:opacity-60">
            {saving ? 'Đang lưu...' : 'Ghi nhận'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Shared UI atoms ─────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-container-lowest rounded-2xl shadow-2xl p-8 z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-headline font-bold text-on-surface">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-container-low rounded-lg transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">{label}</label>
      {children}
    </div>
  )
}

// ─── Confirm Dialog ──────────────────────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface-container-lowest rounded-2xl shadow-2xl p-6 w-full max-w-sm z-10">
        <p className="text-on-surface font-medium mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 btn-secondary justify-center">Huỷ</button>
          <button onClick={onConfirm} className="flex-1 px-4 py-2.5 bg-error text-on-error rounded-xl text-sm font-bold hover:opacity-90 transition-opacity flex items-center justify-center">Xác nhận</button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Info ───────────────────────────────────────────────────────────────

function InfoTab({
  student,
  parents,
  enrollments,
  onRefresh,
  onEdit,
  onStatusChange,
  canManage,
}: {
  student: Student & { id: string }
  parents: (Parent & { id: string })[]
  enrollments: ClassEnrollment[]
  onRefresh: () => void
  onEdit: () => void
  onStatusChange: (status: 'ACTIVE' | 'INACTIVE' | 'RESERVED') => void
  canManage: boolean
}) {
  const showAlert = useAlert()
  const [parentModal, setParentModal] = useState<{ open: boolean; parent: (Parent & { id: string }) | null }>({ open: false, parent: null })
  const [enrollModal, setEnrollModal] = useState(false)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const deleteEnrollment = (e: ClassEnrollment) => {
    setConfirm({
      message: `Xoá lớp "${e.className}" khỏi danh sách đã nghỉ? Lớp này sẽ bị xoá hoàn toàn khỏi lịch học cá nhân của học viên.`,
      onConfirm: async () => {
        setConfirm(null)
        try {
          const url = `/students/${student.id}/enroll/${e.id}/remove`
          console.log('[deleteEnrollment] POST', url, 'enrollment:', e)
          await api.post(url, {})
          onRefresh()
        } catch (err: any) {
          console.error('[deleteEnrollment] error:', err.response?.status, err.response?.data)
          void showAlert('Lỗi: ' + (err.response?.data?.message ?? err.message ?? 'Không thể xoá') + '\nURL: /students/' + student.id + '/enroll/' + e.id)
        }
      },
    })
  }

  const dropEnrollment = (e: ClassEnrollment) => {
    setConfirm({
      message: `Cho học viên nghỉ lớp "${e.className}"?`,
      onConfirm: async () => {
        setConfirm(null)
        await api.put(`/students/${student.id}/enroll/${e.id}/drop`, {})
        onRefresh()
      },
    })
  }

  const deleteParent = (p: Parent & { id: string }) => {
    setConfirm({
      message: `Xoá thông tin phụ huynh "${p.fullName}"?`,
      onConfirm: async () => {
        setConfirm(null)
        await api.delete(`/parents/${student.id}/${p.id}`)
        onRefresh()
      },
    })
  }

  const activeEnrollments = enrollments.filter(e => e.status === 'ACTIVE')
  const droppedEnrollments = enrollments.filter(e => e.status === 'DROPPED')

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Basic info */}
        <div className="md:col-span-4 bg-surface-container-lowest rounded-xl p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6 border-b border-outline-variant/10 pb-4">
            <h3 className="font-headline text-lg font-bold text-on-surface">Thông tin cơ bản</h3>
            {canManage && (
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
              >
                <span className="material-symbols-outlined text-base">edit</span>Chỉnh sửa
              </button>
            )}
          </div>
          <div className="space-y-5">
            <InfoRow label="Ngày sinh" value={fmt(student.dateOfBirth)} />
            <InfoRow label="Giới tính" value={student.gender === 'MALE' ? 'Nam' : student.gender === 'FEMALE' ? 'Nữ' : null} />
            <InfoRow label="Trường học" value={student.school} />
            <InfoRow label="Địa chỉ" value={student.address} />
            <InfoRow label="Ngày nhập học" value={fmt(student.enrollmentDate)} />
            {student.notes && <InfoRow label="Ghi chú" value={student.notes} />}
          </div>

          {/* Status actions */}
          {canManage && (
            <div className="mt-6 pt-5 border-t border-outline-variant/10 flex flex-col gap-2">
              {student.status !== 'ACTIVE' && (
                <button
                  onClick={() => onStatusChange('ACTIVE')}
                  className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-secondary hover:bg-secondary-container/20 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  Kích hoạt đang học
                </button>
              )}
              {student.status !== 'RESERVED' && (
                <button
                  onClick={() => onStatusChange('RESERVED')}
                  className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-outline hover:bg-surface-container-high transition-colors"
                >
                  <span className="material-symbols-outlined text-base">pause_circle</span>
                  Bảo lưu
                </button>
              )}
              {student.status !== 'INACTIVE' && (
                <button
                  onClick={() => onStatusChange('INACTIVE')}
                  className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-error hover:bg-error-container/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">cancel</span>
                  Cho nghỉ học
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="md:col-span-8 space-y-6">
          {/* Parents */}
          <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm">
            <div className="flex items-center justify-between mb-6 border-b border-outline-variant/10 pb-4">
              <h3 className="font-headline text-lg font-bold text-on-surface">Phụ huynh / Liên hệ</h3>
              {canManage && (
                <button
                  onClick={() => setParentModal({ open: true, parent: null })}
                  className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">add</span>Thêm
                </button>
              )}
            </div>
            {parents.length === 0 ? (
              <p className="text-sm text-outline">Chưa có thông tin phụ huynh</p>
            ) : (
              <div className="space-y-3">
                {parents.map(p => (
                  <div key={p.id} className="p-4 bg-surface-container-low rounded-xl flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                      {p.fullName?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-on-surface">{p.fullName}</p>
                        {p.isPrimaryContact && (
                          <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">Liên hệ chính</span>
                        )}
                      </div>
                      <p className="text-sm text-outline mt-0.5">{p.relationship}</p>
                      <div className="flex gap-4 mt-2 flex-wrap">
                        {p.phone && (
                          <a href={`tel:${p.phone}`} className="text-sm text-on-surface-variant flex items-center gap-1 hover:text-primary transition-colors">
                            <span className="material-symbols-outlined text-sm">phone</span>{p.phone}
                          </a>
                        )}
                        {(() => {
                          const zaloUrl = buildZaloUrl(p.zalo || p.phone)
                          return zaloUrl ? (
                            <a
                              href={zaloUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-500 flex items-center gap-1 hover:underline"
                              title="Mở Zalo để nhắn tin"
                            >
                              <span className="material-symbols-outlined text-sm">chat</span>
                              Nhắn Zalo
                            </a>
                          ) : null
                        })()}
                        {p.email && (
                          <a href={`mailto:${p.email}`} className="text-sm text-on-surface-variant flex items-center gap-1 hover:text-primary transition-colors">
                            <span className="material-symbols-outlined text-sm">mail</span>{p.email}
                          </a>
                        )}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => setParentModal({ open: true, parent: p })}
                          className="p-1.5 rounded-lg hover:bg-surface-container-highest text-outline hover:text-on-surface transition-colors">
                          <span className="material-symbols-outlined text-base">edit</span>
                        </button>
                        <button onClick={() => deleteParent(p)}
                          className="p-1.5 rounded-lg hover:bg-error-container/20 text-outline hover:text-error transition-colors">
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Enrollments */}
          <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm">
            <div className="flex items-center justify-between mb-6 border-b border-outline-variant/10 pb-4">
              <h3 className="font-headline text-lg font-bold text-on-surface">Lớp học</h3>
              {canManage && (
                <button
                  onClick={() => setEnrollModal(true)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">add</span>Đăng ký lớp
                </button>
              )}
            </div>
            {activeEnrollments.length === 0 ? (
              <p className="text-sm text-outline">Chưa đăng ký lớp nào</p>
            ) : (
              <div className="space-y-2 mb-4">
                {activeEnrollments.map(e => (
                  <div key={e.id} className="flex items-center justify-between p-3 bg-surface-container-low rounded-xl">
                    <div>
                      <p className="font-semibold text-on-surface text-sm">{e.className}</p>
                      <p className="text-xs text-outline">Ngày đăng ký: {fmt(e.enrollmentDate)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] bg-secondary-container/30 text-secondary px-2 py-1 rounded-full font-bold">Đang học</span>
                      {canManage && (
                        <button
                          onClick={() => dropEnrollment(e)}
                          className="p-1.5 rounded-lg hover:bg-error-container/20 text-outline hover:text-error transition-colors"
                          title="Cho nghỉ lớp"
                        >
                          <span className="material-symbols-outlined text-base">person_remove</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {droppedEnrollments.length > 0 && (
              <details className="group">
                <summary className="text-xs text-outline cursor-pointer select-none hover:text-on-surface transition-colors">
                  Đã nghỉ ({droppedEnrollments.length} lớp)
                </summary>
                <div className="space-y-2 mt-2">
                  {droppedEnrollments.map(e => (
                    <div key={e.id} className="flex items-center justify-between p-3 bg-surface-container-low/50 rounded-xl opacity-60 hover:opacity-80 transition-opacity">
                      <div>
                        <p className="font-semibold text-on-surface text-sm line-through">{e.className}</p>
                        <p className="text-xs text-outline">Đăng ký: {fmt(e.enrollmentDate)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-surface-container-high text-outline px-2 py-1 rounded-full font-bold">Đã nghỉ</span>
                        {canManage && (
                          <button
                            onClick={() => deleteEnrollment(e)}
                            className="p-1 hover:bg-error/10 hover:text-error text-outline rounded-lg transition-colors"
                            title="Xoá khỏi lịch học"
                          >
                            <span className="material-symbols-outlined text-base">delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {parentModal.open && (
        <ParentModal
          studentId={student.id}
          parent={parentModal.parent}
          onClose={() => setParentModal({ open: false, parent: null })}
          onSaved={() => { setParentModal({ open: false, parent: null }); onRefresh() }}
        />
      )}
      {enrollModal && (
        <EnrollModal
          student={student}
          enrollments={enrollments}
          onClose={() => setEnrollModal(false)}
          onSaved={() => { setEnrollModal(false); onRefresh() }}
        />
      )}
      {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
    </>
  )
}

// ─── Tab: Reviews ────────────────────────────────────────────────────────────

interface StudentReview {
  id: string
  month: string
  content: string
  teacherName?: string
  createdAt?: string
  updatedAt?: string
}

function ReviewsTab({ studentId }: { studentId: string }) {
  const now = new Date()
  const confirm = useConfirm()
  const alert = useAlert()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [list, setList] = useState<StudentReview[]>([])
  const [content, setContent] = useState('')
  const [teacherName, setTeacherName] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const existing = list.find(r => r.month === monthKey)

  const load = () => {
    setLoading(true)
    api.get(`/reviews/${studentId}`)
      .then(r => setList(r.data ?? []))
      .catch(() => setList([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [studentId])

  useEffect(() => {
    if (existing) {
      setContent(existing.content)
      setTeacherName(existing.teacherName ?? '')
    } else {
      setContent('')
      setTeacherName('')
    }
  }, [monthKey, existing?.id])

  const handleSave = async () => {
    if (!content.trim()) {
      await alert({ title: 'Thiếu nội dung', message: 'Vui lòng nhập nội dung nhận xét.' })
      return
    }
    setSaving(true)
    try {
      await api.put(`/reviews/${studentId}/${monthKey}`, {
        content: content.trim(),
        teacherName: teacherName.trim() || undefined,
      })
      load()
    } catch {
      await alert({ title: 'Lỗi', message: 'Không lưu được nhận xét. Thử lại sau.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!existing) return
    const ok = await confirm({
      title: 'Xoá nhận xét',
      message: `Xoá nhận xét tháng ${month}/${year}?`,
      confirmLabel: 'Xoá',
      danger: true,
    })
    if (!ok) return
    try {
      await api.delete(`/reviews/${studentId}/${monthKey}`)
      load()
    } catch {
      await alert({ title: 'Lỗi', message: 'Không xoá được nhận xét.' })
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  return (
    <div className="space-y-6">
      {/* Editor */}
      <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className="input py-2 w-32">
              {months.map(m => <option key={m} value={m}>Tháng {m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))} className="input py-2 w-28">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {existing && (
              <span className="px-2 py-1 rounded-md bg-secondary-container/30 text-secondary text-xs font-bold uppercase">
                Đã có nhận xét
              </span>
            )}
          </div>
          {existing && (
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 text-sm font-semibold text-error hover:bg-error-container/20 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-base">delete</span>Xoá
            </button>
          )}
        </div>

        <div className="space-y-3">
          <input
            type="text"
            value={teacherName}
            onChange={e => setTeacherName(e.target.value)}
            placeholder="Tên giáo viên (không bắt buộc)"
            className="input w-full"
          />
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Nhập nhận xét về quá trình học tập của học viên trong tháng..."
            rows={6}
            className="input w-full resize-y"
          />
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-lg">save</span>
              {saving ? 'Đang lưu...' : (existing ? 'Cập nhật' : 'Lưu nhận xét')}
            </button>
          </div>
        </div>
      </div>

      {/* History list */}
      <div>
        <h3 className="font-headline text-lg font-bold text-on-surface mb-3">Lịch sử nhận xét</h3>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : list.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl p-8 text-center shadow-sm">
            <span className="material-symbols-outlined text-4xl text-outline/40 block mb-2">rate_review</span>
            <p className="text-sm text-outline">Chưa có nhận xét nào</p>
          </div>
        ) : (
          <div className="space-y-3">
            {list.map(r => {
              const [yy, mm] = r.month.split('-')
              const isCurrent = r.month === monthKey
              return (
                <div
                  key={r.id}
                  className={`bg-surface-container-lowest rounded-xl p-4 shadow-sm border-2 transition-colors cursor-pointer hover:border-primary/40 ${isCurrent ? 'border-primary' : 'border-transparent'}`}
                  onClick={() => { setMonth(Number(mm)); setYear(Number(yy)) }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-on-surface">Tháng {Number(mm)}/{yy}</span>
                    {r.teacherName && (
                      <span className="text-xs text-outline">— {r.teacherName}</span>
                    )}
                  </div>
                  <p className="text-sm text-on-surface-variant whitespace-pre-wrap">{r.content}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Test Scores (theo tháng) ───────────────────────────────────────────

interface MonthlyScoresDoc {
  id: string
  studentId: string
  studentName: string
  classId: string
  className: string
  year: number
  month: number
  expectedCount: number
  scores: (number | null)[]
  notes?: string
  updatedAt: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ScoresTab({ studentId, enrollments: _enrollments }: { studentId: string; enrollments: ClassEnrollment[] }) {
  const [list, setList] = useState<MonthlyScoresDoc[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get(`/monthly-scores/student/${studentId}`)
      .then(r => setList(r.data ?? []))
      .catch(() => setList([]))
      .finally(() => setLoading(false))
  }, [studentId])

  const scoreColor = (s: number | null) => {
    if (s == null) return ''
    if (s >= 8) return 'text-emerald-600'
    if (s >= 6.5) return 'text-primary'
    if (s >= 5) return 'text-amber-600'
    return 'text-error'
  }

  return (
    <div className="space-y-4">
      <h3 className="font-headline text-lg font-bold text-on-surface">Điểm kiểm tra</h3>
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : list.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-xl p-10 text-center shadow-sm">
          <span className="material-symbols-outlined text-5xl text-outline/40 block mb-2">grade</span>
          <p className="text-sm text-outline">Chưa có điểm kiểm tra nào</p>
          <p className="text-xs text-outline/70 mt-1">Vào trang "Điểm kiểm tra" để chấm điểm theo tháng</p>
        </div>
      ) : list.map(m => {
        const valid = m.scores.filter((x): x is number => x != null)
        const avg = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null
        return (
          <div key={m.id} className="bg-surface-container-lowest rounded-xl p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
              <div>
                <h4 className="font-bold text-on-surface text-sm">Tháng {m.month}/{m.year}</h4>
                <p className="text-xs text-outline">{m.className}</p>
              </div>
              {avg != null && (
                <div className="text-right">
                  <p className="text-[10px] text-outline uppercase tracking-wider">TB</p>
                  <p className={`text-xl font-extrabold ${scoreColor(avg)}`}>{avg.toFixed(1)}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {m.scores.map((s, i) => (
                <span key={i}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold border border-outline-variant/20 ${
                    s == null ? 'text-outline/50' : scoreColor(s)
                  } bg-surface-container-low/50`}>
                  <span className="text-[10px] opacity-60">KT{i + 1}</span>
                  <span>{s == null ? '—' : s}</span>
                </span>
              ))}
            </div>
            {m.notes && (
              <p className="text-xs text-on-surface-variant bg-surface-container-low/40 rounded-lg p-2 mt-3 leading-relaxed whitespace-pre-wrap">
                <span className="material-symbols-outlined align-text-bottom text-outline mr-1" style={{ fontSize: 14 }}>edit_note</span>
                {m.notes}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}


// ─── Tab: Tuition ────────────────────────────────────────────────────────────

interface TuitionRow {
  monthKey: string; month: number; year: number
  classId: string; className: string
  totalSessions: number; ratePerSession: number
  discountAmount: number; baseAmount: number; finalAmount: number
  tuitionRecord: {
    id: string
    finalAmount: number
    status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'
    paidAmount: number
    remainingAmount: number
  } | null
}

interface PromoModalProps {
  studentId: string
  enrollments: ClassEnrollment[]
  hasPrivate: boolean
  onClose: () => void
  onSaved: () => void
}

function PromoModal({ studentId, enrollments, hasPrivate, onClose, onSaved }: PromoModalProps) {
  const today = new Date()
  const defaultFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const allOptions = [
    ...enrollments.map(e => ({ classId: e.classId, className: e.className })),
    ...(hasPrivate ? [{ classId: 'private', className: 'Học riêng' }] : []),
  ]
  const [classId, setClassId] = useState(allOptions[0]?.classId ?? '')
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE')
  const [value, setValue] = useState('')
  const [appliedFrom, setAppliedFrom] = useState(defaultFrom)  // "YYYY-MM"
  const [appliedTo, setAppliedTo] = useState('')               // "YYYY-MM" or empty
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!classId || !value) { setError('Vui lòng điền đầy đủ thông tin'); return }
    setSaving(true); setError('')
    // Convert month "YYYY-MM" → first/last day of month for date range
    const fromDate = appliedFrom ? `${appliedFrom}-01` : undefined
    const toDate = appliedTo
      ? (() => { const [y, m] = appliedTo.split('-'); return `${y}-${m}-${new Date(+y, +m, 0).getDate()}` })()
      : undefined
    try {
      await api.post('/tuition/student-promotions/direct', {
        studentId, classId, type, value: Number(value),
        appliedFrom: fromDate, appliedTo: toDate,
      })
      onSaved()
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra')
    } finally { setSaving(false) }
  }

  if (allOptions.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-md bg-surface-container-lowest rounded-2xl shadow-2xl p-8 z-10">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-headline font-bold text-on-surface">Thêm khuyến mại</h3>
            <button onClick={onClose} className="p-2 hover:bg-surface-container-low rounded-lg transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <p className="text-sm text-outline py-4">Học viên chưa có lớp học hoặc lịch học riêng nào.</p>
          <button onClick={onClose} className="w-full btn-secondary justify-center">Đóng</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-container-lowest rounded-2xl shadow-2xl p-8 z-10">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-headline font-bold text-on-surface">Thêm khuyến mại</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-container-low rounded-lg transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {error && <div className="mb-4 p-3 bg-error-container/10 text-error rounded-xl text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Lớp học</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              {allOptions.map(o => (
                <option key={o.classId} value={o.classId}>{o.className}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Loại giảm giá</label>
            <div className="flex gap-3">
              {[{ v: 'PERCENTAGE', label: 'Giảm %' }, { v: 'FIXED_AMOUNT', label: 'Giảm tiền' }].map(opt => (
                <button key={opt.v} type="button"
                  onClick={() => setType(opt.v as 'PERCENTAGE' | 'FIXED_AMOUNT')}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                    type === opt.v ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-low text-on-surface-variant border-transparent'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">
              {type === 'PERCENTAGE' ? 'Tỷ lệ giảm (%)' : 'Số tiền giảm (đ)'}
            </label>
            <input type="number" value={value} onChange={e => setValue(e.target.value)} required
              min={1} max={type === 'PERCENTAGE' ? 100 : undefined}
              placeholder={type === 'PERCENTAGE' ? 'Ví dụ: 10' : 'Ví dụ: 200000'}
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Từ tháng</label>
              <input type="month" value={appliedFrom} onChange={e => setAppliedFrom(e.target.value)} required
                className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Đến tháng <span className="text-outline/50 font-normal normal-case">(trống = không giới hạn)</span></label>
              <input type="month" value={appliedTo} onChange={e => setAppliedTo(e.target.value)}
                className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary justify-center">Huỷ</button>
            <button type="submit" disabled={saving} className="flex-1 btn-primary justify-center disabled:opacity-60">
              {saving ? 'Đang lưu...' : 'Thêm khuyến mại'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TuitionTab({ studentId, enrollments }: { studentId: string; enrollments: ClassEnrollment[] }) {
  const confirm = useConfirm()
  const showAlert = useAlert()
  const now = new Date()
  const [rows, setRows] = useState<TuitionRow[]>([])
  const [promos, setPromos] = useState<StudentPromotion[]>([])
  const [loading, setLoading] = useState(true)
  const [showPromoModal, setShowPromoModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(now.getFullYear())
  const [creatingKey, setCreatingKey] = useState<string | null>(null)
  const [sendingZnsId, setSendingZnsId] = useState<string | null>(null)
  const [payingRow, setPayingRow] = useState<TuitionRow | null>(null)

  const sendZnsNotice = async (recordId: string) => {
    const ok = await confirm({
      title: 'Gửi thông báo Zalo',
      message: 'Gửi thông báo học phí (ZNS) cho phụ huynh học viên này?',
      confirmLabel: 'Gửi',
    })
    if (!ok) return

    setSendingZnsId(recordId)
    try {
      const r = await api.post('/zns/tuition-notice', { tuitionRecordId: recordId, useCase: 'A' })
      const data = r.data as { success: boolean; error?: string; recipientSource?: string; recipientName?: string }
      if (data.success) {
        const fallbackNote = data.recipientSource === 'fallback'
          ? `\n(Đã dùng SĐT của ${data.recipientName ?? 'phụ huynh phụ'} vì PH chính chưa có SĐT)`
          : ''
        await showAlert({ title: '✅ Đã gửi', message: `Thông báo đã gửi thành công.${fallbackNote}` })
      } else {
        await showAlert({ title: 'Gửi thất bại', message: data.error || 'Không xác định' })
      }
    } catch (e: any) {
      await showAlert({
        title: 'Lỗi',
        message: e?.response?.data?.message || 'Không gọi được API gửi ZNS',
      })
    } finally {
      setSendingZnsId(null)
    }
  }

  const createRecord = async (row: TuitionRow) => {
    const isRecalc = !!row.tuitionRecord
    if (isRecalc) {
      const ok = await confirm({
        title: 'Tính lại phiếu',
        message:
          `Tính lại phiếu cho ${row.className} T${row.month}/${row.year}?\n\n` +
          `Số tiền sẽ cập nhật theo lịch hiện tại. Các giao dịch đã thanh toán được giữ nguyên.`,
        confirmLabel: 'Tính lại',
      })
      if (!ok) return
    }
    const key = `${row.monthKey}__${row.classId}`
    setCreatingKey(key)
    try {
      await api.post('/tuition/calculate', {
        studentId, classId: row.classId, month: row.month, year: row.year,
      })
      load()
    } catch (e: any) {
      await showAlert({
        title: 'Lỗi',
        message: e?.response?.data?.message || (isRecalc ? 'Tính lại phiếu thất bại' : 'Tạo phiếu thất bại'),
      })
    } finally {
      setCreatingKey(null)
    }
  }

  const loadRows = () => api.get(`/students/${studentId}/tuition-summary`)
    .then(r => setRows(r.data ?? [])).catch(() => setRows([]))

  const loadPromos = () => api.get(`/tuition/student-promotions?studentId=${studentId}`)
    .then(r => setPromos(r.data ?? [])).catch(() => setPromos([]))

  const load = () => {
    setLoading(true)
    Promise.all([loadRows(), loadPromos()]).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [studentId])

  const deletePromo = async (id: string) => {
    const ok = await confirm({
      title: 'Xoá khuyến mại',
      message: 'Bạn có chắc muốn xoá khuyến mại này?',
      confirmLabel: 'Xoá',
      danger: true,
    })
    if (!ok) return
    await api.delete(`/tuition/student-promotions/${id}`)
    load()
  }

  const filteredRows = rows.filter(r => r.month === filterMonth && r.year === filterYear)
  const totalFee = filteredRows.reduce((s, r) => s + r.finalAmount, 0)
  const totalDiscount = filteredRows.reduce((s, r) => s + r.discountAmount, 0)

  // Tổng hợp trạng thái học phí trên TẤT CẢ tháng (không lọc theo tháng đang xem)
  const billedRows = rows.filter(r => r.tuitionRecord !== null)
  const totalRemainingAll = billedRows.reduce((s, r) => s + (r.tuitionRecord?.remainingAmount ?? 0), 0)
  const hasOutstanding = totalRemainingAll > 0
  const activeEnrollments = enrollments.filter(e => e.status === 'ACTIVE')
  const availableYears = [...new Set(rows.map(r => r.year))].sort((a, b) => b - a)

  const promoTypeBadge = (type: string) => {
    if (type === 'PERCENTAGE') return <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">%</span>
    if (type === 'FIXED_AMOUNT') return <span className="text-[10px] bg-secondary/10 text-secondary px-2 py-0.5 rounded-full font-bold">đ</span>
    return null
  }

  return (
    <div className="space-y-4">
      {billedRows.length > 0 && (
        <div className={`rounded-xl p-5 shadow-sm border ${hasOutstanding
          ? 'bg-rose-50 border-rose-200'
          : 'bg-emerald-50 border-emerald-200'}`}>
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${hasOutstanding
              ? 'bg-rose-100 text-rose-600'
              : 'bg-emerald-100 text-emerald-600'}`}>
              <span className="material-symbols-outlined text-[28px]">
                {hasOutstanding ? 'error' : 'verified'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase font-bold tracking-wider text-outline mb-0.5">Trạng thái học phí</p>
              <p className={`text-lg font-bold ${hasOutstanding ? 'text-rose-700' : 'text-emerald-700'}`}>
                {hasOutstanding ? 'Còn nợ học phí' : 'Đã thanh toán hết'}
              </p>
              {hasOutstanding && (
                <p className="text-sm text-rose-600 mt-0.5">
                  Tổng tiền còn nợ: <span className="font-extrabold">{fmtMoney(totalRemainingAll)}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm text-center">
            <p className="text-[10px] uppercase font-bold text-outline tracking-wider mb-1">Tổng học phí</p>
            <p className="text-xl font-bold text-on-surface">{fmtMoney(totalFee)}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm text-center">
            <p className="text-[10px] uppercase font-bold text-outline tracking-wider mb-1">Tổng buổi</p>
            <p className="text-xl font-bold text-primary">{filteredRows.reduce((s, r) => s + r.totalSessions, 0)}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm text-center">
            <p className="text-[10px] uppercase font-bold text-outline tracking-wider mb-1">Tổng giảm giá</p>
            <p className="text-xl font-bold text-secondary">{fmtMoney(totalDiscount)}</p>
          </div>
        </div>
      )}

      {/* Promotions section */}
      <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-headline text-base font-bold text-on-surface">Khuyến mại đang áp dụng</h3>
          <button onClick={() => setShowPromoModal(true)} className="btn-primary text-xs py-1.5 px-3">
            <span className="material-symbols-outlined text-sm">add</span>
            Thêm khuyến mại
          </button>
        </div>
        {promos.length === 0 ? (
          <p className="text-sm text-outline py-2">Chưa có khuyến mại nào</p>
        ) : (
          <div className="space-y-2">
            {promos.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 p-3 bg-surface-container-low rounded-xl">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {promoTypeBadge(p.promotionType)}
                  <span className="text-sm font-semibold text-on-surface">
                    {p.promotionType === 'PERCENTAGE' ? `${p.promotionValue}%` : fmtMoney(p.promotionValue)}
                  </span>
                  <span className="text-sm text-outline">·</span>
                  <span className="text-sm text-on-surface-variant truncate">{p.className}</span>
                  <span className="text-xs text-outline whitespace-nowrap">
                    {fmt(p.appliedFrom)} → {p.appliedTo ? fmt(p.appliedTo) : 'Không giới hạn'}
                  </span>
                </div>
                <button onClick={() => deletePromo(p.id)}
                  className="p-1.5 hover:bg-error/10 text-outline hover:text-error rounded-lg transition-colors flex-shrink-0">
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-headline text-lg font-bold text-on-surface">Học phí cá nhân</h3>
          <div className="flex items-center gap-2">
            <select
              value={filterMonth}
              onChange={e => setFilterMonth(Number(e.target.value))}
              className="bg-surface-container-low border border-outline-variant/20 rounded-xl py-1.5 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>
              ))}
            </select>
            <select
              value={filterYear}
              onChange={e => setFilterYear(Number(e.target.value))}
              className="bg-surface-container-low border border-outline-variant/20 rounded-xl py-1.5 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {(availableYears.length > 0 ? availableYears : [now.getFullYear()]).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8">
            <span className="material-symbols-outlined text-4xl text-outline/40 block mb-2">receipt_long</span>
            <p className="text-sm text-outline">Chưa có dữ liệu lịch học</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="text-center py-8">
            <span className="material-symbols-outlined text-4xl text-outline/40 block mb-2">event_busy</span>
            <p className="text-sm text-outline">Không có dữ liệu tháng {filterMonth}/{filterYear}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-outline-variant/10 text-[10px] uppercase font-bold text-outline tracking-widest">
                  <th className="pb-3 pr-6">Lớp học</th>
                  <th className="pb-3 pr-6 text-center">Số buổi học</th>
                  <th className="pb-3 pr-6 text-right">Học phí/buổi</th>
                  <th className="pb-3 pr-6 text-right">Khuyến mại & Giảm giá</th>
                  <th className="pb-3 pr-6 text-right">Thành tiền</th>
                  <th className="pb-3 text-center">Phiếu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/5">
                {filteredRows.map(r => {
                  const key = `${r.monthKey}__${r.classId}`
                  const busy = creatingKey === key
                  return (
                    <tr key={key} className="hover:bg-surface-container-low/30 transition-colors">
                      <td className="py-3 pr-6 text-sm">{r.className}</td>
                      <td className="py-3 pr-6 text-sm text-center font-semibold">{r.totalSessions}</td>
                      <td className="py-3 pr-6 text-sm text-right">{r.ratePerSession ? fmtMoney(r.ratePerSession) : '—'}</td>
                      <td className="py-3 pr-6 text-sm text-right">
                        {r.discountAmount > 0
                          ? <span className="text-secondary font-medium">-{fmtMoney(r.discountAmount)}</span>
                          : <span className="text-outline">—</span>}
                      </td>
                      <td className="py-3 pr-6 text-sm font-bold text-right">{fmtMoney(r.finalAmount)}</td>
                      <td className="py-3 text-center">
                        {r.tuitionRecord ? (
                          <div className="flex items-center justify-center gap-2">
                            {r.tuitionRecord.remainingAmount === 0 || r.tuitionRecord.status === 'PAID' ? (
                              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 text-[11px] font-bold inline-flex items-center gap-1">
                                <span className="material-symbols-outlined text-[13px]">check_circle</span>
                                Đã đóng đủ
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 text-[11px] font-bold">
                                Còn nợ ({fmtMoney(r.tuitionRecord.remainingAmount)})
                              </span>
                            )}
                            <button
                              onClick={() => createRecord(r)}
                              disabled={busy}
                              className="px-2 py-0.5 rounded-md text-[11px] font-bold text-secondary hover:bg-secondary/10 transition-all disabled:opacity-40"
                              title="Tính lại học phí dựa trên lịch học hiện tại (giữ nguyên các giao dịch đã thanh toán)"
                            >
                              {busy ? '...' : 'Tính lại'}
                            </button>
                            <button
                              onClick={() => sendZnsNotice(r.tuitionRecord!.id)}
                              disabled={sendingZnsId === r.tuitionRecord.id}
                              className="p-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-all disabled:opacity-40"
                              title="Gửi thông báo Zalo cho phụ huynh"
                            >
                              <span className="material-symbols-outlined text-[18px]">
                                {sendingZnsId === r.tuitionRecord.id ? 'hourglass_top' : 'campaign'}
                              </span>
                            </button>
                            {r.tuitionRecord.remainingAmount > 0 && (
                              <button
                                onClick={() => setPayingRow(r)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 text-[11px] font-bold hover:bg-emerald-500/20 transition-all"
                                title="Xác nhận đã thanh toán"
                              >
                                Xác nhận thanh toán
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => createRecord(r)}
                            disabled={busy}
                            className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[11px] font-bold hover:bg-primary/20 transition-all disabled:opacity-40"
                          >
                            {busy ? '...' : 'Tạo phiếu'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-outline-variant/20">
                  <td colSpan={4} className="pt-3 text-sm font-bold text-outline uppercase tracking-wider">Tổng cộng</td>
                  <td className="pt-3 text-sm font-bold text-right text-primary">{fmtMoney(totalFee)}</td>
                  <td className="pt-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {showPromoModal && (
        <PromoModal
          studentId={studentId}
          enrollments={activeEnrollments}
          hasPrivate={rows.some(r => r.classId === 'private')}
          onClose={() => setShowPromoModal(false)}
          onSaved={() => { setShowPromoModal(false); load() }}
        />
      )}
      {payingRow?.tuitionRecord && (
        <PaymentModal
          record={{
            id: payingRow.tuitionRecord.id,
            studentId,
            studentName: '',
            classId: payingRow.classId,
            className: payingRow.className,
            billingMonth: payingRow.month,
            billingYear: payingRow.year,
            totalSessions: payingRow.totalSessions,
            attendedSessions: payingRow.totalSessions,
            ratePerSession: payingRow.ratePerSession,
            baseAmount: payingRow.baseAmount,
            discountAmount: payingRow.discountAmount,
            finalAmount: payingRow.tuitionRecord.finalAmount,
            paidAmount: payingRow.tuitionRecord.paidAmount,
            status: payingRow.tuitionRecord.status === 'OVERDUE' ? 'PENDING' : payingRow.tuitionRecord.status,
            createdAt: '',
            updatedAt: '',
          }}
          onClose={() => setPayingRow(null)}
          onSaved={() => { setPayingRow(null); loadRows() }}
        />
      )}
    </div>
  )
}

// ─── Tab: Schedule ───────────────────────────────────────────────────────────

const DAY_NAMES: Record<string, string> = {
  '1': 'Thứ 2', '2': 'Thứ 3', '3': 'Thứ 4', '4': 'Thứ 5',
  '5': 'Thứ 6', '6': 'Thứ 7', '0': 'Chủ nhật',
}
const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] // index theo JS getDay() (0=CN)
const WEEKDAY_LABELS_MON_FIRST = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] // hiển thị tuần bắt đầu T2

function dayOfWeek(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return DAY_NAMES[String(d.getDay())] ?? '—'
}

// ─── Private Schedule Modal ────────────────────────────────────────
export interface PrivateScheduleModalProps {
  studentId: string
  studentName: string
  onClose: () => void
  onSaved: () => void
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function PrivateScheduleModal({ studentId, studentName, onClose, onSaved }: PrivateScheduleModalProps) {
  const today = new Date()
  const [mode, setMode] = React.useState<'manual' | 'repeat'>('manual')
  // Manual mode
  const [calYear, setCalYear] = React.useState(today.getFullYear())
  const [calMonth, setCalMonth] = React.useState(today.getMonth()) // 0-based
  const [selectedDates, setSelectedDates] = React.useState<Set<string>>(new Set())
  const [existingDates, setExistingDates] = React.useState<Set<string>>(new Set())

  // Fetch all existing private sessions once on mount
  React.useEffect(() => {
    api.get(`/students/${studentId}/private-schedule`)
      .then(r => {
        const list: any[] = r.data ?? []
        const dates = new Set<string>(list.map((s: any) => s.sessionDate as string))
        setExistingDates(dates)
        // Gợi ý học phí từ buổi học riêng gần nhất (nếu có)
        const latest = [...list]
          .filter(s => s.ratePerSession)
          .sort((a, b) => (b.sessionDate ?? '').localeCompare(a.sessionDate ?? ''))[0]
        if (latest?.ratePerSession) setRate(String(latest.ratePerSession))
      })
      .catch(() => {})
  }, [studentId])
  // Repeat mode
  const [weekdays, setWeekdays] = React.useState<Set<number>>(new Set())
  const [fromMonth, setFromMonth] = React.useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
  const [toMonth, setToMonth] = React.useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
  // Common
  const [startTime, setStartTime] = React.useState('')
  const [endTime, setEndTime] = React.useState('')
  const [rate, setRate] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')

  const toggleDate = (d: string) => setSelectedDates(prev => {
    const s = new Set(prev); s.has(d) ? s.delete(d) : s.add(d); return s
  })

  const toggleWeekday = (d: number) => setWeekdays(prev => {
    const s = new Set(prev); s.has(d) ? s.delete(d) : s.add(d); return s
  })

  // Generate dates for repeat mode
  const repeatDates = React.useMemo(() => {
    if (mode !== 'repeat' || weekdays.size === 0 || !fromMonth || !toMonth) return []
    const [fy, fm] = fromMonth.split('-').map(Number)
    const [ty, tm] = toMonth.split('-').map(Number)
    const start = new Date(fy, fm - 1, 1)
    const end = new Date(ty, tm, 0) // last day of toMonth
    const dates: string[] = []
    const cur = new Date(start)
    while (cur <= end) {
      if (weekdays.has(cur.getDay())) {
        dates.push(localDateKey(cur))
      }
      cur.setDate(cur.getDate() + 1)
    }
    return dates
  }, [mode, weekdays, fromMonth, toMonth])

  const finalDates = mode === 'manual' ? [...selectedDates].sort() : repeatDates

  const prevMonth = () => { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) } else setCalMonth(m => m - 1) }
  const nextMonth = () => { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) } else setCalMonth(m => m + 1) }

  // Build calendar grid (tuần bắt đầu T2, kết thúc CN)
  const calDays = React.useMemo(() => {
    // Map JS getDay() (0=CN..6=T7) → Monday-first index (0=T2..6=CN)
    const first = (new Date(calYear, calMonth, 1).getDay() + 6) % 7
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
    const cells: (number | null)[] = Array(first).fill(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    return cells
  }, [calYear, calMonth])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (finalDates.length === 0) { setError('Chọn ít nhất 1 ngày học'); return }
    if (!rate) { setError('Nhập học phí mỗi buổi'); return }
    setSaving(true); setError('')
    try {
      await api.post(`/students/${studentId}/private-schedule`, {
        sessions: finalDates.map(d => ({
          sessionDate: d,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          ratePerSession: Number(rate),
        }))
      })
      onSaved()
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra')
    } finally { setSaving(false) }
  }

  const monthNames = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[3px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="private-schedule-title" className="relative z-10 flex max-h-[92dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary">
              <span className="material-symbols-outlined text-[22px]">edit_calendar</span>
            </div>
            <div className="min-w-0">
              <h3 id="private-schedule-title" className="font-headline text-lg font-bold leading-6 text-on-surface">Thêm lịch học riêng</h3>
              <p className="mt-0.5 truncate text-sm text-slate-500" title={studentName}>Học viên: <span className="font-medium text-slate-700">{studentName}</span></p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng cửa sổ thêm lịch học" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-7">
          {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

          {/* Mode toggle */}
          <div>
            <p className="mb-2 text-sm font-semibold text-on-surface">Cách chọn ngày học</p>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              {[{ v: 'manual', icon: 'calendar_month', label: 'Chọn thủ công' }, { v: 'repeat', icon: 'repeat', label: 'Lặp lại tự động' }].map(opt => (
                <button key={opt.v} type="button" onClick={() => setMode(opt.v as 'manual' | 'repeat')}
                  aria-pressed={mode === opt.v}
                  className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-sm ${mode === opt.v ? 'bg-white text-primary shadow-sm' : 'text-slate-600 hover:text-on-surface'}`}>
                  <span className="material-symbols-outlined text-[18px]">{opt.icon}</span>{opt.label}
                </button>
              ))}
            </div>
          </div>
          {mode === 'manual' ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-on-surface">Chọn các ngày học</h4>
                <span className="text-xs text-slate-500">{selectedDates.size} ngày đã chọn</span>
              </div>
              {/* Calendar */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
                <div className="mb-3 flex items-center justify-between">
                  <button type="button" onClick={prevMonth} aria-label="Tháng trước" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className="material-symbols-outlined text-[20px]">chevron_left</span></button>
                  <span className="text-sm font-semibold text-on-surface">{monthNames[calMonth]}, {calYear}</span>
                  <button type="button" onClick={nextMonth} aria-label="Tháng sau" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className="material-symbols-outlined text-[20px]">chevron_right</span></button>
                </div>
                <div className="mb-1 grid grid-cols-7 gap-1">
                  {WEEKDAY_LABELS_MON_FIRST.map(d => <div key={d} className="py-1 text-center text-xs font-medium text-slate-500">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-x-1 gap-y-1.5">
                  {calDays.map((day, i) => {
                    if (!day) return <div key={i} />
                    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                    const isSelected = selectedDates.has(dateStr)
                    const isExisting = existingDates.has(dateStr)
                    const isToday = dateStr === localDateKey(today)
                    return (
                      <button key={i} type="button" onClick={() => toggleDate(dateStr)}
                        title={isExisting ? 'Đã có lịch học' : undefined}
                        aria-label={`${day} ${monthNames[calMonth]} ${calYear}${isExisting ? ', đã có lịch' : ''}`}
                        aria-pressed={isSelected}
                        className={`relative mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          isSelected ? 'bg-primary text-on-primary' :
                          isExisting ? 'bg-violet-100 text-violet-700 ring-1 ring-violet-300' :
                          isToday ? 'border border-primary text-primary' :
                          'text-slate-700 hover:bg-slate-100'
                        }`}>
                        {day}
                        {isExisting && !isSelected && (
                          <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-violet-600" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                {existingDates.size > 0 && <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-violet-100 ring-1 ring-violet-300" /> Đã có lịch</span>}
                <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-primary" /> Đang chọn</span>
              </div>
              {selectedDates.size > 0 && (
                <div className="mt-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                  {[...selectedDates].sort().map(d => (
                    <span key={d} className="flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-primary">
                      {fmt(d)}
                      <button type="button" onClick={() => toggleDate(d)} aria-label={`Bỏ chọn ngày ${fmt(d)}`} className="ml-0.5 flex h-5 w-5 items-center justify-center rounded hover:bg-blue-100 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 rounded-xl border border-slate-200 p-4 sm:p-5">
              <div>
                <p className="mb-2 text-sm font-semibold text-on-surface">Chọn thứ trong tuần</p>
                <div className="flex gap-2 flex-wrap">
                  {[1,2,3,4,5,6,0].map(wd => (
                    <button key={wd} type="button" onClick={() => toggleWeekday(wd)}
                      aria-pressed={weekdays.has(wd)}
                      className={`flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${weekdays.has(wd) ? 'border-primary bg-primary text-white' : 'border-slate-200 text-slate-600 hover:border-blue-300 hover:text-primary'}`}>
                      {WEEKDAY_LABELS[wd]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="private-from-month" className="mb-1.5 block text-sm font-medium text-slate-700">Từ tháng</label>
                  <input id="private-from-month" type="month" value={fromMonth} onChange={e => setFromMonth(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div>
                  <label htmlFor="private-to-month" className="mb-1.5 block text-sm font-medium text-slate-700">Đến tháng</label>
                  <input id="private-to-month" type="month" value={toMonth} onChange={e => setToMonth(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>
              {repeatDates.length > 0 && (
                <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-primary">Dự kiến tạo {repeatDates.length} buổi học</p>
              )}
            </div>
          )}

          <div className="border-t border-slate-100 pt-5">
            <h4 className="mb-3 text-sm font-semibold text-on-surface">Thời gian và học phí</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="private-start-time" className="mb-1.5 block text-sm font-medium text-slate-700">Giờ bắt đầu</label>
                <input id="private-start-time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label htmlFor="private-end-time" className="mb-1.5 block text-sm font-medium text-slate-700">Giờ kết thúc</label>
                <input id="private-end-time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="private-session-rate" className="mb-1.5 block text-sm font-medium text-slate-700">Học phí mỗi buổi (đ)</label>
              <input id="private-session-rate" type="number" value={rate} onChange={e => setRate(e.target.value)} required min={0}
                placeholder="Ví dụ: 200000"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-7">
            <span className="hidden text-sm text-slate-500 sm:block">{finalDates.length} buổi học được chọn</span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Hủy</button>
              <button type="submit" disabled={saving || finalDates.length === 0}
                className="inline-flex min-w-[145px] items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? 'Đang lưu...' : `Lưu ${finalDates.length} buổi học`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Private Tab ───────────────────────────────────────────────────
function PrivateTab({ studentId, studentName }: { studentId: string; studentName: string }) {
  const confirm = useConfirm()
  const today = new Date()
  const [month, setMonth] = React.useState(today.getMonth() + 1)
  const [year, setYear] = React.useState(today.getFullYear())
  const [sessions, setSessions] = React.useState<PrivateSession[]>([])
  const [loading, setLoading] = React.useState(false)
  const [showModal, setShowModal] = React.useState(false)

  const load = () => {
    setLoading(true)
    api.get(`/students/${studentId}/private-schedule`, { params: { month, year } })
      .then(r => setSessions(r.data ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }

  React.useEffect(() => { load() }, [studentId, month, year])

  const deleteSession = async (id: string) => {
    const ok = await confirm({
      title: 'Xoá buổi học riêng',
      message: 'Bạn có chắc muốn xoá buổi học này?',
      confirmLabel: 'Xoá',
      danger: true,
    })
    if (!ok) return
    await api.delete(`/students/${studentId}/private-schedule/${id}`)
    load()
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const years  = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]
  const totalFee = sessions.filter(s => s.status !== 'CANCELLED').reduce((sum, s) => sum + (s.ratePerSession || 0), 0)

  const statusCfg: Record<string, { label: string; cls: string }> = {
    SCHEDULED: { label: 'Sắp học',  cls: 'bg-primary/10 text-primary' },
    COMPLETED: { label: 'Đã học',   cls: 'bg-secondary-container/40 text-secondary' },
    CANCELLED: { label: 'Đã huỷ',  cls: 'bg-error-container/20 text-error' },
  }
  const resolvePrivateStatus = (s: any) => {
    if (s.status === 'CANCELLED') return 'CANCELLED'
    const end = s.endTime ?? s.startTime
    const dt = end ? new Date(`${s.sessionDate}T${end}`) : new Date(`${s.sessionDate}T23:59`)
    return dt <= new Date() ? 'COMPLETED' : 'SCHEDULED'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="input py-2 w-32">
            {months.map(m => <option key={m} value={m}>Tháng {m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="input py-2 w-28">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-4">
          {sessions.length > 0 && (
            <span className="text-sm font-bold text-on-surface">
              {sessions.length} buổi · <span className="text-primary">{fmtMoney(totalFee)}</span>
            </span>
          )}
          <button onClick={() => setShowModal(true)} className="btn-primary text-sm">
            <span className="material-symbols-outlined text-base">add</span>
            Thêm lịch học riêng
          </button>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-5xl text-outline/30 block mb-3">person</span>
            <p className="text-sm text-outline">Chưa có lịch học riêng tháng {month}/{year}</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-outline-variant/10 bg-surface-container-low/50">
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest w-24">Thứ</th>
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest w-36">Ngày học</th>
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest">Loại</th>
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest">Giáo viên</th>
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest text-right">Học phí buổi</th>
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest">Trạng thái</th>
                <th className="px-6 py-4 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5">
              {sessions.map(s => {
                const cfg = statusCfg[resolvePrivateStatus(s)] ?? { label: s.status, cls: 'bg-surface-container-high text-outline' }
                return (
                  <tr key={s.id} className="hover:bg-surface-container-low/30 transition-colors group">
                    <td className="px-6 py-4">
                      <span className="text-sm font-semibold text-on-surface-variant">{dayOfWeek(s.sessionDate)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-bold text-on-surface">{fmt(s.sessionDate)}</p>
                        {s.startTime && s.endTime && (
                          <p className="text-xs text-outline mt-0.5">{s.startTime} – {s.endTime}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-on-surface">Học riêng</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-on-surface-variant">{(s as any).teacherName || '—'}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-bold text-on-surface">
                        {s.ratePerSession ? fmtMoney(s.ratePerSession) : '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${cfg.cls}`}>{cfg.label}</span>
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={() => deleteSession(s.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-error/10 text-outline hover:text-error rounded-lg transition-all">
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {totalFee > 0 && (
              <tfoot>
                <tr className="border-t border-outline-variant/10 bg-surface-container-low/30">
                  <td colSpan={4} className="px-6 py-3 text-xs text-outline">* Học phí tính cho các buổi chưa huỷ</td>
                  <td className="px-6 py-3 text-right"><span className="text-sm font-extrabold text-primary">{fmtMoney(totalFee)}</span></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {showModal && (
        <PrivateScheduleModal
          studentId={studentId}
          studentName={studentName}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}
    </div>
  )
}

function ScheduleTab({ studentId }: { studentId: string }) {
  const today = new Date()
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [year, setYear]   = useState(today.getFullYear())
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get(`/students/${studentId}/schedule`, { params: { month, year } })
      .then(r => setSessions(r.data ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [studentId, month, year])

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const years  = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]

  const totalFee = sessions
    .filter(s => s.status !== 'CANCELLED')
    .reduce((sum: number, s: any) => sum + (s.ratePerSession || 0), 0)

  const sessionStatusCfg: Record<string, { label: string; cls: string }> = {
    SCHEDULED:  { label: 'Sắp học',   cls: 'bg-primary/10 text-primary' },
    COMPLETED:  { label: 'Đã học',    cls: 'bg-secondary-container/40 text-secondary' },
    CANCELLED:  { label: 'Đã huỷ',   cls: 'bg-error-container/20 text-error' },
    MAKEUP:     { label: 'Học bù',    cls: 'bg-tertiary-container/40 text-on-tertiary-container' },
  }
  const resolveSessionStatus = (s: any) => {
    if (s.status === 'CANCELLED') return 'CANCELLED'
    if (s.status === 'MAKEUP') return 'MAKEUP'
    const end = s.endTime ?? s.startTime
    const dt = end ? new Date(`${s.sessionDate}T${end}`) : new Date(`${s.sessionDate}T23:59`)
    return dt <= new Date() ? 'COMPLETED' : 'SCHEDULED'
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="input py-2 w-32">
            {months.map(m => <option key={m} value={m}>Tháng {m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="input py-2 w-28">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {sessions.length > 0 && (
          <div className="flex gap-4 text-sm">
            <span className="text-outline">{sessions.length} buổi</span>
            <span className="font-bold text-on-surface">
              Dự kiến: <span className="text-primary">{fmtMoney(totalFee)}</span>
            </span>
          </div>
        )}
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-5xl text-outline/30 block mb-3">calendar_month</span>
            <p className="text-sm text-outline">Không có lịch học tháng {month}/{year}</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-outline-variant/10 bg-surface-container-low/50">
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest w-24">Thứ</th>
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest w-36">Ngày học</th>
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest">Lớp học</th>
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest">Giáo viên</th>
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest text-right">Học phí buổi</th>
                <th className="px-6 py-4 text-[10px] uppercase font-bold text-outline tracking-widest">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5">
              {sessions.map((s: any) => {
                const cfg = sessionStatusCfg[resolveSessionStatus(s)] ?? { label: s.status, cls: 'bg-surface-container-high text-outline' }
                const isCancelled = s.status === 'CANCELLED'
                return (
                  <tr key={s.id} className={`hover:bg-surface-container-low/30 transition-colors ${isCancelled ? 'opacity-50' : ''}`}>
                    <td className="px-6 py-4">
                      <span className="text-sm font-semibold text-on-surface-variant">{dayOfWeek(s.sessionDate)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-bold text-on-surface">{fmt(s.sessionDate)}</p>
                        {s.startTime && s.endTime && (
                          <p className="text-xs text-outline mt-0.5">{s.startTime} – {s.endTime}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-on-surface">{s.className}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                          {s.teacherName?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <span className="text-sm text-on-surface-variant">{(s as any).teacherName || '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`text-sm font-bold ${isCancelled ? 'line-through text-outline' : 'text-on-surface'}`}>
                        {s.ratePerSession ? fmtMoney(s.ratePerSession) : '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${cfg.cls}`}>
                        {cfg.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {totalFee > 0 && (
              <tfoot>
                <tr className="border-t border-outline-variant/10 bg-surface-container-low/30">
                  <td colSpan={4} className="px-6 py-3 text-xs text-outline">
                    * Học phí tính cho các buổi chưa huỷ
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm font-extrabold text-primary">{fmtMoney(totalFee)}</span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  )
}

// ─── More Actions Menu ───────────────────────────────────────────────────────

function MoreMenu({ student, onUpdated }: { student: Student & { id: string }; onUpdated: (s: Student) => void }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const changeStatus = (status: 'ACTIVE' | 'INACTIVE' | 'RESERVED') => {
    const labels = { ACTIVE: 'Đang học', INACTIVE: 'Đã nghỉ', RESERVED: 'Bảo lưu' }
    setOpen(false)
    setConfirm({
      message: `Chuyển trạng thái học viên sang "${labels[status]}"?`,
      onConfirm: async () => {
        setConfirm(null)
        const res = await api.put(`/students/${student.id}`, { status })
        onUpdated({ ...student, status })
      },
    })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="p-2.5 bg-surface-container-lowest text-on-surface-variant border border-outline-variant/15 rounded-xl hover:bg-surface-container-low transition-all"
      >
        <span className="material-symbols-outlined">more_vert</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/10 py-2 z-20">
          {student.status !== 'ACTIVE' && (
            <button onClick={() => changeStatus('ACTIVE')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-container-low flex items-center gap-2 text-secondary">
              <span className="material-symbols-outlined text-base">check_circle</span>Chuyển sang Đang học
            </button>
          )}
          {student.status !== 'RESERVED' && (
            <button onClick={() => changeStatus('RESERVED')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-container-low flex items-center gap-2 text-outline">
              <span className="material-symbols-outlined text-base">pause_circle</span>Bảo lưu
            </button>
          )}
          {student.status !== 'INACTIVE' && (
            <button onClick={() => changeStatus('INACTIVE')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-container-low flex items-center gap-2 text-error">
              <span className="material-symbols-outlined text-base">cancel</span>Cho nghỉ học
            </button>
          )}
        </div>
      )}
      {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
    </div>
  )
}

// ─── Share Link Box ──────────────────────────────────────────────────────────

function buildZaloUrl(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const intl = digits.startsWith('0') ? '84' + digits.slice(1) : digits
  return `https://zalo.me/${intl}`
}

function ShareLinkBox({ studentId }: { studentId: string }) {
  const showAlert = useAlert()
  const [copied, setCopied] = useState(false)
  const url = buildParentUrl(studentId)

  const copy = async () => {
    window.open(url, '_blank', 'noopener,noreferrer')
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      await showAlert({ title: 'Không sao chép được', message: 'Trình duyệt không cho phép sao chép. Hãy chọn và copy thủ công.' })
    }
  }

  return (
    <section className="bg-primary-container/15 border border-primary/20 rounded-xl p-4 flex items-center gap-3 flex-wrap">
      <span className="material-symbols-outlined text-primary text-2xl flex-shrink-0">share</span>
      <div className="flex-1 min-w-[240px]">
        <p className="text-xs uppercase font-bold tracking-wider text-primary mb-1">Link chia sẻ phụ huynh</p>
        <p className="text-sm text-on-surface font-mono break-all">{url}</p>
      </div>
      <button
        onClick={copy}
        className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/90 transition-colors flex-shrink-0"
      >
        <span className="material-symbols-outlined text-base">{copied ? 'check' : 'content_copy'}</span>
        {copied ? 'Đã sao chép' : 'Sao chép link'}
      </button>
    </section>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function StudentProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [student, setStudent] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const { canSeeFinance, canManageStudents } = useAuth()
  const [activeTab, setActiveTab] = useState<'info' | 'schedule' | 'private' | 'tuition' | 'reviews' | 'scores'>('info')
  const [editModal, setEditModal] = useState(false)

  const load = () => {
    if (!id) return
    setLoading(true)
    api.get(`/students/${id}`)
      .then(r => setStudent(r.data))
      .catch(() => setStudent(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  if (loading) return (
    <div className="flex-1 ml-64 flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
    </div>
  )

  if (!student) return (
    <div>
      <TopBar title="Hồ sơ học viên" />
      <div className="p-8 text-center">
        <span className="material-symbols-outlined text-5xl text-outline/40 block mb-3">person_off</span>
        <p className="text-outline">Không tìm thấy học viên</p>
        <button onClick={() => navigate('/students')} className="mt-4 btn-primary">
          <span className="material-symbols-outlined text-lg">arrow_back</span>Quay lại
        </button>
      </div>
    </div>
  )

  const enrollments: ClassEnrollment[] = student.enrollments ?? []
  const parents: (Parent & { id: string })[] = student.parents ?? []

  const statusConfig: Record<string, { label: string; cls: string }> = {
    ACTIVE: { label: 'Đang học', cls: 'bg-secondary text-on-secondary' },
    INACTIVE: { label: 'Đã nghỉ', cls: 'bg-error text-on-error' },
    RESERVED: { label: 'Bảo lưu', cls: 'bg-surface-container-high text-outline' },
  }
  const statusInfo = statusConfig[student.status] ?? statusConfig.INACTIVE

  return (
    <div>
      <TopBar title="Hồ sơ học viên" />
      <div className="p-8 space-y-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-outline">
          <button onClick={() => navigate('/students')} className="hover:text-primary transition-colors flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">arrow_back</span>Học viên
          </button>
          <span className="material-symbols-outlined text-sm">chevron_right</span>
          <span className="text-on-surface font-medium">{student.fullName}</span>
        </div>

        {/* Header */}
        <section className="flex flex-col md:flex-row gap-8 items-start">
          <div className="relative flex-shrink-0">
            <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-primary to-primary-container p-1 shadow-lg shadow-primary/20">
              <div className="w-full h-full rounded-[14px] bg-surface-container-highest flex items-center justify-center">
                <span className="text-4xl font-black text-primary">
                  {student.fullName.split(' ').slice(-1)[0]?.[0]?.toUpperCase() ?? '?'}
                </span>
              </div>
            </div>
            <div className={`absolute -bottom-2 -right-2 px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase shadow-sm ${statusInfo.cls}`}>
              {statusInfo.label}
            </div>
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <h2 className="text-4xl font-headline font-extrabold text-on-surface tracking-tight">{student.fullName}</h2>
              <p className="text-on-surface-variant font-medium flex items-center gap-2 mt-1">
                <span className="material-symbols-outlined text-sm">id_card</span>
                {student.id.slice(0, 8).toUpperCase()}
                {student.enrollmentDate && (
                  <span className="text-outline text-xs">· Nhập học {fmt(student.enrollmentDate)}</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {student.gradeLevel && (
                <span className="px-4 py-1.5 bg-surface-container-highest text-on-primary-container rounded-lg text-sm font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg">school</span>Lớp {student.gradeLevel}
                </span>
              )}
              {enrollments.filter(e => e.status === 'ACTIVE').map(e => (
                <span key={e.id} className="px-4 py-1.5 bg-secondary-container/30 text-on-secondary-container rounded-lg text-sm font-semibold">
                  {e.className}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Share link cho phụ huynh */}
        <ShareLinkBox studentId={student.id} />

        {/* Tabs */}
        <div className="flex gap-1 border-b border-outline-variant/20">
          {(['info', 'schedule', 'private', 'tuition', 'reviews', 'scores'] as const).filter(t => t !== 'tuition' || canSeeFinance).map(tab => {
            const icons  = { info: 'person', schedule: 'calendar_month', private: 'person_apron', tuition: 'payments', reviews: 'rate_review', scores: 'grade' }
            const labels = { info: 'Thông tin', schedule: 'Lịch học', private: 'Học riêng', tuition: 'Học phí', reviews: 'Nhận xét', scores: 'Điểm KT' }
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-outline hover:text-on-surface'}`}
              >
                <span className="material-symbols-outlined text-base">{icons[tab]}</span>
                {labels[tab]}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'info' && (
          <InfoTab
            student={student}
            parents={parents}
            enrollments={enrollments}
            onRefresh={load}
            canManage={canManageStudents}
            onEdit={() => setEditModal(true)}
            onStatusChange={async (status) => {
              const labels = { ACTIVE: 'Đang học', INACTIVE: 'Đã nghỉ', RESERVED: 'Bảo lưu' }
              const ok = await confirm({
                title: 'Đổi trạng thái học viên',
                message: `Chuyển trạng thái học viên sang "${labels[status]}"?`,
                confirmLabel: 'Xác nhận',
                danger: status === 'INACTIVE',
              })
              if (!ok) return
              await api.put(`/students/${student.id}`, { status })
              setStudent((prev: any) => ({ ...prev, status }))
            }}
          />
        )}
        {activeTab === 'schedule' && (
          <ScheduleTab studentId={id!} />
        )}
        {activeTab === 'private' && (
          <PrivateTab studentId={id!} studentName={student?.fullName ?? ''} />
        )}
{activeTab === 'tuition' && (
          <TuitionTab studentId={id!} enrollments={enrollments} />
        )}
        {activeTab === 'reviews' && (
          <ReviewsTab studentId={id!} />
        )}
        {activeTab === 'scores' && (
          <ScoresTab studentId={id!} enrollments={enrollments} />
        )}
      </div>

      {/* Edit modal */}
      {editModal && (
        <EditStudentModal
          student={student}
          onClose={() => setEditModal(false)}
          onSaved={updated => { setStudent((prev: any) => ({ ...prev, ...updated })); setEditModal(false) }}
        />
      )}
    </div>
  )
}
