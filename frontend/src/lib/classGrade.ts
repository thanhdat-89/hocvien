import type { Class } from '../types'

export function gradeOfClass(cls: Class): number | null {
  const grade = Number(cls.gradeLevel)
  if (grade >= 1 && grade <= 12) return grade
  const match = cls.name.match(/(?:^|\s)(?:toán|lớp)\s*(\d{1,2})(?!\d)/i)
  return match ? Number(match[1]) : null
}
