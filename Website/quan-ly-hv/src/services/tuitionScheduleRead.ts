import { C, db } from '../lib/firebase'
import { getSupabasePool } from '../lib/supabase'
import { firestoreSnapshotStore } from '../lib/firestoreSnapshot'
import { getTuitionScheduleSummary } from './tuitionScheduleSummary'

function isFirebaseQuotaError(error: any) {
  const code = String(error?.code ?? error?.status ?? '').toUpperCase().split('/').pop()
  return code === '8' || code === '429' || code === 'RESOURCE_EXHAUSTED'
    || /resource.?exhausted|quota(?:\s+)?(?:exceeded|limit)|read limit/i.test(`${code} ${String(error?.message ?? '')}`)
}

export async function getTuitionScheduleWithFallback(month: number, year: number) {
  try {
    return { rows: await getTuitionScheduleSummary(month, year), source: 'firebase' as const }
  } catch (firebaseError) {
    if (!isFirebaseQuotaError(firebaseError)) throw firebaseError

    console.warn('[Tuition] Firebase read quota reached; reading the mirrored Supabase snapshot',
      String((firebaseError as any)?.code ?? 'RESOURCE_EXHAUSTED'))
    const paths = [C.STUDENTS, C.CLASSES, C.ENROLLMENTS, C.SESSIONS, C.PRIVATE_SCHEDULES,
      C.STUDENT_PROMOTIONS, C.TUITION_RECORDS, C.PAYMENTS]
    const { rows: documents } = await getSupabasePool().query<{
      collection_path: string; document_id: string; data: Record<string, any>
    }>(
      'SELECT collection_path, document_id, data FROM qlhv_migration.documents WHERE collection_path = ANY($1::text[])',
      [paths],
    )
    const available = new Set(documents.map(row => row.collection_path))
    if (!available.has(C.STUDENTS) || !available.has(C.CLASSES)
      || (!available.has(C.SESSIONS) && !available.has(C.PRIVATE_SCHEDULES))) {
      throw new Error('Supabase fallback snapshot is incomplete; tuition data was not returned')
    }

    const result = await getTuitionScheduleSummary(month, year, firestoreSnapshotStore(documents))
    return { rows: result, source: 'supabase-fallback' as const }
  }
}
