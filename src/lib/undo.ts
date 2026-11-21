import { Prisma } from '@prisma/client'
import { prisma, newId, type Tx } from './db'
import { createError } from '../middleware/errorHandler'

/**
 * Hoàn tác thao tác nguy hiểm bằng ảnh chụp dữ liệu (bảng undo_snapshots, giữ 30 ngày).
 *
 *  kind "delete" — xoá hẳn một bản ghi kéo theo dữ liệu con (xoá học viên): chụp bản ghi gốc + mọi dòng sẽ mất theo khoá
 *    ngoại (CASCADE / RESTRICT mà route tự xoá), và các liên kết SET NULL. Hoàn tác = thêm lại các dòng còn thiếu.
 *  kind "batch" — ghi đè hàng loạt trong một phạm vi (tính học phí hàng loạt, tạo buổi học): chụp các dòng trong phạm vi
 *    trước và sau thao tác. Hoàn tác từng dòng, chỉ khi dòng đó chưa bị sửa sau thao tác:
 *      sửa → trả về giá trị trước; tạo mới → xoá (bỏ qua nếu đã có dữ liệu con, ví dụ thanh toán / điểm danh / hoá đơn);
 *      thao tác xoá mất → thêm lại. Dòng đã đổi sau thao tác → bỏ qua và báo lại.
 * Đọc/ghi bằng SQL thô theo danh mục bảng của PostgreSQL nên dùng được cho mọi bảng; tên bảng / cột chỉ lấy từ danh mục.
 */
export const UNDO_KEEP_DAYS = 30
type Row = Record<string, unknown>
type Cond = string | number | null | Array<string | null> | { gte: string; lt: string }
export interface Scope { table: string; where: Record<string, Cond> }
interface TableSnap { pk: string[]; scope?: Scope['where']; before: Row[]; after?: Row[] }
interface SnapData { root?: { table: string; id: string }; tables: Record<string, TableSnap>; relinks?: Array<{ table: string; pk: Row; column: string; value: unknown }> }
export interface UndoResult { restored: number; reverted: number; deleted: number; skipped: Array<{ table: string; reason: string; count: number }> }

// ── Danh mục bảng (cache cả tiến trình; schema chỉ đổi khi deploy) ─────────────────────────────
interface Fk { child: string; column: string; parent: string; parentColumn: string; onDelete: string }
interface Catalog { columns: Map<string, Map<string, string>>; pk: Map<string, string[]>; fks: Fk[] }
let catalogCache: Promise<Catalog> | null = null
function catalog(): Promise<Catalog> {
  catalogCache ??= (async () => {
    const cols = await prisma.$queryRawUnsafe<Array<{ t: string; c: string; ty: string }>>(`
      select c.relname t, a.attname c, format_type(a.atttypid, a.atttypmod) ty from pg_attribute a
      join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`)
    const pks = await prisma.$queryRawUnsafe<Array<{ t: string; c: string }>>(`
      select c.relname t, a.attname c from pg_index i join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where n.nspname = 'public' and i.indisprimary order by a.attnum`)
    const fks = await prisma.$queryRawUnsafe<Fk[]>(`
      select ch.relname child, ca.attname "column", pa.relname parent, pp.attname "parentColumn", k.confdeltype::text "onDelete"
      from pg_constraint k join pg_class ch on ch.oid = k.conrelid join pg_class pa on pa.oid = k.confrelid
      join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = k.conkey[1]
      join pg_attribute pp on pp.attrelid = k.confrelid and pp.attnum = k.confkey[1]
      where k.contype = 'f' and array_length(k.conkey, 1) = 1`)
    const columns = new Map<string, Map<string, string>>()
    for (const r of cols) (columns.get(r.t) ?? columns.set(r.t, new Map()).get(r.t)!).set(r.c, r.ty)
    const pk = new Map<string, string[]>()
    for (const r of pks) (pk.get(r.t) ?? pk.set(r.t, []).get(r.t)!).push(r.c)
    return { columns, pk, fks }
  })().catch(err => { catalogCache = null; throw err })
  return catalogCache
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`
function colType(cat: Catalog, table: string, column: string) {
  const ty = cat.columns.get(table)?.get(column)
  if (!ty) throw new Error(`undo: không có cột ${table}.${column}`)
  return ty
}

/** Điều kiện WHERE có tham số từ phạm vi (tên cột kiểm theo danh mục, giá trị ép đúng kiểu cột). */
function whereSql(cat: Catalog, table: string, where: Scope['where'], params: unknown[], alias = 't') {
  const parts: string[] = []
  for (const [column, cond] of Object.entries(where)) {
    const ty = colType(cat, table, column), col = `${alias}.${q(column)}`
    if (cond === null) parts.push(`${col} is null`)
    else if (Array.isArray(cond)) {
      const values = cond.filter((v): v is string => v !== null)
      const or = [`${col} = any(cast($${params.push(values)} as ${ty}[]))`]
      if (values.length < cond.length) or.push(`${col} is null`)
      parts.push(`(${or.join(' or ')})`)
    } else if (typeof cond === 'object') {
      parts.push(`${col} >= cast($${params.push(cond.gte)} as ${ty}) and ${col} < cast($${params.push(cond.lt)} as ${ty})`)
    } else parts.push(`${col} = cast($${params.push(String(cond))} as ${ty})`)
  }
  return parts.length ? parts.join(' and ') : 'true'
}

async function selectRows(db: Tx | typeof prisma, cat: Catalog, table: string, where: Scope['where']): Promise<Row[]> {
  const params: unknown[] = []
  const sql = `select to_jsonb(t) r from public.${q(table)} t where ${whereSql(cat, table, where, params)}`
  return (await db.$queryRawUnsafe<Array<{ r: Row }>>(sql, ...params)).map(x => x.r)
}

const pkOf = (pk: string[], row: Row) => JSON.stringify(pk.map(c => row[c]))
const pkWhere = (pk: string[], row: Row): Scope['where'] => Object.fromEntries(pk.map(c => [c, row[c] as string]))
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Row)[k])}`).join(',')}}`
  return JSON.stringify(v)
}
const same = (a: Row, b: Row) => canonical(a) === canonical(b)

/** Thứ tự bảng: bảng được tham chiếu trước bảng con */
function fkOrder(cat: Catalog, tables: string[]) {
  const set = new Set(tables), done = new Set<string>(), order: string[] = []
  while (order.length < set.size) {
    const ready = [...set].filter(t => !done.has(t) && cat.fks.every(f => f.child !== t || f.parent === t || !set.has(f.parent) || done.has(f.parent)))
    if (!ready.length) throw new Error('undo: vòng khoá ngoại')
    for (const t of ready) { done.add(t); order.push(t) }
  }
  return order
}

// ── Chụp ──────────────────────────────────────────────────────────────────────────────────────
interface Who { userId: string; branchId?: string | null }

async function save(kind: string, label: string, data: SnapData, who: Who, afterAt: Date | null) {
  const id = newId()
  await prisma.undoSnapshot.create({ data: {
    id, kind, label, data: data as unknown as Prisma.InputJsonValue, branchId: who.branchId ?? null, createdById: who.userId,
    afterAt, expiresAt: new Date(Date.now() + UNDO_KEEP_DAYS * 86400_000),
  } })
  return id
}

/** Trước khi xoá hẳn `table`.id: chụp bản ghi + mọi dòng con sẽ mất theo (theo khoá ngoại CASCADE / RESTRICT). */
export async function snapshotDelete(table: string, id: string, label: string, who: Who): Promise<string> {
  const cat = await catalog()
  const tables: Record<string, TableSnap> = {}
  const relinks: NonNullable<SnapData['relinks']> = []
  const add = (t: string, rows: Row[]) => {
    const snap = tables[t] ??= { pk: cat.pk.get(t) ?? [], before: [] }
    const seen = new Set(snap.before.map(r => pkOf(snap.pk, r)))
    const fresh = rows.filter(r => !seen.has(pkOf(snap.pk, r)))
    snap.before.push(...fresh)
    return fresh
  }
  const queue: Array<[string, Row[]]> = [[table, add(table, await selectRows(prisma, cat, table, { id }))]]
  if (!queue[0][1].length) throw createError('Không tìm thấy dữ liệu cần xoá', 404)
  while (queue.length) {
    const [parent, rows] = queue.shift()!
    for (const fk of cat.fks.filter(f => f.parent === parent && f.child !== parent)) {
      const values = [...new Set(rows.map(r => r[fk.parentColumn]).filter(v => v != null).map(String))]
      if (!values.length) continue
      const children = await selectRows(prisma, cat, fk.child, { [fk.column]: values })
      if (fk.onDelete === 'n') {
        const pk = cat.pk.get(fk.child) ?? []
        for (const c of children) relinks.push({ table: fk.child, pk: Object.fromEntries(pk.map(k => [k, c[k]])), column: fk.column, value: c[fk.column] })
      } else if (fk.onDelete === 'c' || fk.onDelete === 'r') {
        const fresh = add(fk.child, children)
        if (fresh.length) queue.push([fk.child, fresh])
      }
    }
  }
  return save('delete', label, { root: { table, id }, tables, relinks }, who, new Date())
}

/** Trước thao tác ghi đè hàng loạt: chụp các dòng trong phạm vi. Gọi captureAfter khi thao tác xong. */
export async function snapshotBatch(scopes: Scope[], label: string, who: Who): Promise<string> {
  const cat = await catalog()
  const tables: Record<string, TableSnap> = {}
  for (const s of scopes) tables[s.table] = { pk: cat.pk.get(s.table) ?? [], scope: s.where, before: await selectRows(prisma, cat, s.table, s.where) }
  return save('batch', label, { tables }, who, null)
}

export async function captureAfter(id: string) {
  const cat = await catalog()
  const snap = await prisma.undoSnapshot.findUnique({ where: { id } })
  if (!snap || snap.kind !== 'batch') return
  const data = snap.data as unknown as SnapData
  for (const [t, s] of Object.entries(data.tables)) s.after = await selectRows(prisma, cat, t, s.scope ?? {})
  await prisma.undoSnapshot.update({ where: { id }, data: { data: data as unknown as Prisma.InputJsonValue, afterAt: new Date() } })
}

export async function discardSnapshot(id: string) {
  await prisma.undoSnapshot.deleteMany({ where: { id, undoneAt: null } })
}

/**
 * Gắn ảnh chụp vào request: thao tác lỗi → bỏ ảnh chụp; thành công → chụp "sau" (kind batch) và ghi undoId vào
 * nhật ký thao tác (Lịch sử hoạt động hiện nút Hoàn tác).
 */
export function trackUndo(req: { activity?: { after?: unknown } }, res: { statusCode: number; on(e: 'finish', f: () => void): unknown }, id: string, batch: boolean) {
  req.activity = { ...req.activity, after: { ...(req.activity?.after as object ?? {}), undoId: id } }
  res.on('finish', () => {
    const ok = res.statusCode >= 200 && res.statusCode < 300
    void (ok ? (batch ? captureAfter(id) : Promise.resolve()) : discardSnapshot(id))
      .catch(err => console.error('[undo] snapshot', id, err?.message))
  })
}

// ── Hoàn tác ──────────────────────────────────────────────────────────────────────────────────
/** Dòng con đang trỏ tới `row` (khoá ngoại bất kỳ) — có thì không xoá dòng do thao tác tạo ra */
async function blockers(tx: Tx, cat: Catalog, table: string, row: Row): Promise<string | null> {
  for (const fk of cat.fks.filter(f => f.parent === table && f.child !== table)) {
    const v = row[fk.parentColumn]
    if (v == null) continue
    const params: unknown[] = []
    const hit = await tx.$queryRawUnsafe<unknown[]>(`select 1 from public.${q(fk.child)} t where ${whereSql(cat, fk.child, { [fk.column]: String(v) }, params)} limit 1`, ...params)
    if (hit.length) return `đã có dữ liệu ở ${fk.child}`
  }
  // Hoá đơn MISA trỏ tới phiếu học phí qua mảng recordIds (không có khoá ngoại)
  if (table === 'tuition_records') {
    const misa = await tx.$queryRawUnsafe<unknown[]>(`select 1 from misa_invoices where $1 = any("recordIds") limit 1`, String(row.id))
    if (misa.length) return 'đã có hoá đơn MISA'
  }
  return null
}

async function insertRows(tx: Tx, table: string, rows: Row[]) {
  if (!rows.length) return 0
  const r = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`with ins as (insert into public.${q(table)}
    select * from jsonb_populate_recordset(null::public.${q(table)}, $1::jsonb) on conflict do nothing returning 1)
    select count(*) n from ins`, JSON.stringify(rows))
  return Number(r[0].n)
}

async function updateRow(tx: Tx, cat: Catalog, table: string, pk: string[], row: Row) {
  const cols = [...cat.columns.get(table)!.keys()].filter(c => !pk.includes(c))
  const set = cols.map(c => `${q(c)} = r.${q(c)}`).join(', ')
  const on = pk.map(c => `t.${q(c)} = r.${q(c)}`).join(' and ')
  await tx.$executeRawUnsafe(`update public.${q(table)} t set ${set} from jsonb_populate_record(null::public.${q(table)}, $1::jsonb) r where ${on}`, JSON.stringify(row))
}

async function deleteRow(tx: Tx, cat: Catalog, table: string, pk: string[], row: Row) {
  const params: unknown[] = []
  await tx.$executeRawUnsafe(`delete from public.${q(table)} t where ${whereSql(cat, table, pkWhere(pk, row), params)}`, ...params)
}

/** Đếm lại sĩ số lớp (classes.activeStudentCount) cho các lớp có ghi danh trong `rows` */
async function recountClasses(tx: Tx, classIds: string[]) {
  if (!classIds.length) return
  await tx.$executeRawUnsafe(`update classes c set "activeStudentCount" = (select count(*) from class_enrollments e
    where e."classId" = c.id and e.status = 'ACTIVE') where c.id = any($1::text[])`, classIds)
}

export async function undoSnapshot(id: string, userId: string, dryRun: boolean): Promise<UndoResult> {
  const cat = await catalog()
  const run = async (tx: Tx) => {
    const [snap] = await tx.$queryRawUnsafe<Array<{ kind: string; data: SnapData; undoneAt: Date | null; afterAt: Date | null; expiresAt: Date }>>(
      `select kind, data, "undoneAt", "afterAt", "expiresAt" from undo_snapshots where id = $1 for update`, id)
    if (!snap) throw createError('Không còn dữ liệu để hoàn tác (đã quá 30 ngày hoặc không tồn tại)', 404)
    if (snap.undoneAt) throw createError('Thao tác này đã được hoàn tác rồi', 409)
    if (!snap.afterAt) throw createError('Thao tác vẫn đang chạy hoặc đã lỗi — chưa hoàn tác được', 409)
    const result: UndoResult = { restored: 0, reverted: 0, deleted: 0, skipped: [] }
    const skip = (table: string, reason: string) => {
      const s = result.skipped.find(x => x.table === table && x.reason === reason)
      if (s) s.count++; else result.skipped.push({ table, reason, count: 1 })
    }
    const order = fkOrder(cat, Object.keys(snap.data.tables))
    const touchedClasses = new Set<string>()

    if (snap.kind === 'delete') {
      for (const t of order) {
        const s = snap.data.tables[t]
        if (dryRun) {
          let missing = 0
          for (const row of s.before) if (!(await selectRows(tx, cat, t, pkWhere(s.pk, row))).length) missing++
          result.restored += missing
          if (missing < s.before.length) for (let i = missing; i < s.before.length; i++) skip(t, 'đã có lại')
        } else {
          const n = await insertRows(tx, t, s.before)
          result.restored += n
          for (let i = n; i < s.before.length; i++) skip(t, 'đã có lại')
        }
        if (t === 'class_enrollments') s.before.forEach(r => touchedClasses.add(String(r.classId)))
      }
      if (!dryRun) for (const l of snap.data.relinks ?? []) {
        const params: unknown[] = [l.value]
        await tx.$executeRawUnsafe(`update public.${q(l.table)} t set ${q(l.column)} = cast($1 as ${colType(cat, l.table, l.column)})
          where t.${q(l.column)} is null and ${whereSql(cat, l.table, l.pk as Scope['where'], params)}`, ...params)
      }
    } else {
      // Xoá dòng do thao tác tạo (con trước), rồi sửa / thêm lại (cha trước)
      const plans = new Map<string, { revert: Row[]; remove: Row[]; reinsert: Row[] }>()
      for (const t of order) {
        const s = snap.data.tables[t], before = new Map(s.before.map(r => [pkOf(s.pk, r), r]))
        const after = new Map((s.after ?? []).map(r => [pkOf(s.pk, r), r]))
        const current = new Map((await selectRows(tx, cat, t, s.scope ?? {})).map(r => [pkOf(s.pk, r), r]))
        const plan = { revert: [] as Row[], remove: [] as Row[], reinsert: [] as Row[] }
        for (const [k, a] of after) {
          const b = before.get(k), c = current.get(k)
          if (b && same(a, b)) continue                             // thao tác không đụng tới
          if (!c) { skip(t, 'đã bị xoá sau thao tác'); continue }
          if (!same(a, c)) { skip(t, 'đã được sửa sau thao tác'); continue }
          if (b) plan.revert.push(b)
          else {
            const why = await blockers(tx, cat, t, c)
            if (why) skip(t, why); else plan.remove.push(c)
          }
        }
        for (const [k, b] of before) if (!after.has(k) && !current.has(k)) plan.reinsert.push(b)
        plans.set(t, plan)
      }
      for (const t of [...order].reverse()) {
        const s = snap.data.tables[t]
        for (const row of plans.get(t)!.remove) { if (!dryRun) await deleteRow(tx, cat, t, s.pk, row); result.deleted++ }
      }
      for (const t of order) {
        const s = snap.data.tables[t], plan = plans.get(t)!
        for (const row of plan.revert) { if (!dryRun) await updateRow(tx, cat, t, s.pk, row); result.reverted++ }
        result.restored += dryRun ? plan.reinsert.length : await insertRows(tx, t, plan.reinsert)
        if (t === 'class_enrollments') [...plan.revert, ...plan.remove, ...plan.reinsert].forEach(r => touchedClasses.add(String(r.classId)))
      }
    }

    if (!dryRun) {
      await recountClasses(tx, [...touchedClasses])
      await tx.$executeRawUnsafe(`update undo_snapshots set "undoneAt" = now(), "undoneById" = $2, "undoResult" = $3::jsonb where id = $1`,
        id, userId, JSON.stringify(result))
    }
    return result
  }
  return prisma.$transaction(run, { timeout: 60_000 })
}

/** Xoá ảnh chụp quá hạn (cron dọn nhật ký) */
export async function purgeUndoSnapshots() {
  const { count } = await prisma.undoSnapshot.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return count
}
