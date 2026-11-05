import React, { useEffect, useRef, useState } from 'react'
import api from '../services/api'

// Người bán: mọi cơ sở xuất hoá đơn dưới cùng một hộ kinh doanh (theo hoá đơn thật 2C26MHP-00001336).
const SELLER = {
  name: 'HỘ KINH DOANH TÔ THỊ NGỌC QUỲNH',
  citizenId: '034195001027',
  taxCode: '034195001027',
  address: 'Số 263 Đặng Tiến Đông, Phường Ô Chợ Dừa, TP Hà Nội, Việt Nam.',
  locationCode: '00001',
  phone: '0966903589',
  website: 'www.cqt.vn',
  bankAccount: '16195888888 - Ngân hàng TMCP Kỹ Thương Việt Nam - Techcombank',
}

interface PreviewLine {
  description: string; unitName: string; quantity: number
  unitPrice: number | null; amount: number | null; discountAmount: number; finalAmount: number | null
}
interface Preview {
  invoiceDate: string; series: string | null
  buyer: { fullName: string; citizenIdNumber: string; address: string; email: string; phone: string }
  buyerFallback: { fullName: boolean; address: boolean }
  period: { month: number; year: number } | null; periods: { month: number; year: number }[]
  amountSource: 'record' | 'estimate' | 'sample'
  lines: PreviewLine[]
  totals: { amount: number | null; discountAmount: number | null; finalAmount: number | null }
  amountInWords: string | null
  existingInvoice: { invoiceNumber: string | null; status: string } | null
  warnings: string[]
}

const money = (n: number | null) => n === null ? '—' : n.toLocaleString('vi-VN')

const S: Record<string, React.CSSProperties> = {
  sheet: { position: 'relative', background: '#fff', color: '#111', fontFamily: '"Times New Roman", Times, serif', fontSize: 14,
    lineHeight: 1.55, padding: '28px 32px', border: '6px double #7aa7c7', width: 794, maxWidth: '100%', margin: '0 auto', boxSizing: 'border-box', overflow: 'hidden' },
  watermark: { position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%, -50%) rotate(-28deg)', fontSize: 46, fontWeight: 700,
    color: 'rgba(200, 30, 30, 0.13)', whiteSpace: 'nowrap', pointerEvents: 'none', letterSpacing: 2 },
  logo: { fontFamily: 'Arial, Helvetica, sans-serif', textAlign: 'center', color: '#2fa84f', minWidth: 210 },
  hr: { border: 0, borderTop: '1px solid #999', margin: '8px 0' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 10 },
  th: { border: '1px solid #333', padding: '4px 6px', fontWeight: 700, textAlign: 'center' },
  td: { border: '1px solid #333', padding: '4px 6px', height: 26 },
  num: { textAlign: 'right' },
  missing: { color: '#b45309', fontStyle: 'italic' },
}

function Value({ text, fallback }: { text: string; fallback?: boolean }) {
  if (!text) return <span style={S.missing}>(chưa có)</span>
  return <span title={fallback ? 'Lấy từ Thông tin cơ bản' : undefined}>{text}{fallback ? ' *' : ''}</span>
}

function InvoiceSheet({ preview }: { preview: Preview }) {
  const [y, m, d] = preview.invoiceDate.split('-')
  const { buyer, buyerFallback: fb, lines, totals } = preview
  const blankRows = Math.max(0, 7 - lines.length - (totals.discountAmount ? 1 : 0))
  return (
    <div style={S.sheet}>
      <div style={S.watermark}>BẢN XEM TRƯỚC – KHÔNG CÓ GIÁ TRỊ</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{SELLER.name}</div>
          <div>Căn cước công dân: {SELLER.citizenId}</div>
          <div>Địa chỉ: {SELLER.address}</div>
          <div>Mã địa điểm kinh doanh: {SELLER.locationCode} &nbsp; Tên địa điểm kinh doanh: {SELLER.name}</div>
          <div>Mã số thuế: {SELLER.taxCode}</div>
          <div>Địa chỉ: {SELLER.address}</div>
          <div>Điện thoại: {SELLER.phone}</div>
          <div>Website: {SELLER.website}</div>
          <div>Số tài khoản: {SELLER.bankAccount}</div>
        </div>
        <div style={S.logo}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 1, marginTop: 36 }}>CQT EDUCATION</div>
          <div style={{ fontSize: 8, letterSpacing: 1 }}>NOTHING OR THE BEST - ZERO TO HERO</div>
        </div>
      </div>
      <hr style={S.hr} />
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>HÓA ĐƠN BÁN HÀNG</div>
          <div style={{ fontStyle: 'italic' }}>Ngày {d} tháng {m} năm {y}</div>
          <div style={{ fontStyle: 'italic' }}>Mã CQT: (cấp khi phát hành)</div>
        </div>
        <div style={{ minWidth: 170 }}>
          <div>Ký hiệu: {preview.series ?? '—'}</div>
          <div>Số: <b>(cấp khi phát hành)</b></div>
        </div>
      </div>
      <hr style={S.hr} />
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div>Họ và tên người mua: <Value text={buyer.fullName} fallback={fb.fullName} /></div>
          <div>Căn cước công dân: <Value text={buyer.citizenIdNumber} /></div>
          {/* Cá nhân: MST người mua = số CCCD (khớp dữ liệu gửi MISA). */}
          <div>Mã số thuế: <Value text={buyer.citizenIdNumber} /></div>
          <div>Địa chỉ: <Value text={buyer.address} fallback={fb.address} /></div>
          <div>Hình thức thanh toán: TM/CK</div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, alignSelf: 'flex-end' }}>
          <div style={{ width: 84, height: 84, border: '1px dashed #999', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', margin: '0 auto' }}>QR</div>
          <div>Quét để thanh toán</div>
        </div>
      </div>
      <table style={S.table}>
        <thead>
          <tr>
            {['STT', 'Tên hàng hóa, dịch vụ', 'Đơn vị tính', 'Số lượng', 'Đơn giá', 'Thành tiền'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td style={{ ...S.td, textAlign: 'center' }}>{i + 1}</td>
              <td style={S.td}>{line.description}</td>
              <td style={S.td}>{line.unitName}</td>
              <td style={{ ...S.td, ...S.num }}>{line.quantity.toLocaleString('vi-VN', { minimumFractionDigits: 2 })}</td>
              <td style={{ ...S.td, ...S.num }}>{money(line.unitPrice)}</td>
              <td style={{ ...S.td, ...S.num }}>{money(line.amount)}</td>
            </tr>
          ))}
          {!!totals.discountAmount && (
            <tr>
              <td style={S.td} />
              <td style={S.td} colSpan={4}>Chiết khấu</td>
              <td style={{ ...S.td, ...S.num }}>-{money(totals.discountAmount)}</td>
            </tr>
          )}
          {Array.from({ length: blankRows }, (_, i) => <tr key={`b${i}`}>{Array.from({ length: 6 }, (_, j) => <td key={j} style={S.td} />)}</tr>)}
          <tr>
            <td style={S.td} colSpan={5}>Cộng tiền bán hàng hóa, dịch vụ:</td>
            <td style={{ ...S.td, ...S.num, fontWeight: 700 }}>{money(totals.finalAmount)}</td>
          </tr>
          <tr>
            <td style={S.td} colSpan={6}>Số tiền viết bằng chữ: <b><i>{preview.amountInWords ?? '—'}</i></b></td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', textAlign: 'center', marginTop: 16, minHeight: 120 }}>
        <div style={{ flex: 1 }}><b>Người mua hàng</b><div style={{ fontStyle: 'italic' }}>(Chữ ký số (nếu có))</div></div>
        <div style={{ flex: 1 }}><b>Người bán hàng</b><div style={{ fontStyle: 'italic' }}>(Chữ ký điện tử, Chữ ký số)</div></div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 12 }}>
        <div>Tra cứu tại Website: https://www.meinvoice.vn/tra-cuu - Mã tra cứu: (cấp khi phát hành)</div>
        <div>(Cần kiểm tra, đối chiếu khi lập, giao, nhận hóa đơn)</div>
      </div>
    </div>
  )
}

export default function InvoicePreviewModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [period, setPeriod] = useState('')
  const [error, setError] = useState('')
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const [month, year] = period.split('/')
    setError('')
    api.get(`/students/${studentId}/invoice-preview`, { params: period ? { month, year } : {} })
      .then(res => setPreview(res.data))
      .catch(err => setError(err.response?.data?.message ?? 'Không tải được bản xem trước'))
  }, [studentId, period])

  const print = () => {
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win || !sheetRef.current) return
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Xem trước hóa đơn</title>
      <style>@page { size: A4; margin: 10mm } body { margin: 0 } * { -webkit-print-color-adjust: exact; print-color-adjust: exact }</style>
      </head><body>${sheetRef.current.innerHTML}</body></html>`)
    win.document.close()
    win.focus()
    win.print()
  }

  const current = preview?.period ? `${preview.period.month}/${preview.period.year}` : ''
  const periods = preview?.periods ?? []

  return (
    <div className="responsive-dialog fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-surface-container-lowest rounded-2xl shadow-2xl p-6 z-10 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 className="text-xl font-headline font-bold text-on-surface">Xem trước hóa đơn</h3>
          <div className="flex items-center gap-2">
            {preview?.amountSource === 'estimate' && (
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">Tạm tính</span>
            )}
            {periods.length > 0 && (
              <select value={current} onChange={e => setPeriod(e.target.value)} className="input !w-auto">
                {periods.map(p => <option key={`${p.month}/${p.year}`} value={`${p.month}/${p.year}`}>Tháng {p.month}/{p.year}</option>)}
              </select>
            )}
            <button onClick={print} disabled={!preview} className="btn-secondary disabled:opacity-50">
              <span className="material-symbols-outlined text-base">print</span>In
            </button>
            <button onClick={onClose} className="p-2 hover:bg-surface-container-low rounded-lg transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        {error && <div className="mb-4 p-3 bg-error-container/10 text-error rounded-xl text-sm">{error}</div>}
        {!preview && !error && <p className="text-sm text-outline py-10 text-center">Đang tải...</p>}
        {preview && (
          <>
            <div className="mb-4 space-y-2 text-sm">
              <p className="text-on-surface-variant">
                Hóa đơn sẽ gửi tới: <b>{preview.buyer.email || '—'}</b>
                {(preview.buyerFallback.fullName || preview.buyerFallback.address) && <span className="text-outline"> · Dấu * là thông tin lấy từ Thông tin cơ bản</span>}
              </p>
              {preview.warnings.length > 0 && (
                <ul className="p-3 rounded-xl bg-amber-50 text-amber-800 list-disc pl-6 space-y-0.5">
                  {preview.warnings.map(w => <li key={w}>{w}</li>)}
                </ul>
              )}
            </div>
            <div className="overflow-x-auto">
              <div ref={sheetRef}><InvoiceSheet preview={preview} /></div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
