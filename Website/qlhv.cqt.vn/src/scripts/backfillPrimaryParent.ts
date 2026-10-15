/**
 * Một lần: sync primaryParentName/Phone/Zalo denorm cho mọi student doc.
 * Chạy: npx tsx src/scripts/backfillPrimaryParent.ts
 */
import { db, C } from '../lib/firebase'
import { syncPrimaryParentToStudent } from '../lib/studentSync'

async function main() {
  const snap = await db.collection(C.STUDENTS).get()
  console.log(`Tổng học viên: ${snap.size}`)

  let synced = 0
  let skipped = 0
  let errors = 0

  for (const doc of snap.docs) {
    try {
      await syncPrimaryParentToStudent(doc.id)
      synced++
      if (synced % 20 === 0) console.log(`  ...đã sync ${synced}`)
    } catch (err) {
      errors++
      console.error(`Lỗi với student ${doc.id}:`, (err as Error).message)
    }
  }

  console.log(`\nXong. Synced: ${synced} | Skipped: ${skipped} | Errors: ${errors}`)
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
