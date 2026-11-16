/**
 * Script xoá tất cả COMPLETED sessions + attendance liên quan cho 1 lớp (để reset về lịch mới)
 * Chạy: npx tsx scripts/cleanup-sessions.ts <classId>
 */
import { db, C } from '../src/lib/firebase'

async function cleanupClassSessions(classId: string) {
  console.log(`Cleaning all sessions for class: ${classId}`)

  const snap = await db.collection(C.SESSIONS).where('classId', '==', classId).get()
  console.log(`Found ${snap.docs.length} sessions total`)

  const sessionIds = snap.docs.map(d => d.id)

  // Xoá attendance records
  if (sessionIds.length > 0) {
    const chunks: string[][] = []
    for (let i = 0; i < sessionIds.length; i += 30) chunks.push(sessionIds.slice(i, i + 30))
    let attCount = 0
    for (const chunk of chunks) {
      const [studentAtts, teacherAtts] = await Promise.all([
        db.collection(C.STUDENT_ATTENDANCES).where('sessionId', 'in', chunk).get(),
        db.collection(C.TEACHER_ATTENDANCES).where('sessionId', 'in', chunk).get(),
      ])
      await Promise.all([
        ...studentAtts.docs.map(d => d.ref.delete()),
        ...teacherAtts.docs.map(d => d.ref.delete()),
      ])
      attCount += studentAtts.size + teacherAtts.size
    }
    console.log(`Xoá ${attCount} attendance records`)
  }

  await Promise.all(snap.docs.map(d => d.ref.delete()))
  console.log(`Xoá ${snap.docs.length} sessions`)
  console.log('Xong! Hãy vào lớp học và lưu lại để tạo sessions mới.')
}

const classId = process.argv[2]
if (!classId) { console.error('Cần classId: npx tsx scripts/cleanup-sessions.ts <classId>'); process.exit(1) }
cleanupClassSessions(classId).catch(console.error)
