import 'dotenv/config'
import { db } from '../lib/firebase'
import { invoiceBillingPeriods, invalidateReadView } from '../services/readViews'

async function main() {
  const snapshot = await db.collection('misaInvoices').get()
  let updated = 0
  for (let start = 0; start < snapshot.docs.length; start += 400) {
    const batch = db.batch()
    let changes = 0
    for (const doc of snapshot.docs.slice(start, start + 400)) {
      const data = doc.data(), periods = invoiceBillingPeriods(data)
      if (JSON.stringify(data.billingPeriods) === JSON.stringify(periods)) continue
      batch.update(doc.ref, { billingPeriods: periods }); changes++
    }
    if (changes) await batch.commit()
    updated += changes
  }
  if (updated) await invalidateReadView('invoices')
  console.log(JSON.stringify({ inspected: snapshot.size, updated }))
  await db.terminate()
}
main().catch(() => { console.error('Invoice period backfill failed'); process.exitCode = 1 })
