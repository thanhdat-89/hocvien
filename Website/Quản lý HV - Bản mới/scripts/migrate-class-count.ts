/**
 * Migration one-time: đếm lại activeStudentCount cho tất cả class
 * Chạy: npx tsx scripts/migrate-class-count.ts
 */
import { db, C } from '../src/lib/firebase'
import { recountClassActiveStudents } from '../src/lib/classSync'

async function run() {
  console.log('Fetching all classes...')
  const classesSnap = await db.collection(C.CLASSES).get()
  console.log(`Found ${classesSnap.docs.length} classes`)

  for (const classDoc of classesSnap.docs) {
    await recountClassActiveStudents(classDoc.id)
    console.log(`✓ ${classDoc.data().name}`)
  }

  console.log('Done.')
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
