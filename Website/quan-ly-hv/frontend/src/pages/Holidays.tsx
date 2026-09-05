import React, { useState, useEffect } from 'react'
import api from '../services/api'
import TopBar from '../components/TopBar'

interface Holiday {
  id: string
  name: string
  date: string
  startDate?: string
  endDate?: string
  dates?: string[]
  description?: string
  createdAt: string
}

export default function Holidays() {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; holiday: Holiday | null }>({ open: false, holiday: null })
  
  const [formData, setFormData] = useState({ name: '', startDate: '', endDate: '', description: '' })
  const [restoreSessions, setRestoreSessions] = useState(false)
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const toast = (type: 'success' | 'error', text: string) => {
    setToastMsg({ type, text })
    setTimeout(() => setToastMsg(null), 3500)
  }

  const formatDateVN = (dStr?: string) => {
    if (!dStr) return ''
    const parts = dStr.split('-')
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`
    }
    return dStr
  }

  const getDurationDays = (start: string, end: string) => {
    if (!start) return 0
    if (!end || end === start) return 1
    const s = new Date(start).getTime()
    const e = new Date(end).getTime()
    if (isNaN(s) || isNaN(e) || e < s) return 0
    return Math.round((e - s) / (1000 * 3600 * 24)) + 1
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

  const handleStartDateChange = (val: string) => {
    setFormData(prev => ({
      ...prev,
      startDate: val,
      endDate: !prev.endDate || prev.endDate < val ? val : prev.endDate
    }))
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const { name, startDate, endDate, description } = formData
    if (!name.trim() || !startDate) {
      toast('error', 'Vui lòng nhập tên và ngày bắt đầu nghỉ lễ')
      return
    }

    const effectiveEnd = endDate || startDate
    if (startDate > effectiveEnd) {
      toast('error', 'Ngày kết thúc không được nhỏ hơn ngày bắt đầu')
      return
    }

    try {
      const res = await api.post('/holidays', {
        name: name.trim(),
        startDate,
        endDate: effectiveEnd,
        description: description.trim()
      })
      toast('success', res.data.message || 'Thêm ngày nghỉ lễ thành công')
      setShowAddModal(false)
      setFormData({ name: '', startDate: '', endDate: '', description: '' })
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

  const durationDays = getDurationDays(formData.startDate, formData.endDate || formData.startDate)

  return (
    <div className="flex-1 flex flex-col h-screen bg-surface overflow-hidden">
      <TopBar title="Lịch nghỉ lễ" />
      
      <main className="flex-1 overflow-auto p-4 lg:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold font-headline text-on-surface">Danh sách ngày nghỉ lễ</h2>
              <p className="text-sm text-on-surface-variant">Cấu hình các ngày hoặc giai đoạn nghỉ lễ, Tết của trung tâm</p>
            </div>
            <button
              onClick={() => {
                setFormData({ name: '', startDate: '', endDate: '', description: '' })
                setShowAddModal(true)
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-on-primary rounded-xl font-semibold shadow-sm hover:bg-primary-dim transition-colors"
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
                  const start = h.startDate || h.date
                  const end = h.endDate || h.date || start
                  const isRange = start !== end
                  const totalDays = h.dates?.length || getDurationDays(start, end)
                  
                  const endObj = new Date(end + 'T23:59:59')
                  const isPast = endObj < new Date()
                  const startObj = new Date(start + 'T00:00:00')
                  
                  return (
                    <div key={h.id} className={`p-4 flex items-center gap-4 hover:bg-surface-container-low/40 transition-colors ${isPast ? 'opacity-60' : ''}`}>
                      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-700 border border-blue-200/60 flex flex-col items-center justify-center flex-shrink-0">
                        {isRange ? (
                          <>
                            <span className="material-symbols-outlined text-xl">date_range</span>
                            <span className="text-[11px] font-bold">{totalDays} ngày</span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs font-bold uppercase">{startObj.toLocaleDateString('vi-VN', { month: 'short' })}</span>
                            <span className="text-xl font-black leading-none">{startObj.getDate()}</span>
                          </>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-on-surface text-base truncate">{h.name}</h3>
                          {isRange && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                              Nghỉ {totalDays} ngày
                            </span>
                          )}
                          {isPast && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                              Đã qua
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-on-surface-variant truncate mt-0.5">
                          {isRange ? (
                            <span>Từ <b>{formatDateVN(start)}</b> đến <b>{formatDateVN(end)}</b></span>
                          ) : (
                            <span>{startObj.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                          )}
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

      {/* Modal Thêm theo giai đoạn */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-outline-variant/30 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-on-surface">Thêm ngày nghỉ lễ</h2>
                <p className="text-xs text-on-surface-variant">Chọn ngày đơn lẻ hoặc giai đoạn nghỉ liên tiếp</p>
              </div>
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
                  placeholder="VD: Nghỉ Tết Nguyên Đán, Giỗ Tổ Hùng Vương, Nghỉ lễ 30/4 - 1/5..."
                  className="w-full bg-surface border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-on-surface mb-1">Ngày bắt đầu *</label>
                  <input
                    type="date"
                    required
                    value={formData.startDate}
                    onChange={e => handleStartDateChange(e.target.value)}
                    className="w-full bg-surface border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-on-surface mb-1">Ngày kết thúc *</label>
                  <input
                    type="date"
                    required
                    value={formData.endDate}
                    min={formData.startDate}
                    onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full bg-surface border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              {formData.startDate && (
                <div className="text-xs">
                  {formData.endDate && formData.endDate < formData.startDate ? (
                    <span className="text-error font-medium">⚠️ Ngày kết thúc không được nhỏ hơn ngày bắt đầu</span>
                  ) : (
                    <div className="flex items-center gap-1.5 text-blue-700 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200/60 font-medium">
                      <span className="material-symbols-outlined text-base">calendar_today</span>
                      <span>
                        Thời gian nghỉ: <b>{durationDays} ngày</b> (từ {formatDateVN(formData.startDate)} đến {formatDateVN(formData.endDate || formData.startDate)})
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Mô tả thêm (Tùy chọn)</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Ghi chú thêm về thông báo hoặc kế hoạch dạy bù nếu có..."
                  rows={3}
                  className="w-full bg-surface border border-outline-variant/30 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="pt-2">
                <div className="p-3 bg-secondary-container/40 text-on-secondary-container rounded-xl text-sm flex items-start gap-2 border border-outline-variant/30">
                  <span className="material-symbols-outlined text-lg shrink-0 text-blue-600">info</span>
                  <p className="text-xs leading-relaxed">
                    Khi thêm ngày nghỉ lễ, tất cả các buổi học (cả lớp chung và học riêng) rơi vào toàn bộ giai đoạn này sẽ tự động được chuyển sang trạng thái <b>Hủy</b> và học sinh sẽ không bị tính học phí.
                  </p>
                </div>
              </div>

              <div className="pt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-primary text-on-primary font-semibold rounded-xl hover:bg-primary-dim transition-all shadow-sm"
                >
                  Xác nhận
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Xóa */}
      {deleteModal.open && deleteModal.holiday && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteModal({ open: false, holiday: null })} />
          <div className="relative bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-error">warning</span>
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold font-headline text-on-surface">Xóa ngày nghỉ lễ</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed mt-1">
                  Bạn có chắc chắn muốn xóa ngày nghỉ lễ <b>{deleteModal.holiday.name}</b> {deleteModal.holiday.startDate && deleteModal.holiday.endDate && deleteModal.holiday.startDate !== deleteModal.holiday.endDate ? `(từ ${formatDateVN(deleteModal.holiday.startDate)} đến ${formatDateVN(deleteModal.holiday.endDate)})` : `(${formatDateVN(deleteModal.holiday.startDate || deleteModal.holiday.date)})`} không?
                </p>
              </div>
            </div>

            <div className="mt-2 space-y-2">
              <label className="flex items-start gap-3 cursor-pointer group p-2 rounded-xl hover:bg-surface-container-low transition-colors">
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
                  <span className="text-on-surface-variant text-xs">Hệ thống sẽ chuyển các buổi học đã bị hủy bởi kỳ nghỉ lễ này về lại trạng thái "Sắp tới" (SCHEDULED).</span>
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
