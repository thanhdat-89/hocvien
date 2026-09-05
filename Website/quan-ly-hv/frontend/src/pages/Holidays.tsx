import React, { useState, useEffect } from 'react'
import api from '../services/api'
import TopBar from '../components/TopBar'

interface Holiday {
  id: string
  name: string
  date: string
  description?: string
  createdAt: string
}

export default function Holidays() {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; holiday: Holiday | null }>({ open: false, holiday: null })
  
  const [formData, setFormData] = useState({ name: '', date: '', description: '' })
  const [restoreSessions, setRestoreSessions] = useState(false)
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const toast = (type: 'success' | 'error', text: string) => {
    setToastMsg({ type, text })
    setTimeout(() => setToastMsg(null), 3500)
  }

  const fetchHolidays = async () => {
    try {
      setLoading(true)
      const res = await api.get('/holidays')
      setHolidays(res.data)
    } catch (err: any) {
      toast('error', err.response?.data?.message || 'Lỗi khi tải danh sách ngày nghỉ lễ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHolidays()
  }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.date) {
      toast('error', 'Vui lòng nhập đủ tên và ngày')
      return
    }
    try {
      const res = await api.post('/holidays', formData)
      toast('success', res.data.message || 'Thêm ngày nghỉ lễ thành công')
      setShowAddModal(false)
      setFormData({ name: '', date: '', description: '' })
      fetchHolidays()
    } catch (err: any) {
      toast('error', err.response?.data?.message || 'Lỗi khi thêm ngày nghỉ lễ')
    }
  }

  const confirmDelete = (holiday: Holiday) => {
    setRestoreSessions(false)
    setDeleteModal({ open: true, holiday })
  }

  const handleDelete = async () => {
    const { holiday } = deleteModal
    if (!holiday) return
    try {
      const res = await api.delete(`/holidays/${holiday.id}?restoreSessions=${restoreSessions}`)
      toast('success', res.data.message || 'Xóa ngày nghỉ lễ thành công')
      setDeleteModal({ open: false, holiday: null })
      fetchHolidays()
    } catch (err: any) {
      toast('error', err.response?.data?.message || 'Lỗi khi xóa ngày nghỉ lễ')
    }
  }

  return (
    <div className="flex-1 flex flex-col h-screen bg-surface overflow-hidden">
      <TopBar title="Lịch nghỉ lễ" />
      
      <main className="flex-1 overflow-auto p-4 lg:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold font-headline text-on-surface">Danh sách ngày nghỉ lễ</h2>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-xl font-semibold shadow-sm hover:bg-primary-dim transition-colors"
            >
              <span className="material-symbols-outlined">add</span>
              Thêm ngày nghỉ
            </button>
          </div>

          <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/30 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-on-surface-variant">Đang tải dữ liệu...</div>
            ) : holidays.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-on-surface-variant">
                <span className="material-symbols-outlined text-5xl opacity-50 mb-4">event_busy</span>
                <p>Chưa có ngày nghỉ lễ nào được cấu hình</p>
              </div>
            ) : (
              <div className="divide-y divide-outline-variant/30">
                {holidays.map(h => {
                  const dateObj = new Date(h.date)
                  const isPast = dateObj < new Date(new Date().setHours(0,0,0,0))
                  
                  return (
                    <div key={h.id} className={`p-4 flex items-center gap-4 ${isPast ? 'opacity-60' : ''}`}>
                      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex flex-col items-center justify-center text-primary flex-shrink-0">
                        <span className="text-xs font-bold uppercase">{dateObj.toLocaleDateString('vi-VN', { month: 'short' })}</span>
                        <span className="text-xl font-black leading-none">{dateObj.getDate()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-on-surface text-lg truncate">{h.name}</h3>
                        <p className="text-sm text-on-surface-variant truncate">
                          {dateObj.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                          {h.description && ` • ${h.description}`}
                        </p>
                      </div>
                      <button
                        onClick={() => confirmDelete(h)}
                        className="w-10 h-10 rounded-full flex items-center justify-center text-error hover:bg-error/10 transition-colors"
                        title="Xóa"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modal Thêm */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-outline-variant/30 flex justify-between items-center">
              <h2 className="text-lg font-bold text-on-surface">Thêm ngày nghỉ lễ</h2>
              <button onClick={() => setShowAddModal(false)} className="text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <form onSubmit={handleAdd} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Tên ngày lễ *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="VD: Nghỉ Tết Nguyên Đán, Giỗ Tổ Hùng Vương..."
                  className="w-full bg-surface border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Ngày *</label>
                <input
                  type="date"
                  required
                  value={formData.date}
                  onChange={e => setFormData({ ...formData, date: e.target.value })}
                  className="w-full bg-surface border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Mô tả thêm (Tùy chọn)</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full bg-surface border border-outline-variant/30 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="pt-2">
                <div className="p-3 bg-secondary-container text-on-secondary-container rounded-lg text-sm flex items-start gap-2">
                  <span className="material-symbols-outlined text-lg shrink-0">info</span>
                  <p>Khi thêm ngày nghỉ, tất cả các buổi học (cả lớp chung và học riêng) rơi vào ngày này sẽ tự động bị <b>Hủy</b> và học sinh sẽ không bị tính học phí.</p>
                </div>
              </div>

              <div className="pt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-primary text-on-primary font-semibold rounded-xl hover:bg-primary-dim transition-all shadow-sm"
                >
                  Xác nhận
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Xóa có Popup Hỏi */}
      {deleteModal.open && deleteModal.holiday && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteModal({ open: false, holiday: null })} />
          <div className="relative bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-error">warning</span>
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold font-headline text-on-surface">Xóa ngày nghỉ lễ</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed mt-1">
                  Bạn có chắc chắn muốn xóa ngày nghỉ lễ <b>{deleteModal.holiday.name}</b> không?
                </p>
              </div>
            </div>

            <div className="pl-13 mt-2 space-y-2">
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative flex items-center justify-center w-5 h-5 mt-0.5">
                  <input
                    type="checkbox"
                    checked={restoreSessions}
                    onChange={(e) => setRestoreSessions(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-outline rounded flex items-center justify-center peer-checked:bg-primary peer-checked:border-primary transition-colors">
                    <span className="material-symbols-outlined text-[14px] text-on-primary opacity-0 peer-checked:opacity-100 font-bold transition-opacity">check</span>
                  </div>
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-on-surface block">Tự động khôi phục các buổi học</span>
                  <span className="text-on-surface-variant text-xs">Hệ thống sẽ chuyển các buổi học đã bị hủy bởi ngày lễ này về trạng thái "Sắp tới" (SCHEDULED).</span>
                </div>
              </label>
            </div>
            
            <div className="flex gap-3 justify-end pt-3">
              <button
                onClick={() => setDeleteModal({ open: false, holiday: null })}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleDelete}
                className="px-5 py-2 bg-error text-on-error font-semibold rounded-xl hover:opacity-90 transition-all shadow-sm active:scale-95 text-sm"
              >
                Tiến hành xóa
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Toast notification */}
      {toastMsg && (
        <div className={`fixed bottom-6 right-6 z-[200] px-5 py-3 rounded-xl shadow-lg text-sm font-semibold text-white transition-all ${toastMsg.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toastMsg.text}
        </div>
      )}
    </div>
  )
}
