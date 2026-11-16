import React, { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/TopBar'
import { useConfirm, useAlert, usePrompt } from '../components/ConfirmDialog'
import api from '../services/api'
import { Student } from '../types'
import { useAuth } from '../hooks/useAuth'
import StudentModal from './StudentModal'
import { PrivateScheduleModal } from './StudentProfile'
import * as XLSX from 'xlsx'
import { buildParentUrl } from '../lib/parentUrl'

function StatusBadge({ status }: { status: string }) {
  if (status === 'ACTIVE')
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>Đang học
      </span>
    )
  if (status === 'INACTIVE')
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>Đã nghỉ
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>Bảo lưu
    </span>
  )
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(-2).map((w) => w[0]).join('').toUpperCase()
  const colors = ['bg-blue-100 text-primary', 'bg-pink-100 text-tertiary', 'bg-green-100 text-secondary', 'bg-purple-100 text-tertiary']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div className={`w-9 h-9 rounded-full ${color} flex items-center justify-center font-semibold text-xs flex-shrink-0`}>
      {initials}
    </div>
  )
}

const PAGE_SIZE = 20

// ─── Column mapping ─────────────────────────────────────────────────────────

const FIELD_MAP: Record<string, string> = {
  'họ tên': 'fullName', 'ho ten': 'fullName', 'tên': 'fullName', 'ten': 'fullName', 'fullname': 'fullName',
  'ngày sinh': 'dateOfBirth', 'ngay sinh': 'dateOfBirth', 'dob': 'dateOfBirth', 'dateofbirth': 'dateOfBirth',
  'giới tính': 'gender', 'gioi tinh': 'gender', 'gender': 'gender',
  'trường': 'school', 'truong': 'school', 'school': 'school',
  'khối lớp': 'gradeLevel', 'khoi lop': 'gradeLevel', 'khoi': 'gradeLevel', 'gradelevel': 'gradeLevel',
  'địa chỉ': 'address', 'dia chi': 'address', 'address': 'address',
  'ghi chú': 'notes', 'ghi chu': 'notes', 'notes': 'notes',
  'phụ huynh': 'parentName', 'phu huynh': 'parentName', 'tên phụ huynh': 'parentName', 'ten phu huynh': 'parentName', 'parentname': 'parentName',
  'số điện thoại': 'parentPhone', 'so dien thoai': 'parentPhone', 'dien thoai': 'parentPhone', 'phone': 'parentPhone', 'sdt': 'parentPhone', 'parentphone': 'parentPhone',
  'lớp học đăng ký': 'className', 'lop hoc dang ky': 'className', 'lớp học': 'className', 'lop hoc': 'className', 'classname': 'className', 'class': 'className', 'tên lớp': 'className', 'ten lop': 'className',
  'ngày đăng ký': 'enrollmentDate', 'ngay dang ky': 'enrollmentDate', 'enrollmentdate': 'enrollmentDate', 'ngay nhap hoc': 'enrollmentDate', 'ngày nhập học': 'enrollmentDate',
}

interface ImportRow {
  fullName: string
  dateOfBirth?: string
  gender?: string
  school?: string
  gradeLevel?: string
  address?: string
  notes?: string
  parentName?: string
  parentPhone?: string
  className?: string
  enrollmentDate?: string
}

function normalizeHeader(h: string) {
  return h.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9 ]/g, '').trim()
}

// Chuyển DD-MM-YYYY hoặc DD/MM/YYYY → YYYY-MM-DD (ISO) để gửi lên backend
function toISO(val: string): string {
  const v = val.trim()
  // DD-MM-YYYY hoặc DD/MM/YYYY
  const m1 = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`
  // Excel serial number (number)
  if (/^\d{4,5}$/.test(v)) {
    const d = XLSX.SSF.parse_date_code(Number(v))
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`
  }
  return v // YYYY-MM-DD passthrough
}

const DATE_FIELDS = new Set(['dateOfBirth', 'enrollmentDate'])

function parseExcel(file: File): Promise<ImportRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
        if (!raw.length) { resolve([]); return }

        const rows: ImportRow[] = raw.map(rawRow => {
          const row: Record<string, string> = {}
          for (const [k, v] of Object.entries(rawRow)) {
            const norm = normalizeHeader(String(k))
            const field = FIELD_MAP[norm]
            if (field) {
              const val = String(v).trim()
              row[field] = DATE_FIELDS.has(field) && val ? toISO(val) : val
            }
          }
          return row as unknown as ImportRow
        }).filter(r => r.fullName)
        resolve(rows)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsBinaryString(file)
  })
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Họ tên *', 'Ngày sinh', 'Giới tính', 'Trường', 'Khối lớp', 'Địa chỉ', 'Ghi chú', 'Phụ huynh', 'Số điện thoại', 'Lớp học đăng ký', 'Ngày đăng ký'],
    ['Nguyễn Văn A', '15-05-2012', 'Nam', 'THCS Nguyễn Du', '7', 'Hà Nội', '', 'Nguyễn Thị B', '0987654321', 'Toán 7', '01-03-2026'],
  ])
  ws['!cols'] = [
    { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 10 },
    { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 14 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Danh sách học viên')
  XLSX.writeFile(wb, 'mau-import-hoc-vien.xlsx')
}

function ImportExcelModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const alert = useAlert()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ created: number; failed: { row: number; name: string; error: string }[] } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFile = async (file: File) => {
    try {
      const parsed = await parseExcel(file)
      setRows(parsed)
      setFileName(file.name)
      setResult(null)
    } catch {
      void alert('Không đọc được file. Vui lòng dùng file .xlsx hoặc .xls')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleImport = async () => {
    if (!rows.length) return
    setImporting(true)
    try {
      const res = await api.post('/students/bulk', { students: rows })
      setResult({ created: res.data.created, failed: res.data.failed ?? [] })
      if (res.data.created > 0) onImported()
    } catch (err: any) {
      void alert(err.response?.data?.message ?? 'Có lỗi xảy ra')
    } finally {
      setImporting(false)
    }
  }

  const FIELD_LABELS: Record<string, string> = {
    fullName: 'Họ tên', dateOfBirth: 'Ngày sinh', gender: 'Giới tính',
    school: 'Trường', gradeLevel: 'Khối lớp', address: 'Địa chỉ',
    notes: 'Ghi chú', parentName: 'Phụ huynh', parentPhone: 'SĐT PH',
    className: 'Lớp học', enrollmentDate: 'Ngày đăng ký',
  }
  const cols = ['fullName', 'gradeLevel', 'className', 'enrollmentDate', 'parentName', 'parentPhone'] as const

  return (
    <div className="responsive-dialog fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-surface-container-lowest rounded-2xl shadow-2xl z-10 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="p-6 border-b border-outline-variant/10 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-headline font-bold text-on-surface">Import học viên từ Excel</h3>
            <p className="text-sm text-outline mt-0.5">Tải file .xlsx có danh sách học viên lên để thêm hàng loạt</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary bg-primary/8 hover:bg-primary/15 rounded-lg transition-all">
              <span className="material-symbols-outlined text-[15px]">download</span>
              Tải file mẫu
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-container-low rounded-lg">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Drop zone */}
          {!rows.length && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                dragOver ? 'border-primary bg-primary/5' : 'border-outline-variant/30 hover:border-primary/40 hover:bg-surface-container-low'
              }`}
            >
              <span className="material-symbols-outlined text-5xl text-outline/40 block mb-3">upload_file</span>
              <p className="text-sm font-semibold text-on-surface-variant">Kéo thả file vào đây hoặc click để chọn</p>
              <p className="text-xs text-outline mt-1">Hỗ trợ .xlsx, .xls</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          )}

          {/* Preview */}
          {rows.length > 0 && !result && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-base">check_circle</span>
                  <p className="text-sm font-semibold text-on-surface">
                    <span className="text-secondary font-bold">{rows.length}</span> học viên từ <span className="text-outline">{fileName}</span>
                  </p>
                </div>
                <button onClick={() => { setRows([]); setFileName('') }}
                  className="text-xs text-outline hover:text-error transition-colors flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">close</span>Chọn lại
                </button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-container-low/60">
                      <th className="px-3 py-2.5 text-[10px] uppercase font-bold text-outline tracking-wider w-8">#</th>
                      {cols.map(c => (
                        <th key={c} className="px-3 py-2.5 text-[10px] uppercase font-bold text-outline tracking-wider whitespace-nowrap">
                          {FIELD_LABELS[c]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/8">
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="hover:bg-surface-container-low/30">
                        <td className="px-3 py-2 text-outline text-xs">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-on-surface whitespace-nowrap">{r.fullName || <span className="text-error">—</span>}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{r.gradeLevel ? `Lớp ${r.gradeLevel}` : '—'}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{r.className || '—'}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{r.enrollmentDate || '—'}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{r.parentName || '—'}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{r.parentPhone || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 50 && (
                  <p className="text-xs text-outline text-center py-2">...và {rows.length - 50} dòng khác</p>
                )}
              </div>
            </>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div className={`flex items-center gap-3 p-4 rounded-xl ${result.created > 0 ? 'bg-secondary-container/20' : 'bg-error-container/10'}`}>
                <span className={`material-symbols-outlined text-2xl ${result.created > 0 ? 'text-secondary' : 'text-error'}`}>
                  {result.created > 0 ? 'check_circle' : 'error'}
                </span>
                <div>
                  <p className="text-sm font-bold text-on-surface">
                    Đã thêm <span className="text-secondary">{result.created}</span> học viên thành công
                  </p>
                  {result.failed.length > 0 && (
                    <p className="text-xs text-error mt-0.5">{result.failed.length} dòng lỗi</p>
                  )}
                </div>
              </div>
              {result.failed.length > 0 && (
                <div className="rounded-xl border border-error/20 overflow-hidden">
                  <p className="text-[10px] font-bold text-error uppercase tracking-wider px-4 py-2 bg-error/5">Lỗi chi tiết</p>
                  {result.failed.map((f, i) => (
                    <div key={i} className="px-4 py-2 text-sm border-t border-error/10 flex gap-3">
                      <span className="text-outline">Dòng {f.row}</span>
                      <span className="font-medium text-on-surface">{f.name}</span>
                      <span className="text-error">{f.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="px-6 pb-6 flex gap-3">
            <button onClick={onClose} className="flex-1 btn-secondary justify-center">Huỷ</button>
            <button
              onClick={handleImport}
              disabled={!rows.length || importing}
              className="flex-1 btn-primary justify-center disabled:opacity-60"
            >
              {importing
                ? <><span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />Đang import...</>
                : <><span className="material-symbols-outlined text-base">upload</span>Import {rows.length > 0 ? `${rows.length} học viên` : ''}</>
              }
            </button>
          </div>
        )}
        {result && (
          <div className="px-6 pb-6">
            <button onClick={onClose} className="w-full btn-primary justify-center">Đóng</button>
          </div>
        )}
      </div>
    </div>
  )
}

function buildZaloUrl(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const intl = digits.startsWith('0') ? '84' + digits.slice(1) : digits
  return `https://zalo.me/${intl}`
}

export default function Students() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const showAlert = useAlert()
  const prompt = usePrompt()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [gradeLevel, setGradeLevel] = useState('')
  const [page, setPage] = useState(1)
  const [showModal, setShowModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [editStudent, setEditStudent] = useState<Student | null>(null)
  const [privateModalStudent, setPrivateModalStudent] = useState<Student | null>(null)
  const { canManageStudents, canImportStudents } = useAuth()

  const searchRef = useRef<ReturnType<typeof setTimeout>>()
  const pageCursors = useRef(new Map<string, string>())

  const studentsQuery = useQuery<{
    data: Student[]
    total: number
    totalPages: number
    totalAll: number
    totalActive: number
    nextCursor: string | null
  }>({
    queryKey: ['students', page, debouncedSearch, gradeLevel],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (gradeLevel) params.set('gradeLevel', gradeLevel)
      const filterKey = JSON.stringify([debouncedSearch, gradeLevel])
      const cursor = pageCursors.current.get(`${filterKey}:${page}`)
      if (cursor) params.set('cursor', cursor)
      let res
      try { res = await api.get(`/students?${params}`) }
      catch (error: any) {
        if (error.response?.status !== 409 || !cursor) throw error
        pageCursors.current.clear()
        params.delete('cursor')
        res = await api.get(`/students?${params}`)
      }
      if (res.data.nextCursor) pageCursors.current.set(`${filterKey}:${page + 1}`, res.data.nextCursor)
      return res.data
    },
    placeholderData: (prev) => prev, // giữ data cũ khi chuyển trang → không flash trắng
  })

  const students = studentsQuery.data?.data ?? []
  const total = studentsQuery.data?.total ?? 0
  const totalPages = studentsQuery.data?.totalPages ?? 1
  const totalAll = studentsQuery.data?.totalAll ?? 0
  const totalActive = studentsQuery.data?.totalActive ?? 0
  const loading = studentsQuery.isLoading

  const invalidate = () => {
    pageCursors.current.clear()
    return queryClient.invalidateQueries({ queryKey: ['students'] })
  }

  const handleSearch = (q: string) => {
    setSearch(q)
    setPage(1)
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => setDebouncedSearch(q), 300)
  }

  const handleGradeFilter = (gl: string) => {
    setGradeLevel(gl)
    setPage(1)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
  }

  const copyShareLink = async (student: Student) => {
    const url = buildParentUrl(student.id)
    window.open(url, '_blank', 'noopener,noreferrer')
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(student.id)
      setTimeout(() => setCopiedId(prev => prev === student.id ? null : prev), 1500)
    } catch {
      await showAlert({
        title: 'Không sao chép được',
        message: `Trình duyệt chặn clipboard. Hãy copy thủ công:\n${url}`,
      })
    }
  }

  const handleDelete = async (student: Student) => {
    if (student.status === 'INACTIVE') {
      const ok = await confirm({
        title: 'Xoá hoàn toàn học viên',
        message: `Bạn có chắc muốn xoá HOÀN TOÀN dữ liệu của "${student.fullName}"?\n\nThao tác này sẽ xoá:\n• Hồ sơ học viên + thông tin phụ huynh\n• Toàn bộ ghi danh, lịch học riêng, điểm danh\n• Phiếu học phí, thanh toán, khuyến mại\n\nKhông thể hoàn tác.`,
        confirmLabel: 'Xoá vĩnh viễn',
        danger: true,
      })
      if (!ok) return
      await api.delete(`/students/${student.id}/hard`)
    } else {
      const ok = await confirm({
        title: 'Chuyển học viên sang nghỉ học',
        message: `Chuyển "${student.fullName}" sang trạng thái nghỉ học?`,
        confirmLabel: 'Xác nhận nghỉ học',
        danger: true,
      })
      if (!ok) return
      await api.delete(`/students/${student.id}`)
    }
    invalidate()
  }

  const handleBulkDelete = async () => {
    const password = await prompt({
      title: 'Xoá hoàn toàn tất cả học viên',
      message: '⚠️ Bạn có chắc chắn muốn XOÁ HOÀN TOÀN dữ liệu của TẤT CẢ học viên?\n\nThao tác này sẽ xoá:\n• Hồ sơ tất cả học viên + thông tin phụ huynh\n• Toàn bộ ghi danh, lịch học riêng, điểm danh\n• Phiếu học phí, thanh toán, khuyến mại\n\nKhông thể hoàn tác. Vui lòng nhập mật khẩu tài khoản của bạn để xác nhận:',
      placeholder: 'Mật khẩu đăng nhập của bạn',
      inputType: 'password',
      danger: true,
      confirmLabel: 'Xoá vĩnh viễn tất cả',
      cancelLabel: 'Hủy',
    })
    if (!password) return

    try {
      const res = await api.post('/students/bulk-delete', { password })
      await showAlert({
        title: 'Thành công',
        message: res.data.message || 'Đã xóa vĩnh viễn toàn bộ học viên.',
      })
      invalidate()
    } catch (err: any) {
      await showAlert({
        title: 'Thao tác thất bại',
        message: err.response?.data?.message || 'Mật khẩu không chính xác hoặc có lỗi xảy ra.',
      })
    }
  }

  const handleSaved = () => {
    setShowModal(false)
    setEditStudent(null)
    invalidate()
  }

  return (
    <div>
      <TopBar title="Quản lý Học viên" onSearch={handleSearch} />
      <div className="page-content px-8 py-8 space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Dữ liệu hệ thống</span>
            <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Quản lý Học viên</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {canImportStudents && (
              <button onClick={() => setShowImportModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm font-semibold text-on-surface-variant hover:bg-surface-container hover:text-primary transition-all">
                <span className="material-symbols-outlined text-[18px]">upload_file</span>
                Import Excel
              </button>
            )}
            <button className="btn-primary" onClick={() => { setEditStudent(null); setShowModal(true) }}>
              <span className="material-symbols-outlined">person_add</span>
              Thêm học viên mới
            </button>
          </div>
        </div>

        {/* Stats + Filters */}
        <div className="student-summary grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary-container/20 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined">group</span>
              </div>
            </div>
            <p className="text-sm text-outline font-medium">Tổng học viên</p>
            <p className="text-2xl font-black text-on-surface mt-1">{loading ? '—' : totalAll}</p>
          </div>
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary-container/20 flex items-center justify-center text-secondary">
                <span className="material-symbols-outlined">check_circle</span>
              </div>
              <span className="text-xs font-bold text-secondary">Đang học</span>
            </div>
            <p className="text-sm text-outline font-medium">Đang theo học</p>
            <p className="text-2xl font-black text-on-surface mt-1">
              {loading ? '—' : totalActive}
            </p>
          </div>
          <div className="md:col-span-2 bg-surface-container-low p-5 rounded-2xl flex flex-col justify-center">
            <label className="text-[10px] font-bold text-outline uppercase mb-2 block">Khối lớp</label>
            <div className="flex flex-wrap gap-2">
              {['', '6', '7', '8', '9', '10', '11', '12'].map((gl) => (
                <button
                  key={gl}
                  onClick={() => handleGradeFilter(gl)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    gradeLevel === gl
                      ? 'bg-primary text-on-primary border-primary shadow-sm'
                      : 'bg-surface text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  {gl === '' ? 'Tất cả' : `Lớp ${gl}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:px-6">
            <div>
              <h3 className="text-base font-semibold text-on-surface">
                Danh sách học viên
                <span className="ml-2 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{total}</span>
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">{gradeLevel ? `Khối ${gradeLevel}` : 'Tất cả khối lớp'}{debouncedSearch ? ` · Tìm kiếm: ${debouncedSearch}` : ''}</p>
            </div>
            <span className="text-xs text-slate-500">{totalPages > 1 ? `Trang ${page}/${totalPages}` : `${total} học viên`}</span>
          </div>
          <div className="overflow-x-auto">
            <table role="table" className="student-mobile-table w-full min-w-[860px] table-fixed border-collapse text-left text-sm" aria-label="Danh sách học viên">
              <colgroup>
                <col style={{ width: '5%' }} />
                <col style={{ width: '24%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '24%' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-500">
                  <th scope="col" className="py-3.5 pl-5 pr-2 font-semibold sm:pl-6">STT</th>
                  <th scope="col" className="px-3 py-3.5 font-semibold">Học viên</th>
                  <th scope="col" className="px-3 py-3.5 font-semibold">Lớp học</th>
                  <th scope="col" className="px-3 py-3.5 font-semibold">Khuyến mại</th>
                  <th scope="col" className="px-3 py-3.5 font-semibold">Trạng thái</th>
                  <th scope="col" className="py-3.5 pl-3 pr-5 text-right font-semibold sm:pr-6">Thao tác</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className="divide-y divide-slate-100">
                {students.map((student, index) => (
                  <tr role="row" key={student.id} className="align-middle hover:bg-slate-50/70 focus-within:bg-slate-50/70">
                    <td role="cell" data-label="STT" className="py-4 pl-5 pr-2 text-xs tabular-nums text-slate-400 sm:pl-6">
                      {(page - 1) * PAGE_SIZE + index + 1}
                    </td>
                    <td role="cell" data-label="Học viên" className="px-3 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={student.fullName} />
                        <div className="min-w-0">
                          <div className="break-words font-semibold leading-5 text-on-surface">{student.fullName}</div>
                          {student.gradeLevel && <div className="mt-0.5 text-xs text-slate-500">Khối {student.gradeLevel}</div>}
                        </div>
                      </div>
                    </td>
                    <td role="cell" data-label="Lớp học" className="px-3 py-4">
                      {student.enrollments && student.enrollments.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {student.enrollments.map((e) => (
                            <span key={e.id} className="inline-flex max-w-full items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium leading-4 text-primary" title={e.className}>
                              {e.className}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="inline-flex max-w-full items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium leading-4 text-primary">
                          Học riêng
                        </span>
                      )}
                    </td>
                    <td role="cell" data-label="Khuyến mại" className="px-3 py-4">
                      {student.promotions && student.promotions.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {student.promotions.map((p, i) => (
                            <span key={p.id || i} title={p.promotionName} className="inline-flex items-center rounded-md bg-violet-50 px-2 py-1 text-xs font-medium leading-4 text-violet-700">
                              {p.promotionType === 'PERCENTAGE'
                                ? `${p.promotionValue}%`
                                : p.promotionType === 'FIXED_AMOUNT'
                                ? `${(p.promotionValue / 1000).toFixed(0)}K`
                                : `${p.promotionValue} buổi`}
                            </span>
                          ))}
                        </div>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td role="cell" data-label="Trạng thái" className="px-3 py-4">
                      <StatusBadge status={student.status} />
                    </td>
                    <td role="cell" data-label="Thao tác" className="py-4 pl-3 pr-5 text-right sm:pr-6">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => navigate(`/students/${student.id}`)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-blue-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          title="Xem hồ sơ"
                          aria-label={`Xem hồ sơ ${student.fullName}`}
                        >
                          <span className="material-symbols-outlined text-[19px]">visibility</span>
                        </button>
                        <button
                          onClick={() => copyShareLink(student)}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${copiedId === student.id
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'text-slate-500 hover:bg-blue-50 hover:text-primary'}`}
                          title={copiedId === student.id ? 'Đã sao chép link' : 'Sao chép link chia sẻ phụ huynh'}
                          aria-label={`Sao chép link chia sẻ phụ huynh của ${student.fullName}`}
                        >
                          <span className="material-symbols-outlined text-[19px]">
                            {copiedId === student.id ? 'check' : 'share'}
                          </span>
                        </button>
                        {(() => {
                          const phone = student.primaryParent?.zalo || student.primaryParent?.phone
                          const zaloUrl = buildZaloUrl(phone)
                          return zaloUrl ? (
                            <a
                              href={zaloUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-blue-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              title={`Nhắn tin Zalo cho ${phone}`}
                              aria-label={`Nhắn tin Zalo với phụ huynh ${student.fullName}`}
                            >
                              <span className="material-symbols-outlined text-[19px]">chat</span>
                            </a>
                          ) : null
                        })()}
                        <button
                          onClick={() => setPrivateModalStudent(student)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-blue-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          title="Thêm lịch học riêng"
                          aria-label={`Thêm lịch học riêng cho ${student.fullName}`}
                        >
                          <span className="material-symbols-outlined text-[19px]">calendar_month</span>
                        </button>
                        {canManageStudents && (
                          <button
                            onClick={() => handleDelete(student)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                            title={student.status === 'INACTIVE' ? 'Xóa vĩnh viễn' : 'Chuyển sang nghỉ học'}
                            aria-label={`${student.status === 'INACTIVE' ? 'Xóa vĩnh viễn' : 'Chuyển sang nghỉ học'}: ${student.fullName}`}
                          >
                            <span className="material-symbols-outlined text-[19px]">delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-sm text-slate-500">
                      <span className="material-symbols-outlined mb-2 block text-4xl text-slate-300">search_off</span>
                      {studentsQuery.isError ? 'Không tải được danh sách học viên. Vui lòng thử lại.' : 'Không tìm thấy học viên nào.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 sm:px-6">
              <p className="text-xs font-medium text-outline">
                Hiển thị {(page - 1) * PAGE_SIZE + 1} - {Math.min(page * PAGE_SIZE, total)} của {total} học viên
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageChange(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-outline hover:bg-surface-container-high transition-all disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pg: number
                  if (totalPages <= 5) { pg = i + 1 }
                  else if (page <= 3) { pg = i + 1 }
                  else if (page >= totalPages - 2) { pg = totalPages - 4 + i }
                  else { pg = page - 2 + i }
                  return (
                    <button
                      key={pg}
                      onClick={() => handlePageChange(pg)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${pg === page ? 'bg-primary text-on-primary shadow-md shadow-primary/20' : 'text-outline hover:bg-surface-container-high'}`}
                    >
                      {pg}
                    </button>
                  )
                })}
                <button
                  onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-outline hover:bg-surface-container-high transition-all disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <StudentModal
          student={editStudent}
          onClose={() => { setShowModal(false); setEditStudent(null) }}
          onSaved={handleSaved}
        />
      )}

      {privateModalStudent && (
        <PrivateScheduleModal
          studentId={privateModalStudent.id}
          studentName={privateModalStudent.fullName}
          onClose={() => setPrivateModalStudent(null)}
          onSaved={() => setPrivateModalStudent(null)}
        />
      )}

      {showImportModal && (
        <ImportExcelModal
          onClose={() => setShowImportModal(false)}
          onImported={() => { setPage(1); invalidate() }}
        />
      )}
    </div>
  )
}
