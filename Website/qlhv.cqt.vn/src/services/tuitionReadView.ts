import { readView } from './readViews'
import { getTuitionScheduleSummary } from './tuitionScheduleSummary'

/** Display data only. Financial mutations and invoice validation use original records. */
export async function getCachedTuitionSummary(month: number, year: number, force = false) {
  const view = await readView('tuition', `${year}-${String(month).padStart(2, '0')}`, async () => {
    const rows = await getTuitionScheduleSummary(month, year)
    const unpaidStudents = new Set(rows
      .filter(row => (row.tuitionRecord ? row.tuitionRecord.remainingAmount : row.finalAmount) > 0)
      .map(row => row.studentId)).size
    return { rows, unpaidStudents }
  }, undefined, force)
  return view.data!
}
