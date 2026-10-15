import React, { useEffect, useMemo, useState } from 'react'
import TopBar from '../components/TopBar'
import { useAlert, useConfirm } from '../components/ConfirmDialog'
import api from '../services/api'

interface Teacher {
  id: string
  fullName: string
  phone?: string
  email?: string
  address?: string
  dateOfBirth?: string
  idCard?: string
  bankAccount?: string
  bankName?: string
  salaryRatePerSession: number
  status: 'ACTIVE' | 'INACTIVE'
  notes?: string
  activeClassCount?: number
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(-2).map(w => w[0] ?? '').join('').toUpperCase()
  const colors = ['bg-blue-100 text-primary', 'bg-pink-100 text-tertiary', 'bg-green-100 text-secondary', 'bg-purple-100 text-tertiary']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center font-bold text-sm flex-shrink-0`}>
      {initials}
    </div>
  )
}

const fmtVND = (n: number) => new Intl.NumberFormat('vi-VN').format(Math.round(n))

export default function Teachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Teacher | null>(null)
  const alert = useAlert()
  const confirm = useConfirm()

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/teachers')
      setTeachers(Array.isArray(r.data) ? r.data : [])
    } catch {
      setTeachers([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return teachers
    return teachers.filter(t =>
      t.fullName.toLowerCase().includes(q) ||
      (t.phone ?? '').includes(q) ||
      (t.email ?? '').toLowerCase().includes(q)
    )
  }, [teachers, search])

  const totalActive = teachers.filter(t => t.status === 'ACTIVE').length
  const totalSalaryPerSession = teachers.reduce((s, t) => s + (t.salaryRatePerSession ?? 0), 0)

  const handleDeactivate = async (t: Teacher) => {
    const ok = await confirm({
      title: 'Vô hiệu hoá giáo viên?',
      message: `Vô hiệu hoá "${t.fullName}"? Giáo viên sẽ bị ẩn khỏi danh sách đang hoạt động.`,
      confirmLabel: 'Vô hiệu hoá',
      danger: true,
    })
    if (!ok) return
    try {
      await api.delete(`/teachers/${t.id}`)
      load()
    } catch (err: any) {
      await alert({ title: 'Không vô hiệu hoá được', message: err?.response?.data?.message ?? 'Vui lòng thử lại.' })
    }
  }

  return (
    <div>
      <TopBar title="Quản lý Giáo viên" />
      <div className="px-8 py-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Nhân sự</span>
            <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Quản lý Giáo viên</h2>
          </div>
          <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true) }}>
            <span className="material-symbols-outlined">person_add</span>
            Thêm giáo viên mới
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="w-10 h-10 rounded-lg bg-primary-container/20 flex items-center justify-center text-primary mb-4">
              <span className="material-symbols-outlined">group</span>
            </div>
            <p className="text-sm text-outline font-medium">Đang hoạt động</p>
            <p className="text-2xl font-black text-on-surface mt-1">{loading ? '—' : totalActive}</p>
          </div>
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 mb-4">
              <span className="material-symbols-outlined">school</span>
            </div>
            <p className="text-sm text-outline font-medium">Tổng số lớp đang dạy</p>
            <p className="text-2xl font-black text-on-surface mt-1">
              {loading ? '—' : teachers.reduce((s, t) => s + (t.activeClassCount ?? 0), 0)}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700 mb-4">
              <span className="material-symbols-outlined">payments</span>
            </div>
            <p className="text-sm text-outline font-medium">Tổng học phí giáo viên / buổi</p>
            <p className="text-2xl font-black text-on-surface mt-1">{loading ? '—' : `${fmtVND(totalSalaryPerSession)}đ`}</p>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-3xl overflow-hidden shadow-sm border border-outline-variant/10">
          <div className="p-4 border-b border-outline-variant/10">
            <div className="relative max-w-sm">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-base text-outline pointer-events-none">search</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm giáo viên..."
                className="w-full bg-surface-container-low rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 border border-outline-variant/20"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low/50">
                  <th className="table-header w-12 text-center">STT</th>
                  <th className="table-header">Giáo viên</th>
                  <th className="table-header">Liên hệ</th>
                  <th className="table-header text-right">Học phí / buổi</th>
                  <th className="table-header text-center">Lớp đang dạy</th>
                  <th className="table-header text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {loading ? (
                  <tr><td colSpan={6} className="py-16 text-center"><div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan={6} className="py-16 text-center text-outline">
                    <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">person_search</span>
                    Chưa có giáo viên nào
                  </td></tr>
                ) : visible.map((t, i) => (
                  <tr key={t.id} className="hover:bg-surface-container-low/30 transition-colors group">
                    <td className="table-cell text-center text-sm text-outline font-medium">{i + 1}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <Avatar name={t.fullName} />
                        <div>
                          <p className="font-semibold text-on-surface">{t.fullName}</p>
                          {t.idCard && <p className="text-xs text-outline">CCCD: {t.idCard}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="space-y-0.5">
                        {t.phone && (
                          <a href={`tel:${t.phone}`} className="text-sm text-on-surface flex items-center gap-1.5 hover:text-primary">
                            <span className="material-symbols-outlined text-sm">phone</span>{t.phone}
                          </a>
                        )}
                        {t.email && (
                          <a href={`mailto:${t.email}`} className="text-xs text-outline flex items-center gap-1.5 hover:text-primary">
                            <span className="material-symbols-outlined text-sm">mail</span>{t.email}
                          </a>
                        )}
                        {!t.phone && !t.email && <span className="text-outline text-sm">—</span>}
                      </div>
                    </td>
                    <td className="table-cell text-right font-bold text-on-surface">
                      {fmtVND(t.salaryRatePerSession)}đ
                    </td>
                    <td className="table-cell text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-bold">
                        {t.activeClassCount ?? 0} lớp
                      </span>
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditing(t); setShowModal(true) }}
                          className="p-2 text-outline hover:text-primary hover:bg-primary-container/10 rounded-lg transition-all"
                          title="Chỉnh sửa"
                        >
                          <span className="material-symbols-outlined text-[20px]">edit_square</span>
                        </button>
                        <button
                          onClick={() => handleDeactivate(t)}
                          className="p-2 text-outline hover:text-error hover:bg-error-container/10 rounded-lg transition-all"
                          title="Vô hiệu hoá"
                        >
                          <span className="material-symbols-outlined text-[20px]">person_off</span>
                        </button>
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
        <TeacherModal
          editing={editing}
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSaved={() => { setShowModal(false); setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function TeacherModal({ editing, onClose, onSaved }: { editing: Teacher | null; onClose: () => void; onSaved: () => void }) {
  const alert = useAlert()
  const [form, setForm] = useState({
    fullName: editing?.fullName ?? '',
    phone: editing?.phone ?? '',
    email: editing?.email ?? '',
    address: editing?.address ?? '',
    idCard: editing?.idCard ?? '',
    bankName: editing?.bankName ?? '',
    bankAccount: editing?.bankAccount ?? '',
    salaryRatePerSession: editing?.salaryRatePerSession ?? 0,
    notes: editing?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!form.fullName.trim()) {
      await alert({ title: 'Thiếu tên', message: 'Vui lòng nhập tên giáo viên.' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        salaryRatePerSession: Number(form.salaryRatePerSession) || 0,
      }
      if (editing) await api.put(`/teachers/${editing.id}`, payload)
      else await api.post('/teachers', payload)
      onSaved()
    } catch (err: any) {
      await alert({ title: 'Lỗi lưu', message: err?.response?.data?.message ?? 'Không lưu được.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-outline-variant/10 flex items-center justify-between">
          <h3 className="font-headline text-xl font-bold text-on-surface">
            {editing ? 'Chỉnh sửa giáo viên' : 'Thêm giáo viên mới'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-container-low text-outline hover:text-on-surface rounded-lg transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Họ và tên *</label>
              <input className="input" value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Nguyễn Văn A" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Số điện thoại</label>
              <input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="09..." />
            </div>
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Email</label>
              <input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="..." />
            </div>
            <div className="md:col-span-2">
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Địa chỉ</label>
              <input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Số nhà, đường, phường..." />
            </div>
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">CCCD / CMND</label>
              <input className="input" value={form.idCard} onChange={e => setForm({ ...form, idCard: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Học phí giáo viên / buổi (đ) *</label>
              <input className="input" type="number" min={0} step={1000} value={form.salaryRatePerSession}
                onChange={e => setForm({ ...form, salaryRatePerSession: Number(e.target.value) })} placeholder="200000" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Ngân hàng</label>
              <input className="input" value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} placeholder="Vietcombank, Techcombank..." />
            </div>
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Số tài khoản</label>
              <input className="input" value={form.bankAccount} onChange={e => setForm({ ...form, bankAccount: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Ghi chú</label>
              <textarea className="input min-h-[80px]" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-outline-variant/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors">
            Huỷ
          </button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? 'Đang lưu...' : editing ? 'Cập nhật' : 'Tạo mới'}
          </button>
        </div>
      </div>
    </div>
  )
}
