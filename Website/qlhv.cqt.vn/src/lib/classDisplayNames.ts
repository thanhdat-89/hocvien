import { prisma } from './db'

/** Resolve labels by the stable class ID for operational screens. Stored snapshots stay unchanged. */
export async function currentClassNames(classIds: Iterable<string>): Promise<Map<string, string>> {
  const ids = [...new Set(classIds)].filter(id => id && id !== 'private')
  if (!ids.length) return new Map()
  const classes = await prisma.class.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  return new Map(classes.filter(c => c.name).map(c => [c.id, c.name]))
}

export function displayClassName<T extends { classId: string; className: string }>(row: T, names: Map<string, string>): T {
  const current = names.get(row.classId)
  return current ? { ...row, className: current } : row
}
