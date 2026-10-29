import React, { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, useParams } from 'react-router-dom'
import TopBar from '../components/TopBar'
import Toast, { ToastMessage } from '../components/Toast'
import { useAlert, useConfirm, usePrompt } from '../components/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import api from '../services/api'
import { User } from '../types'
import Teachers from './Teachers'

type Role = User['role']
type Notify = (message: string, type?: ToastMessage['type']) => void

const SECTIONS: { key: string; icon: string; label: string; adminOnly?: boolean }[] = [
  { key: 'account', icon: 'account_circle', label: 'Tài khoản của tôi' },
  { key: 'users', icon: 'manage_accounts', label: 'Người dùng', adminOnly: true },
  { key: 'teachers', icon: 'badge', label: 'Giáo viên', adminOnly: true },
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
      {action}
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
      <SectionHeader title="Tài khoản của tôi" description="Thông tin hiển thị và mật khẩu đăng nhập của bạn." />
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

// ─── Người dùng ──────────────────────────────────────────────

interface AppUser {
  id: string
  username: string
  fullName: string
  email?: string | null
  role: Role
  isActive: boolean
  teacher?: { id: string; fullName: string } | null
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
              <th className="table-header">Vai trò</th>
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
                <td className="table-cell text-sm">{ROLE_LABEL[u.role]}</td>
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

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="responsive-dialog fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
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
  const [teachers, setTeachers] = useState<{ id: string; fullName: string; userId?: string | null }[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) api.get('/teachers').then(r => setTeachers(r.data.filter((t: { userId?: string | null }) => !t.userId))).catch(() => {})
  }, [editing])

  const submit = async () => {
    setSaving(true)
    try {
      if (editing) await api.put(`/users/${editing.id}`, { fullName: form.fullName, email: form.email, role: form.role })
      else await api.post('/users', { ...form, teacherId: form.role === 'TEACHER' ? form.teacherId || undefined : undefined })
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
