import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import EInvoicePreparation from '../components/EInvoicePreparation'
import api from '../services/api'

export default function EInvoices() {
  const thisYear = new Date().getFullYear()
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestRequest = useRef(0)
  const years = Array.from({ length: 4 }, (_, i) => thisYear - 1 + i)

  const loadData = () => {
    const request = ++latestRequest.current
    setLoading(true)
    setError(null)
    api.get(`/tuition/schedule-summary?month=${month}&year=${year}`)
      .then(({ data }) => { if (request === latestRequest.current) setRows(data) })
      .catch(() => { if (request === latestRequest.current) { setRows([]); setError('Không tải được dữ liệu học phí.') } })
      .finally(() => { if (request === latestRequest.current) setLoading(false) })
  }

  useEffect(() => { loadData() }, [month, year])

  return (
    <div>
      <TopBar title="Hóa đơn điện tử" />
      <div className="px-8 py-8 space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Tài chính</span>
            <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Hóa đơn điện tử</h2>
          </div>
          <div className="flex items-center gap-3">
            <select aria-label="Tháng hóa đơn" value={month} onChange={e => setMonth(Number(e.target.value))}
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>)}
            </select>
            <select aria-label="Năm hóa đơn" value={year} onChange={e => setYear(Number(e.target.value))}
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <EInvoicePreparation rows={rows} loading={loading} error={error} month={month} year={year} retry={loadData} />
      </div>
    </div>
  )
}
