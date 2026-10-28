import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import TopBar from '../components/TopBar'
import EInvoicePreparation, { InvoiceRow } from '../components/EInvoicePreparation'
import api from '../services/api'

export default function EInvoices() {
  const thisYear = new Date().getFullYear()
  const [searchParams] = useSearchParams()
  const requestedMonth = Number(searchParams.get('month'))
  const requestedYear = Number(searchParams.get('year'))
  const [month, setMonth] = useState(requestedMonth >= 1 && requestedMonth <= 12 ? requestedMonth : new Date().getMonth() + 1)
  const [year, setYear] = useState(requestedYear >= 2026 && requestedYear <= 2100 ? requestedYear : thisYear)
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestRequest = useRef(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const years = Array.from({ length: 4 }, (_, i) => thisYear - 1 + i)

  const loadData = async (cursor?: string, force = false) => {
    const request = ++latestRequest.current
    if (cursor) setLoadingMore(true); else setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/tuition/misa/invoices', { params: { month, year, limit: 30, cursor, ...(force ? { force: true } : {}) } })
      if (request !== latestRequest.current) return
      setRows(previous => cursor ? [...previous, ...data.rows] : data.rows)
      setCounts(data.counts); setTotal(data.total); setNextCursor(data.nextCursor)
    } catch (error: any) {
      if (request !== latestRequest.current) return
      if (cursor && error.response?.status === 409) { void loadData(); return }
      setError('Không tải được danh sách hóa đơn. Vui lòng thử lại.')
    } finally {
      if (request === latestRequest.current) { setLoading(false); setLoadingMore(false) }
    }
  }

  useEffect(() => {
    setRows([]); setNextCursor(null)
    void loadData()
    return () => { latestRequest.current++ }
  }, [month, year])

  return (
    <div>
      <TopBar title="Hóa đơn điện tử" />
      <div className="page-content px-8 py-8 space-y-8">
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
        <EInvoicePreparation rows={rows} counts={counts} total={total} loading={loading} error={error} month={month} year={year} retry={() => { void loadData(undefined, true) }} loadMore={nextCursor ? () => { void loadData(nextCursor) } : undefined} loadingMore={loadingMore} />
      </div>
    </div>
  )
}
