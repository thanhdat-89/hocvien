import React, { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, useParams } from 'react-router-dom'
import TopBar from '../components/TopBar'
import Toast, { ToastMessage } from '../components/Toast'
import { useAlert, useConfirm, usePrompt } from '../components/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useWorkspace, type Branch, type SchoolYear } from '../hooks/useWorkspace'
import api from '../services/api'
import { User } from '../types'
import Teachers from './Teachers'
import BranchChecklist from '../components/BranchChecklist'

type Role = User['role']
type Notify = (message: string, type?: ToastMessage['type']) => void

const SECTIONS: { key: string; icon: string; label: string; adminOnly?: boolean }[] = [
  { key: 'account', icon: 'account_circle', label: 'Tài khoản của tôi' },
  { key: 'users', icon: 'manage_accounts', label: 'Người dùng', adminOnly: true },
  { key: 'teachers', icon: 'badge', label: 'Giáo viên', adminOnly: true },
  { key: 'branches', icon: 'apartment', label: 'Cơ sở', adminOnly: true },
  { key: 'school-years', icon: 'calendar_month', label: 'Năm học', adminOnly: true },
  { key: 'integrations', icon: 'hub', label: 'Kết nối & tích hợp', adminOnly: true },
]

const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Quản trị viên', STAFF: 'Nhân viên', TEACHER: 'Giáo viên' }
const errorMessage = (err: any, fallback: string) => err?.response?.data?.message ?? fallback
const labelClass = 'text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5'
const panelClass = 'bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10'

export default function Settings() {
  const { section = 'account' } = useParams()
  const { isAdmin } = useAuth()
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const notify: Notify = (message, type = 'success') => setToasts(prev => [...prev, { id: Date.now(), message, type }])
  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))

  const visible = SECTIONS.filter(s => !s.adminOnly || isAdmin)
  if (!visible.some(s => s.key === section)) return <Navigate to="/settings/account" replace />

  return (
    <div>
      <TopBar title="Cài đặt" />
      <div className="page-content px-8 py-8 max-lg:px-4">
        <div className="mb-6">
          <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Hệ thống</span>
          <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight max-lg:text-2xl">Cài đặt</h2>
        </div>
        <div className="flex gap-6 max-lg:flex-col">
          <nav aria-label="Mục cài đặt" className="w-60 shrink-0 space-y-1 max-lg:w-full max-lg:flex max-lg:gap-2 max-lg:space-y-0 max-lg:overflow-x-auto max-lg:pb-1">
            {visible.map(s => (
              <NavLink key={s.key} to={`/settings/${s.key}`}
                className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'bg-white text-primary shadow-sm' : 'text-slate-600 hover:bg-white/60 hover:text-primary'}`}>
                <span className="material-symbols-outlined text-xl" aria-hidden="true">{s.icon}</span>
                {s.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1 min-w-0">
            {section === 'account' && <AccountSection notify={notify} />}
            {section === 'users' && <UsersSection notify={notify} />}
            {section === 'teachers' && <Teachers embedded />}
            {section === 'branches' && <BranchesSection notify={notify} />}
            {section === 'school-years' && <SchoolYearsSection notify={notify} />}
            {section === 'integrations' && <IntegrationsSection />}
          </div>
        </div>
      </div>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4 max-md:flex-col max-md:items-start">
      <div>
        <h3 className="text-2xl font-black text-on-surface font-headline">{title}</h3>
        <p className="text-sm text-outline mt-1">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

// ─── Tài khoản của tôi ───────────────────────────────────────

function AccountSection({ notify }: { notify: Notify }) {
  const { user, updateUser } = useAuth()
  const [profile, setProfile] = useState({ fullName: user?.fullName ?? '', email: user?.email ?? '' })
  const [savingProfile, setSavingProfile] = useState(false)
  const [passwords, setPasswords] = useState({ oldPassword: '', newPassword: '', confirm: '' })
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    api.get('/auth/me').then(r => setProfile({ fullName: r.data.fullName ?? '', email: r.data.email ?? '' })).catch(() => {})
  }, [])

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const { data } = await api.put('/auth/me', profile)
      updateUser({ fullName: data.fullName, email: data.email })
      notify('Đã lưu thông tin tài khoản')
    } catch (err) {
      notify(errorMessage(err, 'Không lưu được thông tin'), 'error')
    } finally { setSavingProfile(false) }
  }

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    if (passwords.newPassword.length < 6) { setPasswordError('Mật khẩu mới phải có ít nhất 6 ký tự'); return }
    if (passwords.newPassword !== passwords.confirm) { setPasswordError('Mật khẩu nhập lại không khớp'); return }
    setSavingPassword(true)
    try {
      await api.put('/auth/change-password', { oldPassword: passwords.oldPassword, newPassword: passwords.newPassword })
      setPasswords({ oldPassword: '', newPassword: '', confirm: '' })
      notify('Đã đổi mật khẩu')
    } catch (err) {
      setPasswordError(errorMessage(err, 'Không đổi được mật khẩu'))
    } finally { setSavingPassword(false) }
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Tài khoản của tôi" description="Thông tin hiển thị, cơ sở làm việc và mật khẩu đăng nhập của bạn." />
      <WorkingBranchPanel />
      <form onSubmit={saveProfile} className={`${panelClass} p-6 space-y-4`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Tên đăng nhập</label>
            <input className="input opacity-70" value={user?.username ?? ''} disabled />
          </div>
          <div>
            <label className={labelClass}>Vai trò</label>
            <input className="input opacity-70" value={user ? ROLE_LABEL[user.role] : ''} disabled />
          </div>
          <div>
            <label htmlFor="profile-name" className={labelClass}>Họ và tên *</label>
            <input id="profile-name" className="input" value={profile.fullName} required
              onChange={e => setProfile({ ...profile, fullName: e.target.value })} />
          </div>
          <div>
            <label htmlFor="profile-email" className={labelClass}>Email</label>
            <input id="profile-email" className="input" type="email" value={profile.email}
              onChange={e => setProfile({ ...profile, email: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={savingProfile} className="btn-primary disabled:opacity-50">
            {savingProfile ? 'Đang lưu...' : 'Lưu thông tin'}
          </button>
        </div>
      </form>

      <form onSubmit={changePassword} className={`${panelClass} p-6 space-y-4`}>
        <h4 className="font-headline text-lg font-bold text-on-surface">Đổi mật khẩu</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="pw-old" className={labelClass}>Mật khẩu hiện tại</label>
            <input id="pw-old" className="input" type="password" autoComplete="current-password" required
              value={passwords.oldPassword} onChange={e => setPasswords({ ...passwords, oldPassword: e.target.value })} />
          </div>
          <div>
            <label htmlFor="pw-new" className={labelClass}>Mật khẩu mới</label>
            <input id="pw-new" className="input" type="password" autoComplete="new-password" required
              value={passwords.newPassword} onChange={e => setPasswords({ ...passwords, newPassword: e.target.value })} />
          </div>
          <div>
            <label htmlFor="pw-confirm" className={labelClass}>Nhập lại mật khẩu mới</label>
            <input id="pw-confirm" className="input" type="password" autoComplete="new-password" required
              value={passwords.confirm} onChange={e => setPasswords({ ...passwords, confirm: e.target.value })} />
          </div>
        </div>
        {passwordError && <p role="alert" className="text-sm text-error">{passwordError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={savingPassword} className="btn-primary disabled:opacity-50">
            {savingPassword ? 'Đang đổi...' : 'Đổi mật khẩu'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** Cơ sở làm việc: mọi thao tác xem / thêm học viên, lớp, học phí... diễn ra ở cơ sở này */
function WorkingBranchPanel() {
  const { branches, branchId, allowedBranchIds, setBranch } = useWorkspace()
  const options = branches.filter(b => b.isActive && allowedBranchIds.includes(b.id))
  const [saving, setSaving] = useState(false)
  return (
    <div className={`${panelClass} p-6 space-y-2`}>
      <label htmlFor="working-branch" className={labelClass}>Cơ sở làm việc</label>
      {options.length ? (
        <select id="working-branch" className="input max-w-md" value={branchId} disabled={saving || options.length < 2}
          onChange={async e => { setSaving(true); try { await setBranch(e.target.value) } finally { setSaving(false) } }}>
          {options.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      ) : <p className="text-sm text-error">Bạn chưa được phân công cơ sở nào. Liên hệ quản trị viên.</p>}
      <p className="text-xs text-outline">Học viên, lớp, lịch, học phí bạn xem và thêm mới đều thuộc cơ sở này.{options.length === 1 ? ' Bạn chỉ được phân công một cơ sở.' : options.length > 1 ? ' Đổi cơ sở thì trang tải lại.' : ''}</p>
    </div>
  )
}

// ─── Người dùng ──────────────────────────────────────────────

interface AppUser {
  id: string
  username: string
  fullName: string
  email?: string | null
  role: Role
  isActive: boolean
  teacher?: { id: string; fullName: string } | null
  branches: { id: string; name: string }[]
}

function UsersSection({ notify }: { notify: Notify }) {
  const { user: me } = useAuth()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AppUser | 'new' | null>(null)

  const load = () => {
    setLoading(true)
    api.get('/users').then(r => setUsers(r.data)).catch(err => notify(errorMessage(err, 'Không tải được danh sách tài khoản'), 'error'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const isMe = (u: AppUser) => u.username === me?.username

  const toggleActive = async (u: AppUser) => {
    const ok = await confirm({
      title: u.isActive ? 'Khoá tài khoản?' : 'Mở khoá tài khoản?',
      message: u.isActive
        ? `"${u.username}" sẽ bị đăng xuất và không đăng nhập được nữa.`
        : `"${u.username}" sẽ đăng nhập lại được.`,
      confirmLabel: u.isActive ? 'Khoá' : 'Mở khoá',
      danger: u.isActive,
    })
    if (!ok) return
    try {
      await api.put(`/users/${u.id}`, { isActive: !u.isActive })
      notify(u.isActive ? 'Đã khoá tài khoản' : 'Đã mở khoá tài khoản')
      load()
    } catch (err) { notify(errorMessage(err, 'Không cập nhật được'), 'error') }
  }

  const resetPassword = async (u: AppUser) => {
    const password = await prompt({
      title: `Đặt lại mật khẩu — ${u.username}`,
      message: 'Nhập mật khẩu mới (ít nhất 6 ký tự) rồi gửi cho người dùng.',
      inputType: 'password', confirmLabel: 'Đặt lại',
    })
    if (password === null) return
    try {
      await api.post(`/users/${u.id}/reset-password`, { password })
      notify('Đã đặt lại mật khẩu')
    } catch (err) { notify(errorMessage(err, 'Không đặt lại được mật khẩu'), 'error') }
  }

  return (
    <div>
      <SectionHeader title="Người dùng" description="Tài khoản đăng nhập của quản trị viên, nhân viên và giáo viên."
        action={<button className="btn-primary" onClick={() => setEditing('new')}>
          <span className="material-symbols-outlined" aria-hidden="true">person_add</span>Thêm tài khoản
        </button>} />
      <div className={`${panelClass} overflow-x-auto`}>
        <table className="w-full min-w-[640px] text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low/50">
              <th className="table-header">Người dùng</th>
              <th className="table-header">Vai trò · Cơ sở</th>
              <th className="table-header">Trạng thái</th>
              <th className="table-header text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {loading ? (
              <tr><td colSpan={4} className="py-16 text-center"><div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></td></tr>
            ) : users.map(u => (
              <tr key={u.id} className={u.isActive ? '' : 'opacity-60'}>
                <td className="table-cell">
                  <p className="font-semibold text-on-surface">{u.fullName}{isMe(u) && <span className="ml-2 text-xs text-primary">(bạn)</span>}</p>
                  <p className="text-xs text-outline">{u.username}{u.email ? ` · ${u.email}` : ''}</p>
                  {u.teacher && <p className="text-xs text-outline">Hồ sơ giáo viên: {u.teacher.fullName}</p>}
                </td>
                <td className="table-cell text-sm">
                  {ROLE_LABEL[u.role]}
                  <p className="text-xs text-outline">{u.role === 'ADMIN' ? 'Mọi cơ sở' : u.branches.map(b => b.name).join(', ') || 'Chưa phân cơ sở'}</p>
                </td>
                <td className="table-cell">
                  <span className={u.isActive ? 'status-badge-active' : 'status-badge-inactive'}>{u.isActive ? 'Hoạt động' : 'Đã khoá'}</span>
                </td>
                <td className="table-cell">
                  <div className="flex items-center justify-end gap-1">
                    <IconButton icon="edit_square" label="Chỉnh sửa" onClick={() => setEditing(u)} />
                    <IconButton icon="key" label="Đặt lại mật khẩu" onClick={() => resetPassword(u)} />
                    {!isMe(u) && <IconButton icon={u.isActive ? 'lock' : 'lock_open'} label={u.isActive ? 'Khoá' : 'Mở khoá'}
                      danger={u.isActive} onClick={() => toggleActive(u)} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserModal editing={editing === 'new' ? null : editing} self={editing !== 'new' && isMe(editing)}
        onClose={() => setEditing(null)}
        onSaved={() => { notify(editing === 'new' ? 'Đã tạo tài khoản' : 'Đã lưu tài khoản'); setEditing(null); load() }} />}
    </div>
  )
}

function IconButton({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className={`p-2 text-outline rounded-lg transition-all ${danger ? 'hover:text-error hover:bg-error-container/10' : 'hover:text-primary hover:bg-primary-container/10'}`}>
      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{icon}</span>
    </button>
  )
}

function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }) {
  return (
    <div className="responsive-dialog fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className={`bg-surface rounded-2xl shadow-xl w-full ${wide ? 'max-w-5xl' : 'max-w-lg'} max-h-[90vh] flex flex-col`}>
        <div className="p-6 border-b border-outline-variant/10 flex items-center justify-between">
          <h3 className="font-headline text-xl font-bold text-on-surface">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Đóng" className="p-2 hover:bg-surface-container-low text-outline rounded-lg">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">{children}</div>
        <div className="p-6 border-t border-outline-variant/10 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  )
}

function UserModal({ editing, self, onClose, onSaved }: { editing: AppUser | null; self: boolean; onClose: () => void; onSaved: () => void }) {
  const alert = useAlert()
  const [form, setForm] = useState({
    username: editing?.username ?? '', fullName: editing?.fullName ?? '', email: editing?.email ?? '',
    role: editing?.role ?? 'STAFF' as Role, password: '', teacherId: '',
  })
  const { branches, branchId: working } = useWorkspace()
  const [branchIds, setBranchIds] = useState<string[]>(editing?.branches.map(b => b.id) ?? (working ? [working] : []))
  const [teachers, setTeachers] = useState<{ id: string; fullName: string; userId?: string | null }[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) api.get('/teachers').then(r => setTeachers(r.data.filter((t: { userId?: string | null }) => !t.userId))).catch(() => {})
  }, [editing])

  const submit = async () => {
    setSaving(true)
    try {
      if (form.role !== 'ADMIN' && !branchIds.length) { await alert({ title: 'Chưa chọn cơ sở', message: 'Chọn ít nhất một cơ sở người dùng được làm việc.' }); return }
      if (editing) await api.put(`/users/${editing.id}`, { fullName: form.fullName, email: form.email, role: form.role, branchIds })
      else await api.post('/users', { ...form, branchIds, teacherId: form.role === 'TEACHER' ? form.teacherId || undefined : undefined })
      onSaved()
    } catch (err) {
      await alert({ title: 'Không lưu được', message: errorMessage(err, 'Vui lòng thử lại.') })
    } finally { setSaving(false) }
  }

  return (
    <Modal title={editing ? `Sửa tài khoản ${editing.username}` : 'Thêm tài khoản'} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low">Huỷ</button>
        <button type="button" onClick={submit} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? 'Đang lưu...' : editing ? 'Cập nhật' : 'Tạo tài khoản'}
        </button>
      </>}>
      {!editing && (
        <div>
          <label htmlFor="user-username" className={labelClass}>Tên đăng nhập *</label>
          <input id="user-username" className="input" autoComplete="off" value={form.username}
            onChange={e => setForm({ ...form, username: e.target.value })} placeholder="vd: nhanvien1" />
        </div>
      )}
      <div>
        <label htmlFor="user-name" className={labelClass}>Họ và tên *</label>
        <input id="user-name" className="input" value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} />
      </div>
      <div>
        <label htmlFor="user-email" className={labelClass}>Email</label>
        <input id="user-email" className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
      </div>
      <div>
        <label htmlFor="user-role" className={labelClass}>Vai trò *</label>
        <select id="user-role" className="input" value={form.role} disabled={self}
          onChange={e => setForm({ ...form, role: e.target.value as Role })}>
          {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        {self && <p className="text-xs text-outline mt-1">Không thể đổi vai trò của chính mình.</p>}
      </div>
      {form.role !== 'ADMIN' && <BranchChecklist branches={branches} value={branchIds} onChange={setBranchIds} label="Cơ sở được làm việc *" />}
      {!editing && form.role === 'TEACHER' && (
        <div>
          <label htmlFor="user-teacher" className={labelClass}>Gắn với hồ sơ giáo viên</label>
          <select id="user-teacher" className="input" value={form.teacherId} onChange={e => setForm({ ...form, teacherId: e.target.value })}>
            <option value="">— Không gắn —</option>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
          </select>
        </div>
      )}
      {!editing && (
        <div>
          <label htmlFor="user-password" className={labelClass}>Mật khẩu ban đầu * (ít nhất 6 ký tự)</label>
          <input id="user-password" className="input" type="password" autoComplete="new-password" value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })} />
        </div>
      )}
    </Modal>
  )
}

// ─── Cơ sở ───────────────────────────────────────────────────

function BranchesSection({ notify }: { notify: Notify }) {
  const { branches, reload, branchId, setBranch } = useWorkspace()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Branch | 'new' | null>(null)

  const toggleActive = async (b: Branch) => {
    const ok = await confirm({
      title: b.isActive ? `Ngừng hoạt động ${b.name}?` : `Mở lại ${b.name}?`,
      message: b.isActive ? 'Cơ sở sẽ ẩn khỏi ô chọn cơ sở và không nhận học viên, lớp mới. Dữ liệu cũ vẫn giữ nguyên.' : 'Cơ sở sẽ hiện lại trong ô chọn cơ sở.',
      confirmLabel: b.isActive ? 'Ngừng hoạt động' : 'Mở lại', danger: b.isActive,
    })
    if (!ok) return
    try { await api.put(`/branches/${b.id}`, { isActive: !b.isActive }); notify(b.isActive ? 'Đã ngừng hoạt động cơ sở' : 'Đã mở lại cơ sở'); await reload() }
    catch (err) { notify(errorMessage(err, 'Không cập nhật được'), 'error') }
  }

  return (
    <div>
      <SectionHeader title="Cơ sở" description="Mỗi học viên thuộc một cơ sở. Mỗi tài khoản làm việc tại một cơ sở (xem và thêm học viên, lớp... ở cơ sở đó), trong các cơ sở được phân công ở mục Người dùng, Giáo viên."
        action={<button className="btn-primary" onClick={() => setEditing('new')}>
          <span className="material-symbols-outlined" aria-hidden="true">add_business</span>Thêm cơ sở
        </button>} />
      <div className={`${panelClass} overflow-x-auto`}>
        <table className="w-full min-w-[640px] text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low/50">
              <th className="table-header">Cơ sở</th>
              <th className="table-header text-center">Học viên</th>
              <th className="table-header text-center">Lớp</th>
              <th className="table-header text-center">Tài khoản · GV</th>
              <th className="table-header">Trạng thái</th>
              <th className="table-header text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {branches.map(b => (
              <tr key={b.id} className={b.isActive ? '' : 'opacity-60'}>
                <td className="table-cell">
                  <p className="font-semibold text-on-surface">{b.name}{b.id === branchId && <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 align-middle text-[11px] font-semibold text-primary">Đang làm việc</span>}</p>
                  <p className="text-xs text-outline">{[b.address, b.phone].filter(Boolean).join(' · ') || '—'}</p>
                </td>
                <td className="table-cell text-center text-sm">{b.counts?.students ?? '—'}</td>
                <td className="table-cell text-center text-sm">{b.counts?.classes ?? '—'}</td>
                <td className="table-cell text-center text-sm" title="Tài khoản · giáo viên">{b.counts ? `${b.counts.users} · ${b.counts.teachers}` : '—'}</td>
                <td className="table-cell"><span className={b.isActive ? 'status-badge-active' : 'status-badge-pending'}>{b.isActive ? 'Hoạt động' : 'Ngừng'}</span></td>
                <td className="table-cell">
                  <div className="flex items-center justify-end gap-1">
                    {b.isActive && b.id !== branchId && <IconButton icon="login" label="Làm việc tại cơ sở này" onClick={() => setBranch(b.id)} />}
                    <IconButton icon="edit_square" label="Chỉnh sửa" onClick={() => setEditing(b)} />
                    <IconButton icon={b.isActive ? 'block' : 'replay'} label={b.isActive ? 'Ngừng hoạt động' : 'Mở lại'} danger={b.isActive} onClick={() => toggleActive(b)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <BranchModal editing={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={async () => { notify(editing === 'new' ? 'Đã tạo cơ sở' : 'Đã lưu cơ sở'); setEditing(null); await reload() }} />}
    </div>
  )
}

function BranchModal({ editing, onClose, onSaved }: { editing: Branch | null; onClose: () => void; onSaved: () => void }) {
  const alert = useAlert()
  const [form, setForm] = useState({ name: editing?.name ?? '', address: editing?.address ?? '', phone: editing?.phone ?? '' })
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setSaving(true)
    try {
      if (editing) await api.put(`/branches/${editing.id}`, form)
      else await api.post('/branches', form)
      onSaved()
    } catch (err) { await alert({ title: 'Không lưu được', message: errorMessage(err, 'Vui lòng thử lại.') }) }
    finally { setSaving(false) }
  }
  return (
    <Modal title={editing ? `Sửa ${editing.name}` : 'Thêm cơ sở'} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low">Huỷ</button>
        <button type="button" onClick={submit} disabled={saving} className="btn-primary disabled:opacity-50">{saving ? 'Đang lưu...' : editing ? 'Cập nhật' : 'Tạo cơ sở'}</button>
      </>}>
      <div>
        <label htmlFor="branch-name" className={labelClass}>Tên cơ sở *</label>
        <input id="branch-name" className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="vd: CQT 263" />
      </div>
      <div>
        <label htmlFor="branch-address" className={labelClass}>Địa chỉ</label>
        <input id="branch-address" className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
      </div>
      <div>
        <label htmlFor="branch-phone" className={labelClass}>Điện thoại</label>
        <input id="branch-phone" className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
      </div>
    </Modal>
  )
}

// ─── Năm học ─────────────────────────────────────────────────

const YEAR_STATUS: Record<SchoolYear['status'], [string, string]> = {
  CURRENT: ['Đang chạy', 'status-badge-active'], UPCOMING: ['Sắp tới', 'status-badge-pending'], CLOSED: ['Đã đóng', 'status-badge-inactive'],
}
const viDate = (ymd: string) => ymd.split('-').reverse().join('/')

function SchoolYearsSection({ notify }: { notify: Notify }) {
  const { years, reload } = useWorkspace()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<SchoolYear | 'new' | null>(null)
  const [rollover, setRollover] = useState<SchoolYear | null>(null)
  const current = years.find(y => y.status === 'CURRENT')

  const setStatus = async (y: SchoolYear, status: SchoolYear['status']) => {
    const ok = await confirm(status === 'CURRENT'
      ? { title: `Đặt ${y.name} làm năm học hiện tại?`, message: `${current ? `Năm ${current.name} sẽ chuyển sang Đã đóng: chỉ xem, không ghi danh hay tạo lớp mới (phiếu học phí cũ vẫn thu được). ` : ''}Lớp mới sẽ mặc định vào năm ${y.name}.`, confirmLabel: 'Đặt làm năm hiện tại' }
      : status === 'CLOSED'
        ? { title: `Đóng năm học ${y.name}?`, message: 'Lớp của năm này chỉ còn xem được: không ghi danh hay tạo lớp mới.', confirmLabel: 'Đóng năm học', danger: true }
        : { title: `Mở lại năm học ${y.name}?`, message: 'Năm học chuyển về Sắp tới, lớp của năm này nhận ghi danh trở lại.', confirmLabel: 'Mở lại' })
    if (!ok) return
    try { await api.put(`/school-years/${y.id}`, { status }); notify('Đã cập nhật năm học'); await reload() }
    catch (err) { notify(errorMessage(err, 'Không cập nhật được'), 'error') }
  }
  const remove = async (y: SchoolYear) => {
    if (!(await confirm({ title: `Xoá năm học ${y.name}?`, message: 'Chỉ xoá được năm học chưa có lớp.', confirmLabel: 'Xoá', danger: true }))) return
    try { await api.delete(`/school-years/${y.id}`); notify('Đã xoá năm học'); await reload() }
    catch (err) { notify(errorMessage(err, 'Không xoá được'), 'error') }
  }

  return (
    <div>
      <SectionHeader title="Năm học" description="Năm học dùng chung cho mọi cơ sở. Mỗi lớp thuộc một năm học; sang năm mới tạo lớp mới, lớp cũ giữ làm lịch sử."
        action={<button className="btn-primary" onClick={() => setEditing('new')}>
          <span className="material-symbols-outlined" aria-hidden="true">add</span>Thêm năm học
        </button>} />
      <div className={`${panelClass} overflow-x-auto`}>
        <table className="w-full min-w-[640px] text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low/50">
              <th className="table-header">Năm học</th>
              <th className="table-header">Thời gian</th>
              <th className="table-header text-center">Lớp</th>
              <th className="table-header">Trạng thái</th>
              <th className="table-header text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {years.map(y => (
              <tr key={y.id}>
                <td className="table-cell font-semibold text-on-surface">{y.name}</td>
                <td className="table-cell text-sm">{viDate(y.startDate)} – {viDate(y.endDate)}</td>
                <td className="table-cell text-center text-sm">{y.classCount}</td>
                <td className="table-cell"><span className={YEAR_STATUS[y.status][1]}>{YEAR_STATUS[y.status][0]}</span></td>
                <td className="table-cell">
                  <div className="flex items-center justify-end gap-1">
                    {y.status !== 'CLOSED' && y.classCount > 0 && <IconButton icon="next_plan" label="Chuyển sang năm học mới" onClick={() => setRollover(y)} />}
                    {y.status !== 'CURRENT' && <IconButton icon="play_circle" label="Đặt làm năm hiện tại" onClick={() => setStatus(y, 'CURRENT')} />}
                    {y.status === 'UPCOMING' && <IconButton icon="lock" label="Đóng năm học" danger onClick={() => setStatus(y, 'CLOSED')} />}
                    {y.status === 'CLOSED' && <IconButton icon="lock_open" label="Mở lại" onClick={() => setStatus(y, 'UPCOMING')} />}
                    <IconButton icon="edit_square" label="Sửa tên, ngày" onClick={() => setEditing(y)} />
                    {y.status !== 'CURRENT' && y.classCount === 0 && <IconButton icon="delete" label="Xoá" danger onClick={() => remove(y)} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rollover && <RolloverModal source={rollover} years={years} onClose={() => setRollover(null)}
        onDone={async message => { notify(message); setRollover(null); await reload() }} />}
      {editing && <SchoolYearModal editing={editing === 'new' ? null : editing} latest={years[0]} onClose={() => setEditing(null)}
        onSaved={async () => { notify(editing === 'new' ? 'Đã tạo năm học' : 'Đã lưu năm học'); setEditing(null); await reload() }} />}
    </div>
  )
}

// ─── Chuyển năm học ──────────────────────────────────────────

type RolloverAction = 'promote' | 'empty' | 'skip'
interface RolloverClass {
  id: string; name: string; branchName: string; gradeLevel: number | null; teacherName: string | null; students: number; schedules: number
  tuitionRate: number; suggestedName: string; suggestedGrade: number | null; suggestedAction: RolloverAction; blocked: string | null
}
interface RolloverPreview { cutoff: string; classes: RolloverClass[]; graduating: { id: string; fullName: string; gradeLevel: number }[] }
const ACTION_LABEL: Record<RolloverAction, string> = { promote: 'Lên lớp (giữ học sinh)', empty: 'Tạo lớp trống', skip: 'Không mở lại' }

function RolloverModal({ source, years, onClose, onDone }: { source: SchoolYear; years: SchoolYear[]; onClose: () => void; onDone: (message: string) => void }) {
  const confirm = useConfirm()
  const { branches, branchId } = useWorkspace()
  const targets = years.filter(y => y.status !== 'CLOSED' && y.startDate > source.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '')
  const [preview, setPreview] = useState<RolloverPreview | null>(null)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<Record<string, { action: RolloverAction; name: string; gradeLevel: string }>>({})
  const [bumpGrades, setBumpGrades] = useState(true)
  const [graduateIds, setGraduateIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const scopeName = branches.find(b => b.id === branchId)?.name

  useEffect(() => {
    if (!targetId) return
    setPreview(null); setError('')
    api.get<RolloverPreview>(`/school-years/${source.id}/rollover`, { params: { targetYearId: targetId } }).then(r => {
      setPreview(r.data)
      setRows(Object.fromEntries(r.data.classes.map(c => [c.id, { action: c.suggestedAction, name: c.suggestedName, gradeLevel: c.suggestedGrade?.toString() ?? '' }])))
      setGraduateIds(r.data.graduating.map(s => s.id))
    }).catch(err => setError(errorMessage(err, 'Không tải được danh sách lớp')))
  }, [source.id, targetId])

  const open = preview?.classes.filter(c => !c.blocked) ?? []
  const created = open.filter(c => rows[c.id]?.action !== 'skip')
  const moving = open.filter(c => rows[c.id]?.action === 'promote').reduce((n, c) => n + c.students, 0)
  const target = years.find(y => y.id === targetId)
  const setRow = (id: string, change: Partial<{ action: RolloverAction; name: string; gradeLevel: string }>) => setRows(prev => ({ ...prev, [id]: { ...prev[id], ...change } }))

  const submit = async () => {
    if (!preview || !target) return
    const ok = await confirm({
      title: `Chuyển sang năm học ${target.name}?`,
      message: `Tạo ${created.length} lớp mới, chuyển ${moving} lượt học viên, kết thúc ${open.length} lớp năm ${source.name} vào ngày ${viDate(preview.cutoff)} (buổi chưa học sau ngày này bị xoá). ${graduateIds.length} học viên chuyển sang Đã tốt nghiệp.${bumpGrades ? ' Học viên đang học được tăng khối.' : ''} Không hoàn tác tự động được.`,
      confirmLabel: 'Chuyển năm học',
    })
    if (!ok) return
    setSaving(true); setError('')
    try {
      const { data } = await api.post(`/school-years/${source.id}/rollover`, {
        targetYearId: targetId, bumpGrades, graduateIds,
        classes: open.map(c => ({ classId: c.id, action: rows[c.id].action, name: rows[c.id].name, gradeLevel: rows[c.id].gradeLevel ? Number(rows[c.id].gradeLevel) : null })),
      })
      onDone(`Đã chuyển năm: ${data.created.length} lớp mới ở năm ${data.targetYear}, ${data.graduated} học viên tốt nghiệp`)
    } catch (err) { setError(errorMessage(err, 'Không chuyển được năm học')) }
    finally { setSaving(false) }
  }

  return (
    <Modal wide title={`Chuyển năm học từ ${source.name}`} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low">Huỷ</button>
        <button type="button" onClick={submit} disabled={saving || !preview || !open.length} className="btn-primary disabled:opacity-50">{saving ? 'Đang chuyển...' : 'Xem lại và chuyển năm'}</button>
      </>}>
      {!targets.length ? (
        <p className="text-sm text-on-surface">Chưa có năm học nào sau {source.name}. Đóng cửa sổ này, bấm <b>Thêm năm học</b> rồi quay lại.</p>
      ) : <>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="rollover-target" className={labelClass}>Sang năm học</label>
            <select id="rollover-target" className="input" value={targetId} onChange={e => setTargetId(e.target.value)}>
              {targets.map(y => <option key={y.id} value={y.id}>{y.name} ({viDate(y.startDate)} – {viDate(y.endDate)})</option>)}
            </select>
          </div>
          <p className="text-sm text-outline pb-2">Áp dụng cho lớp của <b>{scopeName}</b>{preview && <> · lớp cũ kết thúc ngày <b>{viDate(preview.cutoff)}</b></>}</p>
        </div>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        {!preview && !error && <p className="text-sm text-outline">Đang tải danh sách lớp…</p>}
        {preview && (
          <div className="overflow-x-auto rounded-xl border border-outline-variant/20">
            <table className="w-full min-w-[760px] text-left border-collapse text-sm">
              <thead>
                <tr className="bg-surface-container-low/50">
                  <th className="px-3 py-2 font-semibold text-outline">Lớp năm {source.name}</th>
                  <th className="px-3 py-2 font-semibold text-outline">Cách xử lý</th>
                  <th className="px-3 py-2 font-semibold text-outline">Tên lớp mới</th>
                  <th className="px-3 py-2 font-semibold text-outline w-28">Khối</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {preview.classes.map(c => {
                  const row = rows[c.id]
                  return (
                    <tr key={c.id} className={c.blocked ? 'opacity-60' : ''}>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-on-surface">{c.name}</p>
                        <p className="text-xs text-outline">{[c.teacherName, `${c.students} học viên`, `${c.schedules} lịch/tuần`, c.tuitionRate ? `${new Intl.NumberFormat('vi-VN').format(c.tuitionRate)}đ/buổi` : null].filter(Boolean).join(' · ')}</p>
                      </td>
                      {c.blocked ? <td colSpan={3} className="px-3 py-2 text-xs text-amber-800">{c.blocked}</td> : <>
                        <td className="px-3 py-2">
                          <select aria-label={`Cách xử lý ${c.name}`} className="input py-1.5" value={row?.action} onChange={e => setRow(c.id, { action: e.target.value as RolloverAction })}>
                            {(Object.keys(ACTION_LABEL) as RolloverAction[]).map(a => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input aria-label={`Tên lớp mới ${c.name}`} className="input py-1.5" disabled={row?.action === 'skip'} value={row?.name ?? ''} onChange={e => setRow(c.id, { name: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <input aria-label={`Khối ${c.name}`} className="input py-1.5" type="number" min={1} max={12} disabled={row?.action === 'skip'} value={row?.gradeLevel ?? ''} onChange={e => setRow(c.id, { gradeLevel: e.target.value })} />
                        </td>
                      </>}
                    </tr>
                  )
                })}
                {!preview.classes.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-outline">Năm {source.name} không còn lớp đang hoạt động trong phạm vi này.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {preview && <>
          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input type="checkbox" checked={bumpGrades} onChange={e => setBumpGrades(e.target.checked)} />
            Tăng khối cho mọi học viên đang học (khối 12 giữ nguyên)
          </label>
          {preview.graduating.length > 0 && (
            <fieldset>
              <legend className={labelClass}>Học viên khối 12 chuyển sang Đã tốt nghiệp ({graduateIds.length}/{preview.graduating.length})</legend>
              <div className="flex flex-wrap gap-2">
                {preview.graduating.map(s => (
                  <label key={s.id} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm cursor-pointer ${graduateIds.includes(s.id) ? 'border-primary bg-primary/5 text-primary' : 'border-outline-variant/30'}`}>
                    <input type="checkbox" checked={graduateIds.includes(s.id)} onChange={e => setGraduateIds(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} />
                    {s.fullName}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <p className="rounded-xl bg-primary/5 px-4 py-3 text-sm text-on-surface">
            Sẽ tạo <b>{created.length}</b> lớp mới, chuyển <b>{moving}</b> lượt học viên, kết thúc <b>{open.length}</b> lớp cũ. Buổi học của lớp mới được tạo dần theo lịch từ ngày {target && viDate(target.startDate)}.
          </p>
        </>}
      </>}
    </Modal>
  )
}

/** Gợi ý năm mới: bắt đầu 01/07 năm sau năm mới nhất, kết thúc 30/06 năm kế tiếp */
function nextYearDefaults(latest?: SchoolYear) {
  const from = latest ? Number(latest.endDate.slice(0, 4)) : new Date().getFullYear()
  return { name: `${from}–${from + 1}`, startDate: `${from}-07-01`, endDate: `${from + 1}-06-30` }
}

function SchoolYearModal({ editing, latest, onClose, onSaved }: { editing: SchoolYear | null; latest?: SchoolYear; onClose: () => void; onSaved: () => void }) {
  const alert = useAlert()
  const [form, setForm] = useState(editing ? { name: editing.name, startDate: editing.startDate, endDate: editing.endDate } : nextYearDefaults(latest))
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setSaving(true)
    try {
      if (editing) await api.put(`/school-years/${editing.id}`, form)
      else await api.post('/school-years', form)
      onSaved()
    } catch (err) { await alert({ title: 'Không lưu được', message: errorMessage(err, 'Vui lòng thử lại.') }) }
    finally { setSaving(false) }
  }
  return (
    <Modal title={editing ? `Sửa năm học ${editing.name}` : 'Thêm năm học'} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low">Huỷ</button>
        <button type="button" onClick={submit} disabled={saving} className="btn-primary disabled:opacity-50">{saving ? 'Đang lưu...' : editing ? 'Cập nhật' : 'Tạo năm học'}</button>
      </>}>
      <div>
        <label htmlFor="year-name" className={labelClass}>Tên năm học *</label>
        <input id="year-name" className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="year-start" className={labelClass}>Ngày bắt đầu *</label>
          <input id="year-start" className="input" type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
        </div>
        <div>
          <label htmlFor="year-end" className={labelClass}>Ngày kết thúc *</label>
          <input id="year-end" className="input" type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
        </div>
      </div>
      {!editing && <p className="text-xs text-outline">Năm mới ở trạng thái Sắp tới: tạo lớp cho năm mới bằng cách chọn năm này ở thanh trên cùng. Khi bắt đầu năm học, bấm "Đặt làm năm hiện tại".</p>}
    </Modal>
  )
}

// ─── Kết nối & tích hợp ──────────────────────────────────────
// Chỉ đọc trạng thái; khoá bí mật vẫn nằm trong .env trên VPS.

type Tone = 'ok' | 'warn' | 'error' | 'idle'
const TONE: Record<Tone, string> = {
  ok: 'bg-secondary-container/30 text-secondary', warn: 'bg-amber-100 text-amber-800',
  error: 'bg-error-container/20 text-error', idle: 'bg-surface-container-high text-on-surface-variant',
}

const MISA_STATE: Record<string, [string, Tone]> = {
  CONNECTED: ['Kết nối thành công', 'ok'], MISSING_CONFIG: ['Thiếu cấu hình', 'error'],
  AUTH_FAILED: ['Sai thông tin đăng nhập', 'error'], OTP_REQUIRED: ['Đăng nhập được, cần OTP để xem chứng thư số', 'warn'],
  OTP_FAILED: ['OTP không đúng', 'error'], LOOKUP_FAILED: ['Đăng nhập được nhưng không đọc được dữ liệu', 'warn'],
  INVALID_RESPONSE: ['MISA trả về dữ liệu lạ', 'warn'], REQUEST_FAILED: ['Không gọi được MISA', 'error'],
}
const TELEGRAM_STATE: Record<string, [string, Tone]> = {
  CONNECTED: ['Kết nối thành công', 'ok'], NOT_CONFIGURED: ['Chưa cấu hình', 'error'],
  BOT_ERROR: ['Bot token không hợp lệ', 'error'], CHAT_ERROR: ['Bot không gửi được vào chat', 'error'],
}

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${TONE[tone]}`}>{children}</span>
}

function IntegrationCard({ icon, title, description, status, children }: {
  icon: string; title: string; description: string; status: React.ReactNode; children?: React.ReactNode
}) {
  return (
    <div className={`${panelClass} p-6 space-y-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-container/20 flex items-center justify-center text-primary shrink-0">
            <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
          </div>
          <div>
            <h4 className="font-headline text-lg font-bold text-on-surface">{title}</h4>
            <p className="text-sm text-outline">{description}</p>
          </div>
        </div>
        <div className="shrink-0">{status}</div>
      </div>
      {children}
    </div>
  )
}

function MissingVars({ names }: { names: string[] }) {
  if (!names.length) return null
  return <p className="text-xs text-error">Thiếu biến môi trường: {names.map(n => <code key={n} className="mr-1">{n}</code>)}</p>
}

function IntegrationsSection() {
  const [misa, setMisa] = useState<{ products: { product: 'meinvoice' | 'esign'; missing: string[] }[];
    selectedCertificate: { keyAlias: string; name?: string } | null } | null>(null)
  const [misaChecks, setMisaChecks] = useState<Record<string, { label: string; tone: Tone; busy?: boolean }>>({})
  const [telegram, setTelegram] = useState<{ state: string; missing?: string[]; botUsername?: string; busy?: boolean } | null>(null)
  const [telegramSend, setTelegramSend] = useState<{ label: string; tone: Tone } | null>(null)
  const [zns, setZns] = useState<{ enabled: boolean; appIdSet: boolean; accessTokenSet: boolean; refreshTokenSet: boolean; webhookSecretSet: boolean } | null>(null)
  const [sepay, setSepay] = useState<{ webhookKeySet: boolean; ipCheck: boolean; notifyParents: boolean; notifyAdminZalo: boolean } | null>(null)

  const checkTelegram = () => {
    setTelegram(prev => ({ state: prev?.state ?? '', ...prev, busy: true }))
    api.get('/telegram/connection').then(r => setTelegram(r.data)).catch(() => setTelegram({ state: 'REQUEST_FAILED' }))
  }

  useEffect(() => {
    api.get('/tuition/misa/connection').then(r => setMisa(r.data)).catch(() => {})
    api.get('/zns/status').then(r => setZns(r.data)).catch(() => {})
    api.get('/webhooks/sepay/status').then(r => setSepay(r.data)).catch(() => {})
    checkTelegram()
  }, [])

  const checkMisa = async (product: 'meinvoice' | 'esign') => {
    setMisaChecks(prev => ({ ...prev, [product]: { label: 'Đang kiểm tra...', tone: 'idle', busy: true } }))
    try {
      const { data } = await api.post('/tuition/misa/connection/check', { product })
      const [label, tone] = MISA_STATE[data.state] ?? [data.state, 'warn']
      const detail = data.state === 'CONNECTED' && typeof data.count === 'number' ? ` (${data.activeCount}/${data.count} ${product === 'meinvoice' ? 'mẫu hoá đơn' : 'chứng thư'} đang dùng)` : ''
      setMisaChecks(prev => ({ ...prev, [product]: { label: label + detail, tone } }))
    } catch (err: any) {
      setMisaChecks(prev => ({ ...prev, [product]: { label: errorMessage(err, 'Không kiểm tra được'), tone: 'error' } }))
    }
  }

  const sendTelegramTest = async () => {
    setTelegramSend({ label: 'Đang gửi...', tone: 'idle' })
    try {
      await api.post('/telegram/test')
      setTelegramSend({ label: 'Đã gửi tin thử', tone: 'ok' })
    } catch {
      setTelegramSend({ label: 'Gửi không thành công', tone: 'error' })
    }
  }

  const misaProduct = (product: 'meinvoice' | 'esign') => misa?.products.find(p => p.product === product)
  const telegramState = telegram?.busy ? ['Đang kiểm tra...', 'idle'] as const : TELEGRAM_STATE[telegram?.state ?? ''] ?? ['Không kiểm tra được', 'error'] as const

  return (
    <div className="space-y-4">
      <SectionHeader title="Kết nối & tích hợp" description="Trạng thái các dịch vụ bên ngoài. Muốn đổi khoá bí mật thì sửa file .env trên VPS rồi khởi động lại ứng dụng." />

      {(['meinvoice', 'esign'] as const).map(product => {
        const info = misaProduct(product)
        const check = misaChecks[product]
        return (
          <IntegrationCard key={product} icon={product === 'meinvoice' ? 'receipt_long' : 'verified_user'}
            title={product === 'meinvoice' ? 'MISA meInvoice' : 'MISA eSign'}
            description={product === 'meinvoice' ? 'Tạo hoá đơn điện tử nháp từ phiếu học phí.' : 'Chứng thư số dùng để ký hoá đơn.'}
            status={!misa ? <Badge tone="idle">Đang tải...</Badge>
              : info?.missing.length ? <Badge tone="error">Thiếu cấu hình</Badge> : <Badge tone="ok">Đã cấu hình</Badge>}>
            <MissingVars names={info?.missing ?? []} />
            {product === 'esign' && misa?.selectedCertificate && (
              <p className="text-xs text-outline">Chứng thư đang chọn: {misa.selectedCertificate.name || misa.selectedCertificate.keyAlias}</p>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed" disabled={!info || !!info.missing.length || check?.busy}
                onClick={() => checkMisa(product)}>
                <span className="material-symbols-outlined text-lg" aria-hidden="true">sync</span>Kiểm tra kết nối
              </button>
              {check && <Badge tone={check.tone}>{check.label}</Badge>}
            </div>
          </IntegrationCard>
        )
      })}

      <IntegrationCard icon="send" title="Telegram" description="Báo khi MISA tạo hoá đơn nháp mới."
        status={!telegram ? <Badge tone="idle">Đang kiểm tra...</Badge> : <Badge tone={telegramState[1]}>{telegramState[0]}</Badge>}>
        <MissingVars names={telegram?.missing ?? []} />
        {telegram?.botUsername && <p className="text-xs text-outline">Bot: @{telegram.botUsername}</p>}
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed" disabled={telegram?.busy} onClick={checkTelegram}>
            <span className="material-symbols-outlined text-lg" aria-hidden="true">sync</span>Kiểm tra lại
          </button>
          <button type="button" className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed" disabled={telegram?.state !== 'CONNECTED'} onClick={sendTelegramTest}>
            <span className="material-symbols-outlined text-lg" aria-hidden="true">send</span>Gửi tin thử
          </button>
          {telegramSend && <Badge tone={telegramSend.tone}>{telegramSend.label}</Badge>}
        </div>
      </IntegrationCard>

      <IntegrationCard icon="account_balance" title="SePay" description="Nhận biến động số dư và tự khớp thanh toán học phí."
        status={!sepay ? <Badge tone="idle">Đang tải...</Badge>
          : sepay.webhookKeySet ? <Badge tone="ok">Đã cấu hình</Badge> : <Badge tone="error">Thiếu webhook key</Badge>}>
        {sepay && (
          <ul className="text-sm text-on-surface-variant space-y-1">
            <li>Kiểm tra IP SePay: <b>{sepay.ipCheck ? 'Bật' : 'Tắt'}</b></li>
            <li>Báo phụ huynh khi nhận tiền: <b>{sepay.notifyParents ? 'Bật' : 'Tắt (chỉ ghi log)'}</b></li>
            <li>Báo Zalo cho quản trị viên: <b>{sepay.notifyAdminZalo ? 'Bật' : 'Tắt'}</b></li>
          </ul>
        )}
      </IntegrationCard>

      <IntegrationCard icon="chat" title="Zalo ZNS" description="Gửi tin thông báo học phí cho phụ huynh."
        status={!zns ? <Badge tone="idle">Đang tải...</Badge>
          : zns.enabled ? <Badge tone="ok">Đang bật</Badge> : <Badge tone="warn">Chưa hoạt động</Badge>}>
        {zns && (
          <ul className="text-sm text-on-surface-variant space-y-1">
            <li>App ID: <b>{zns.appIdSet ? 'Có' : 'Chưa có'}</b> · Access token: <b>{zns.accessTokenSet ? 'Có' : 'Chưa có'}</b></li>
            <li>Refresh token: <b>{zns.refreshTokenSet ? 'Có' : 'Chưa có'}</b> · Webhook secret: <b>{zns.webhookSecretSet ? 'Có' : 'Chưa có'}</b></li>
          </ul>
        )}
        <Link to="/zns" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          Quản lý template ZNS<span className="material-symbols-outlined text-lg" aria-hidden="true">chevron_right</span>
        </Link>
      </IntegrationCard>
    </div>
  )
}
