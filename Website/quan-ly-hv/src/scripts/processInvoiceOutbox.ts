import 'dotenv/config'
import { invoiceAutomationEnabled, processPendingInvoices } from '../services/invoiceOutbox'

async function main() {
  if (!invoiceAutomationEnabled()) throw new Error('MEINVOICE_AUTO_PREPARE_XML chưa bật.')
  const continuous = process.argv.includes('--watch')
  do {
    const result = await processPendingInvoices()
    console.log(JSON.stringify(result))
    if (continuous) await new Promise(resolve => setTimeout(resolve, 15000))
  } while (continuous)
}
main().catch(() => { console.error('Không xử lý được hàng đợi hóa đơn; kiểm tra cấu hình và trạng thái backend.'); process.exitCode = 1 })
