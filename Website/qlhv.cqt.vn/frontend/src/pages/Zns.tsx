import React, { useEffect, useMemo, useState } from 'react'
import TopBar from '../components/TopBar'
import api from '../services/api'

// =============================================================
// Trang quản trị ZNS — chỉ ADMIN truy cập
// =============================================================
// Tab "Templates" : map templateId Zalo cấp ↔ paramKeys + use case
// Tab "Test gửi"  : gửi 1 tin thử tới SĐT bất kỳ
// Tab "Lịch sử"   : xem log gửi, filter theo use case + status
// Tab "Cấu hình"  : kiểm tra env vars đã set chưa

type UseCase = 'A' | 'B' | 'C' | 'TEST'
type LogStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'phone_invalid'

interface ZnsTemplate {
  id: string
  name: string
  useCase: UseCase
  paramKeys: string[]
  cost: number
  active: boolean
  note?: string
  createdAt?: string
  updatedAt?: string
}

interface ZnsLog {
  id: string
  studentId?: string
  parentPhone: string
  parentPhoneIntl: string
  templateId: string
  useCase: UseCase
  invoiceId?: string
  reminderCount?: number
  params: Record<string, string>
  status: LogStatus
  msgId?: string | null
  error?: string | null
  trackingId?: string
  createdAt?: string
  sentAt?: string
  deliveredAt?: string
}

const USE_CASE_LABEL: Record<UseCase, string> = {
  A:    'A — Thông báo học phí mới',
  B:    'B — Xác nhận đã thanh toán',
  C:    'C — Nhắc nhở học phí quá hạn',
  TEST: 'TEST — Thử nghiệm',
}

const USE_CASE_PARAMS: Record<UseCase, string[]> = {
  A: ['ten_hoc_vien','thang_nam','so_buoi','don_gia','tong_tien','han_thanh_toan','ma_phieu','student_id'],
  B: ['ten_hoc_vien','thang_nam','so_tien_da_nhan','thoi_gian_nhan','ma_phieu'],
  C: ['ten_hoc_vien','thang_nam','so_tien_can_thanh_toan','so_ngay_qua_han','ma_phieu','student_id'],
  TEST: [],
}

const STATUS_TONE: Record<LogStatus, string> = {
  queued:        'bg-slate-100 text-slate-700',
  sent:          'bg-sky-100 text-sky-700',
  delivered:     'bg-emerald-100 text-emerald-700',
  failed:        'bg-rose-100 text-rose-700',
  phone_invalid: 'bg-amber-100 text-amber-700',
}

const fmtDateTime = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

const fmtVnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' đ'

// =============================================================
// Tab: Templates
// =============================================================

function TemplatesPanel({ onTest }: { onTest: (t: ZnsTemplate) => void }) {
  const [items, setItems] = useState<ZnsTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<ZnsTemplate | null>(null)
  const [showForm, setShowForm] = useState(false)

  const load = async () => {
    setLoading(true); setErr(null)
    try {
      const r = await api.get<{ data: ZnsTemplate[] }>('/zns/templates')
      setItems(r.data.data)
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Không tải được templates')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Xoá template "${id}"?`)) return
    try {
      await api.delete(`/zns/templates/${id}`)
      load()
    } catch (e: any) {
      alert(e?.response?.data?.message ?? 'Lỗi xoá template')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Sau khi Zalo duyệt template trên ZCA portal, copy <span className="font-mono">templateId</span> + danh sách biến vào đây để hệ thống dùng được.
        </p>
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <span className="material-symbols-outlined text-base">add</span>
          Thêm template
        </button>
      </div>

      {err && <div className="bg-rose-50 text-rose-700 px-4 py-3 rounded-lg text-sm">{err}</div>}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className="px-4 py-3 font-medium text-slate-600">Template ID</th>
              <th className="px-4 py-3 font-medium text-slate-600">Tên</th>
              <th className="px-4 py-3 font-medium text-slate-600">Use case</th>
              <th className="px-4 py-3 font-medium text-slate-600">Biến</th>
              <th className="px-4 py-3 font-medium text-slate-600">Cost</th>
              <th className="px-4 py-3 font-medium text-slate-600">Trạng thái</th>
              <th className="px-4 py-3 font-medium text-slate-600 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Đang tải...</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Chưa có template nào</td></tr>
            )}
            {items.map(t => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{t.id}</td>
                <td className="px-4 py-3">{t.name}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs">{t.useCase}</span></td>
                <td className="px-4 py-3 text-xs text-slate-600">{t.paramKeys.join(', ')}</td>
                <td className="px-4 py-3">{t.cost > 0 ? fmtVnd(t.cost) : '—'}</td>
                <td className="px-4 py-3">
                  {t.active
                    ? <span className="text-emerald-700 text-xs font-medium">Đang dùng</span>
                    : <span className="text-slate-400 text-xs">Đã tắt</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onTest(t)}
                    className="text-xs px-2 py-1 text-sky-700 hover:bg-sky-50 rounded"
                    title="Gửi test"
                  >
                    <span className="material-symbols-outlined text-base align-middle">send</span>
                  </button>
                  <button
                    onClick={() => { setEditing(t); setShowForm(true) }}
                    className="text-xs px-2 py-1 text-slate-700 hover:bg-slate-100 rounded ml-1"
                    title="Sửa"
                  >
                    <span className="material-symbols-outlined text-base align-middle">edit</span>
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="text-xs px-2 py-1 text-rose-600 hover:bg-rose-50 rounded ml-1"
                    title="Xoá"
                  >
                    <span className="material-symbols-outlined text-base align-middle">delete</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <TemplateFormModal
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load() }}
        />
      )}
    </div>
  )
}

function TemplateFormModal({
  initial, onClose, onSaved,
}: {
  initial: ZnsTemplate | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!initial
  const [id, setId] = useState(initial?.id ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [useCase, setUseCase] = useState<UseCase>(initial?.useCase ?? 'A')
  const [paramKeysStr, setParamKeysStr] = useState((initial?.paramKeys ?? USE_CASE_PARAMS[initial?.useCase ?? 'A']).join(', '))
  const [cost, setCost] = useState(initial?.cost ?? 250)
  const [active, setActive] = useState(initial?.active ?? true)
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fillSuggested = () => {
    setParamKeysStr(USE_CASE_PARAMS[useCase].join(', '))
  }

  const handleSave = async () => {
    if (!id || !name) {
      setErr('templateId và tên là bắt buộc')
      return
    }
    setSaving(true); setErr(null)
    try {
      await api.post('/zns/templates', {
        id: id.trim(),
        name: name.trim(),
        useCase,
        paramKeys: paramKeysStr.split(',').map(s => s.trim()).filter(Boolean),
        cost: Number(cost) || 0,
        active,
        note: note.trim(),
      })
      onSaved()
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Lỗi lưu template')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4">
        <h3 className="text-lg font-semibold">{isEdit ? 'Sửa template' : 'Thêm template'}</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Template ID (Zalo cấp) *</label>
            <input
              value={id} onChange={e => setId(e.target.value)} disabled={isEdit}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg disabled:bg-slate-50"
              placeholder="VD: 123456"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tên gọi *</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              placeholder="VD: Thông báo học phí tháng"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Use case *</label>
            <select
              value={useCase} onChange={e => setUseCase(e.target.value as UseCase)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg"
            >
              {(Object.keys(USE_CASE_LABEL) as UseCase[]).map(uc => (
                <option key={uc} value={uc}>{USE_CASE_LABEL[uc]}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-600">Param keys (cách nhau bằng dấu phẩy)</label>
              <button
                type="button" onClick={fillSuggested}
                className="text-xs text-blue-600 hover:underline"
              >
                Dùng gợi ý cho use case này
              </button>
            </div>
            <textarea
              value={paramKeysStr} onChange={e => setParamKeysStr(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono text-xs"
              placeholder="ten_hoc_vien, thang_nam, ..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cost / tin (đ)</label>
              <input
                type="number" value={cost} onChange={e => setCost(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox" checked={active}
                  onChange={e => setActive(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm">Đang dùng</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
            <input
              value={note} onChange={e => setNote(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              placeholder="VD: nội dung template..."
            />
          </div>

          {err && <div className="bg-rose-50 text-rose-700 px-3 py-2 rounded text-xs">{err}</div>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg">Huỷ</button>
          <button
            onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================
// Tab: Test send
// =============================================================

function TestSendModal({
  template, onClose,
}: {
  template: ZnsTemplate | null
  onClose: () => void
}) {
  const [phone, setPhone] = useState('')
  const [templateId, setTemplateId] = useState(template?.id ?? '')
  const [paramVals, setParamVals] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ success?: boolean; error?: string; msgId?: string; logId?: string; enabled?: boolean } | null>(null)

  const keys = template?.paramKeys ?? []

  useEffect(() => {
    setTemplateId(template?.id ?? '')
    const init: Record<string, string> = {}
    for (const k of keys) init[k] = ''
    setParamVals(init)
  }, [template?.id])

  const handleSend = async () => {
    setSending(true); setResult(null)
    try {
      const r = await api.post('/zns/test-send', {
        phone: phone.trim(),
        templateId: templateId.trim(),
        params: paramVals,
      })
      setResult(r.data)
    } catch (e: any) {
      setResult({ success: false, error: e?.response?.data?.message ?? 'Lỗi gửi' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">Test gửi ZNS</h3>

        {template && (
          <div className="bg-slate-50 px-3 py-2 rounded-lg text-sm">
            <div><span className="text-slate-500">Template:</span> {template.name}</div>
            <div className="text-xs text-slate-500 font-mono">{template.id}</div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">SĐT phụ huynh *</label>
          <input
            value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="VD: 0901234567"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg"
          />
        </div>

        {!template && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Template ID *</label>
            <input
              value={templateId} onChange={e => setTemplateId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono"
            />
          </div>
        )}

        {keys.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600">Tham số:</p>
            {keys.map(k => (
              <div key={k}>
                <label className="block text-xs text-slate-500 font-mono mb-0.5">{`{{${k}}}`}</label>
                <input
                  value={paramVals[k] ?? ''}
                  onChange={e => setParamVals(prev => ({ ...prev, [k]: e.target.value }))}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded text-sm"
                />
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className={`px-3 py-2 rounded-lg text-sm ${result.success ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
            {result.success
              ? <>✅ Gửi thành công. msgId: <span className="font-mono text-xs">{result.msgId}</span></>
              : <>❌ {result.error ?? 'Lỗi không xác định'}{result.enabled === false && ' (ZNS chưa cấu hình env vars)'}</>}
            {result.logId && <div className="text-xs text-slate-500 mt-1">Log: {result.logId}</div>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg">Đóng</button>
          <button
            onClick={handleSend} disabled={sending || !phone || !templateId}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? 'Đang gửi...' : 'Gửi'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================
// Tab: Logs
// =============================================================

function LogsPanel() {
  const [logs, setLogs] = useState<ZnsLog[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filterUseCase, setFilterUseCase] = useState<'' | UseCase>('')
  const [filterStatus, setFilterStatus] = useState<'' | LogStatus>('')
  const [detail, setDetail] = useState<ZnsLog | null>(null)

  const load = async () => {
    setLoading(true); setErr(null)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (filterUseCase) params.set('useCase', filterUseCase)
      if (filterStatus)  params.set('status', filterStatus)
      const r = await api.get<{ data: ZnsLog[] }>(`/zns/logs?${params.toString()}`)
      setLogs(r.data.data)
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Không tải được logs')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [filterUseCase, filterStatus])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select
          value={filterUseCase} onChange={e => setFilterUseCase(e.target.value as any)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
        >
          <option value="">Tất cả use case</option>
          {(Object.keys(USE_CASE_LABEL) as UseCase[]).map(uc => (
            <option key={uc} value={uc}>{USE_CASE_LABEL[uc]}</option>
          ))}
        </select>
        <select
          value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="queued">Đang chờ</option>
          <option value="sent">Đã gửi</option>
          <option value="delivered">Đã nhận</option>
          <option value="failed">Lỗi</option>
          <option value="phone_invalid">SĐT không hợp lệ</option>
        </select>
        <button onClick={load} className="px-3 py-2 text-sm hover:bg-slate-100 rounded-lg">
          <span className="material-symbols-outlined text-base align-middle">refresh</span>
        </button>
      </div>

      {err && <div className="bg-rose-50 text-rose-700 px-4 py-3 rounded-lg text-sm">{err}</div>}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className="px-4 py-3 font-medium text-slate-600">Thời gian</th>
              <th className="px-4 py-3 font-medium text-slate-600">Use case</th>
              <th className="px-4 py-3 font-medium text-slate-600">SĐT</th>
              <th className="px-4 py-3 font-medium text-slate-600">Template</th>
              <th className="px-4 py-3 font-medium text-slate-600">Trạng thái</th>
              <th className="px-4 py-3 font-medium text-slate-600 text-right">Chi tiết</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Đang tải...</td></tr>}
            {!loading && logs.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Chưa có log</td></tr>}
            {logs.map(l => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-xs text-slate-600">{fmtDateTime(l.sentAt || l.createdAt)}</td>
                <td className="px-4 py-3 text-xs">{l.useCase}</td>
                <td className="px-4 py-3 text-xs font-mono">{l.parentPhone}</td>
                <td className="px-4 py-3 text-xs font-mono">{l.templateId}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${STATUS_TONE[l.status]}`}>{l.status}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setDetail(l)} className="text-xs text-blue-600 hover:underline">Xem</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && <LogDetailModal log={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function LogDetailModal({ log, onClose }: { log: ZnsLog; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 p-6 space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">Chi tiết log ZNS</h3>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <dt className="text-slate-500">Status</dt>
          <dd className="col-span-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_TONE[log.status]}`}>{log.status}</span></dd>
          <dt className="text-slate-500">Use case</dt><dd className="col-span-2">{log.useCase}</dd>
          <dt className="text-slate-500">SĐT</dt><dd className="col-span-2 font-mono">{log.parentPhone} → {log.parentPhoneIntl}</dd>
          <dt className="text-slate-500">Template</dt><dd className="col-span-2 font-mono">{log.templateId}</dd>
          {log.studentId && (<><dt className="text-slate-500">Student ID</dt><dd className="col-span-2 font-mono">{log.studentId}</dd></>)}
          {log.invoiceId && (<><dt className="text-slate-500">Invoice ID</dt><dd className="col-span-2 font-mono">{log.invoiceId}</dd></>)}
          {log.reminderCount != null && (<><dt className="text-slate-500">Reminder #</dt><dd className="col-span-2">{log.reminderCount}</dd></>)}
          {log.msgId && (<><dt className="text-slate-500">Msg ID</dt><dd className="col-span-2 font-mono">{log.msgId}</dd></>)}
          {log.error && (<><dt className="text-slate-500">Lỗi</dt><dd className="col-span-2 text-rose-700 text-xs">{log.error}</dd></>)}
          <dt className="text-slate-500">Tạo lúc</dt><dd className="col-span-2 text-xs">{fmtDateTime(log.createdAt)}</dd>
          {log.sentAt && (<><dt className="text-slate-500">Gửi lúc</dt><dd className="col-span-2 text-xs">{fmtDateTime(log.sentAt)}</dd></>)}
          {log.deliveredAt && (<><dt className="text-slate-500">Nhận lúc</dt><dd className="col-span-2 text-xs">{fmtDateTime(log.deliveredAt)}</dd></>)}
        </dl>
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">Tham số gửi:</p>
          <pre className="bg-slate-50 px-3 py-2 rounded text-xs overflow-x-auto">{JSON.stringify(log.params, null, 2)}</pre>
        </div>
        <div className="flex justify-end">
          <button onClick={onClose} className="px-4 py-2 hover:bg-slate-100 rounded-lg">Đóng</button>
        </div>
      </div>
    </div>
  )
}

// =============================================================
// Tab: Status
// =============================================================

interface ZnsStatusInfo {
  enabled: boolean
  appIdSet: boolean
  accessTokenSet: boolean
  refreshTokenSet: boolean
  webhookSecretSet: boolean
}

function StatusPanel() {
  const [status, setStatus] = useState<ZnsStatusInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<ZnsStatusInfo>('/zns/status')
      .then(r => setStatus(r.data))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-slate-400">Đang kiểm tra...</div>

  const Row = ({ label, ok }: { label: string; ok: boolean }) => (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-b-0">
      <span className="text-sm text-slate-700">{label}</span>
      <span className={ok ? 'text-emerald-600' : 'text-amber-600'}>
        <span className="material-symbols-outlined text-base align-middle">
          {ok ? 'check_circle' : 'warning'}
        </span>
      </span>
    </div>
  )

  return (
    <div className="max-w-lg">
      <div className={`px-4 py-3 rounded-lg mb-4 text-sm ${status?.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
        {status?.enabled
          ? <>✅ ZNS đang hoạt động — backend có thể gửi tin.</>
          : <>⚠️ ZNS chưa cấu hình đủ. Chưa thể gửi tin thật. Set env vars trên Vercel + redeploy.</>}
      </div>
      <div className="bg-white rounded-2xl shadow-sm">
        <Row label="ZNS_APP_ID"        ok={!!status?.appIdSet} />
        <Row label="ZNS_ACCESS_TOKEN"  ok={!!status?.accessTokenSet} />
        <Row label="ZNS_REFRESH_TOKEN" ok={!!status?.refreshTokenSet} />
        <Row label="ZNS_WEBHOOK_SECRET (tuỳ chọn)" ok={!!status?.webhookSecretSet} />
      </div>
      <p className="text-xs text-slate-500 mt-3">
        Đăng ký ZCA app + lấy credentials tại <a href="https://developers.zalo.me" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">developers.zalo.me</a>.
        Sau đó thêm vào Vercel Environment Variables (Production) rồi redeploy backend.
      </p>
    </div>
  )
}

// =============================================================
// Page
// =============================================================

type Tab = 'templates' | 'logs' | 'status'

export default function Zns() {
  const [tab, setTab] = useState<Tab>('templates')
  const [testTemplate, setTestTemplate] = useState<ZnsTemplate | null>(null)
  const [showTest, setShowTest] = useState(false)

  const tabs: { value: Tab; label: string; icon: string }[] = useMemo(() => ([
    { value: 'templates', label: 'Templates', icon: 'description' },
    { value: 'logs',      label: 'Lịch sử',  icon: 'history' },
    { value: 'status',    label: 'Cấu hình', icon: 'settings' },
  ]), [])

  return (
    <>
      <TopBar title="Thông báo Zalo (ZNS)" />
      <main className="px-8 py-6 space-y-6">
        <div className="flex items-center gap-2 border-b border-slate-200">
          {tabs.map(t => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={
                tab === t.value
                  ? 'flex items-center gap-2 px-4 py-2 border-b-2 border-blue-600 text-blue-600 font-medium text-sm'
                  : 'flex items-center gap-2 px-4 py-2 border-b-2 border-transparent text-slate-600 hover:text-blue-500 text-sm'
              }
            >
              <span className="material-symbols-outlined text-base">{t.icon}</span>
              {t.label}
            </button>
          ))}
          <div className="ml-auto">
            <button
              onClick={() => { setTestTemplate(null); setShowTest(true) }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50 rounded-lg"
            >
              <span className="material-symbols-outlined text-base">send</span>
              Test gửi nhanh
            </button>
          </div>
        </div>

        {tab === 'templates' && (
          <TemplatesPanel onTest={(t) => { setTestTemplate(t); setShowTest(true) }} />
        )}
        {tab === 'logs' && <LogsPanel />}
        {tab === 'status' && <StatusPanel />}

        {showTest && (
          <TestSendModal template={testTemplate} onClose={() => setShowTest(false)} />
        )}
      </main>
    </>
  )
}
