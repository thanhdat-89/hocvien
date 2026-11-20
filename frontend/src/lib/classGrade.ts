import type { Class } from '../types'

/** Đoán khối từ tên lớp, vd. "Toán 9 - CQT01" → 9 */
export function gradeFromName(name: string): number | null {
  const match = name.match(/(?:^|\s)(?:toán|lớp)\s*(\d{1,2})(?!\d)/i)
  const grade = match ? Number(match[1]) : null
  return grade && grade >= 1 && grade <= 12 ? grade : null
}

export function gradeOfClass(cls: Class): number | null {
  const grade = Number(cls.gradeLevel)
  if (grade >= 1 && grade <= 12) return grade
  return gradeFromName(cls.name)
}
