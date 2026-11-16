/**
 * Migration one-time: đồng bộ primary parent info xuống student doc (denorm)
 * Chạy: npx tsx scripts/migrate-denorm-parent.ts
 */
import { db, C } from '../src/lib/firebase'

async function run() {
  console.log('Fetching all students...')
  const studentsSnap = await db.collection(C.STUDENTS).get()
  console.log(`Found ${studentsSnap.docs.length} students`)

  let synced = 0
  let emptied = 0

  for (const studentDoc of studentsSnap.docs) {
    const studentId = studentDoc.id
    const parentsSnap = await studentDoc.ref.collection('parents')
      .where('isPrimaryContact', '==', true)
      .limit(1)
      .get()

    if (parentsSnap.empty) {
      await studentDoc.ref.update({
        primaryParentName: null,
        primaryParentPhone: null,
        primaryParentZalo: null,
      })
      emptied++
    } else {
      const p = parentsSnap.docs[0].data()
      await studentDoc.ref.update({
        primaryParentName: p.fullName ?? null,
        primaryParentPhone: p.phone ?? null,
        primaryParentZalo: p.zalo ?? null,
      })
      synced++
    }
  }

  console.log(`Done. Synced: ${synced}, Emptied: ${emptied}`)
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
