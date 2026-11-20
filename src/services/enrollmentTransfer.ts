import { prisma, newId, toDay } from '../lib/db'
import { enrollmentDoc, enrollmentInclude } from '../lib/docs'
import { recountClassActiveStudents } from '../lib/classSync'
import type { ClassEnrollment } from '../types/models'
import { calculateTuitionForStudent, estimateClassTuition } from './tuitionCalculator'
import { isDate, monthKey, type MonthImpact } from './enrollmentWeekdays'
import { gradeOf } from './schoolYearRollover'

// Chuyển lớp trong cùng khối = nghỉ lớp cũ (đến hết ngày liền trước) + đăng ký lớp mới (từ ngày bắt đầu), ghi trong một lần.
//
// Tháng mà phiếu lớp cũ CHƯA thu/chưa xuất HĐ: tính lại phiếu lớp cũ (không còn buổi thì xoá) và lập phiếu lớp mới riêng.
//
// Tháng mà phiếu lớp cũ ĐÃ thu/đã xuất HĐ: phiếu lớp cũ giữ nguyên và "đại diện" cho cả tháng:
//   - các buổi lớp mới trong tháng đó không thu riêng (phiếu lớp mới 0đ, ghi "đã gồm trong phiếu lớp cũ");
//   - chênh lệch = học phí thực tế (lớp cũ đến ngày nghỉ + lớp mới từ ngày bắt đầu) − số tiền trên phiếu lớp cũ;
//     ≠ 0 thì (nếu người dùng đồng ý) ghi vào phiếu lớp mới tháng kế tiếp: dương = thu thêm, âm = giảm.

const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }) }
const dayBefore = (date: string) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
const vnDate = (date: string) => date.split('-').reverse().join('/')
const nextMonth = (month: number, year: number): [number, number] => month === 12 ? [1, year + 1] : [month + 1, year]

export interface TransferInput {
  toClassId?: unknown
  /** Ngày bắt đầu học lớp mới; lớp cũ học đến hết ngày liền trước. */
  startDate?: unknown
  /** Có ghi khoản chênh lệch vào học phí lớp mới tháng sau không — bắt buộc khi chênh lệch khác 0. */
  applyAdjustment?: unknown
}

/** covered: tháng lớp cũ đã thu — buổi lớp mới đã gồm trong phiếu lớp cũ (phiếu lớp mới 0đ). */
type Outcome = MonthImpact['outcome'] | 'create' | 'covered'
export interface TransferMonth extends Omit<MonthImpact, 'outcome'> { outcome: Outcome }

export interface TransferSettlement {
  /** Từng tháng lớp cũ đã thu: số tiền trên phiếu và học phí thực tế sau khi chuyển. */
  months: { month: number; year: number; paid: number; actual: number }[]
  /** Chênh lệch = thực tế − đã thu: dương = thu thêm, âm = giảm, 0 = không điều chỉnh. */
  amount: number
  /** Tháng ghi điều chỉnh vào phiếu lớp mới. */
  month: number
  year: number
  /** Học phí gốc lớp mới tháng điều chỉnh (chưa gồm điều chỉnh) — để cảnh báo khi khoản giảm lớn hơn. */
  nextMonthBase: number
}

async function prepareTransfer(studentId: string, enrollmentId: string, input: TransferInput) {
  const row = await prisma.classEnrollment.findFirst({ where: { id: enrollmentId, studentId }, include: { ...enrollmentInclude, class: true } })
  if (!row) return fail('Không tìm thấy ghi danh', 404)
  const old: ClassEnrollment = enrollmentDoc(row)
  if (old.status !== 'ACTIVE') fail('Lớp này học viên đã nghỉ', 409)

  if (typeof input.toClassId !== 'string' || !input.toClassId) fail('Chưa chọn lớp chuyển đến')
  const toClassId = input.toClassId as string
  if (toClassId === old.classId) fail('Lớp chuyển đến trùng lớp đang học')
  const target = await prisma.class.findUnique({ where: { id: toClassId } })
  if (!target) return fail('Không tìm thấy lớp chuyển đến', 404)
  if (target.status !== 'ACTIVE') fail(`Lớp ${target.name} không còn hoạt động`)
  if (target.branchId !== row.class.branchId) fail('Chỉ chuyển được sang lớp cùng cơ sở')
  const fromGrade = gradeOf(row.class), toGrade = gradeOf(target)
  if (!fromGrade || fromGrade !== toGrade) fail(`Chỉ chuyển được sang lớp cùng khối${fromGrade ? ` ${fromGrade}` : ''}`)
  const already = await prisma.classEnrollment.findFirst({ where: { studentId, classId: toClassId, status: 'ACTIVE' }, select: { id: true } })
  if (already) fail(`Học viên đang học lớp ${target.name}`, 409)

  if (!isDate(input.startDate)) fail('Ngày bắt đầu học lớp mới không hợp lệ')
  const startDate = input.startDate as string
  if (startDate <= old.enrollmentDate) fail(`Ngày bắt đầu học lớp mới phải sau ngày đăng ký lớp cũ (${vnDate(old.enrollmentDate)})`)
  const dropDate = dayBefore(startDate)

  const newEnrollment = {
    id: '__transfer__', classId: toClassId, studentId, enrollmentDate: startDate, status: 'ACTIVE',
    createdAt: new Date().toISOString(), weekdayPlans: [], // chuyển lớp luôn học đủ các buổi của lớp mới
  } as unknown as ClassEnrollment
  return {
    old, oldClassName: row.class.name, target, startDate, dropDate,
    dropOld: (list: ClassEnrollment[]) => list.map(e => e.id === enrollmentId ? { ...e, status: 'DROPPED', dropDate } as ClassEnrollment : e),
    addNew: (list: ClassEnrollment[]) => [...list, newEnrollment],
  }
}

type Prepared = Awaited<ReturnType<typeof prepareTransfer>>

async function classRecords(studentId: string, classId: string, fromMonth: string) {
  const records = (await prisma.tuitionRecord.findMany({
    where: { studentId, classId },
    select: { id: true, billingMonth: true, billingYear: true, status: true, paidAmount: true, finalAmount: true, _count: { select: { payments: true } } },
  })).filter(r => monthKey(r.billingMonth, r.billingYear) >= fromMonth)
  const invoiced = records.length ? await prisma.misaInvoice.findMany({
    where: { OR: [{ id: { in: records.map(r => r.id) } }, { recordIds: { hasSome: records.map(r => r.id) } }] },
    select: { id: true, recordIds: true },
  }) : []
  const invoicedIds = new Set(invoiced.flatMap(i => [i.id, ...i.recordIds]))
  return records.map(r => ({ ...r, locked: r.status === 'PAID' || r.status === 'PARTIAL' || r.paidAmount > 0 || invoicedIds.has(r.id) }))
}

async function evaluateTransfer(studentId: string, p: Prepared) {
  const fromMonth = p.startDate.slice(0, 7)
  const [y, m] = fromMonth.split('-').map(Number)
  const [oldRecords, newRecords] = await Promise.all([
    classRecords(studentId, p.old.classId, fromMonth),
    classRecords(studentId, p.target.id, fromMonth),
  ])
  const find = (list: typeof oldRecords, key: string) => list.find(x => monthKey(x.billingMonth, x.billingYear) === key)

  // Tháng bắt đầu chuyển + các tháng sau mà lớp cũ hoặc lớp mới đã có phiếu.
  const months = new Map<string, [number, number]>([[fromMonth, [m, y]]])
  for (const r of [...oldRecords, ...newRecords]) months.set(monthKey(r.billingMonth, r.billingYear), [r.billingMonth, r.billingYear])

  type Row = TransferMonth & { recordId?: string }
  const oldClass: Row[] = [], newClass: Row[] = []
  const settled: TransferSettlement['months'] = []
  /** Khoản giảm cho phiếu lớp mới ở tháng lớp cũ đã thu (buổi lớp mới đã gồm trong phiếu lớp cũ). */
  const covered: { month: number; year: number; amount: number }[] = []

  for (const [key, [month, year]] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
    const r = find(oldRecords, key), rNew = find(newRecords, key)
    const [before, after, newBefore, newAfter] = await Promise.all([
      estimateClassTuition(studentId, p.old.classId, month, year),
      estimateClassTuition(studentId, p.old.classId, month, year, p.dropOld),
      rNew ? estimateClassTuition(studentId, p.target.id, month, year) : Promise.resolve(null),
      estimateClassTuition(studentId, p.target.id, month, year, p.addNew),
    ])
    const old: Row = {
      month, year, recordId: r?.id, outcome: 'none',
      before: { sessions: before.totalSessions, amount: before.finalAmount },
      after: { sessions: after.totalSessions, amount: after.finalAmount },
      record: r ? { status: r.status, finalAmount: r.finalAmount, locked: r.locked } : null,
    }
    const neu: Row = {
      month, year, recordId: rNew?.id, outcome: 'none',
      before: { sessions: newBefore?.totalSessions ?? 0, amount: newBefore?.finalAmount ?? 0 },
      after: { sessions: newAfter.totalSessions, amount: newAfter.finalAmount },
      record: rNew ? { status: rNew.status, finalAmount: rNew.finalAmount, locked: rNew.locked } : null,
    }
    if (r?.locked) {
      // Phiếu lớp cũ giữ nguyên, đại diện cho cả tháng; so với học phí thực tế sau khi chuyển.
      old.outcome = 'locked'
      const paid = r.finalAmount + (rNew?.locked ? rNew.finalAmount : 0)
      settled.push({ month, year, paid, actual: after.finalAmount + newAfter.finalAmount })
      if (rNew?.locked) neu.outcome = 'locked'
      else {
        neu.outcome = 'covered'
        neu.after = { sessions: newAfter.totalSessions, amount: 0 }
        if (newAfter.finalAmount > 0) covered.push({ month, year, amount: newAfter.finalAmount })
      }
    } else {
      old.outcome = !r ? 'none' : after.totalSessions === 0 && r._count.payments === 0 ? 'delete' : 'recalculate'
      neu.outcome = rNew ? (rNew.locked ? 'locked' : 'recalculate') : r && newAfter.totalSessions > 0 ? 'create' : 'none'
    }
    if (r || key === fromMonth) oldClass.push(old)
    newClass.push(neu)
  }

  let settlement: TransferSettlement | null = null
  if (settled.length) {
    const last = settled[settled.length - 1]
    const [am, ay] = nextMonth(last.month, last.year)
    const amount = settled.reduce((sum, s) => sum + s.actual - s.paid, 0)
    const adjKey = monthKey(am, ay)
    const base = await estimateClassTuition(studentId, p.target.id, am, ay, p.addNew)
    settlement = { months: settled, amount, month: am, year: ay, nextMonthBase: base.baseAmount }
    if (amount !== 0) {
      // Hiện tháng điều chỉnh của lớp mới với số tiền sau điều chỉnh.
      const withAdj = await estimateClassTuition(studentId, p.target.id, am, ay, p.addNew, [{ amount, reason: 'Chênh lệch chuyển lớp' }])
      const existing = newClass.find(n => n.month === am && n.year === ay)
      if (existing) existing.after = { sessions: withAdj.totalSessions, amount: withAdj.finalAmount }
      else {
        const rNew = find(newRecords, adjKey)
        newClass.push({
          month: am, year: ay, recordId: rNew?.id, outcome: rNew ? (rNew.locked ? 'locked' : 'recalculate') : 'none',
          before: { sessions: 0, amount: 0 }, after: { sessions: withAdj.totalSessions, amount: withAdj.finalAmount },
          record: rNew ? { status: rNew.status, finalAmount: rNew.finalAmount, locked: rNew.locked } : null,
        })
      }
    }
  }
  return { oldClass, newClass, settlement, covered }
}

const strip = ({ recordId: _id, ...rest }: TransferMonth & { recordId?: string }): TransferMonth => rest

/** Xem trước chuyển lớp: học phí hai lớp theo tháng và khoản chênh lệch (nếu có). Không ghi gì. */
export async function previewTransfer(studentId: string, enrollmentId: string, input: TransferInput) {
  const p = await prepareTransfer(studentId, enrollmentId, input)
  const { oldClass, newClass, settlement } = await evaluateTransfer(studentId, p)
  return {
    startDate: p.startDate, dropDate: p.dropDate,
    oldClass: { id: p.old.classId, name: p.oldClassName, months: oldClass.map(strip) },
    newClass: { id: p.target.id, name: p.target.name, months: newClass.map(strip) },
    settlement,
  }
}

const money = (n: number) => `${Math.abs(n).toLocaleString('vi-VN')}đ`

/** Chuyển lớp: nghỉ lớp cũ + đăng ký lớp mới (+ điều chỉnh nếu được chọn) trong một transaction, rồi tính lại học phí. */
export async function transferEnrollment(studentId: string, enrollmentId: string, input: TransferInput, userId?: string) {
  const p = await prepareTransfer(studentId, enrollmentId, input)
  const { oldClass, newClass, settlement, covered } = await evaluateTransfer(studentId, p)
  if (settlement?.amount && typeof input.applyAdjustment !== 'boolean') {
    fail(settlement.amount > 0
      ? `Học phí thực tế sau khi chuyển nhiều hơn số đã thu ${money(settlement.amount)}. Hãy chọn có thu thêm vào tháng ${settlement.month}/${settlement.year} hay không.`
      : `Số đã thu nhiều hơn học phí thực tế sau khi chuyển ${money(settlement.amount)}. Hãy chọn có giảm vào tháng ${settlement.month}/${settlement.year} hay không.`)
  }
  const applyAdjustment = !!settlement?.amount && input.applyAdjustment === true
  const note = `Chuyển từ lớp ${p.oldClassName} sang lớp ${p.target.name} từ ${vnDate(p.startDate)}`

  const created = await prisma.$transaction(async tx => {
    const oldNotes = p.old.notes ? `${p.old.notes}\n${note}` : note
    await tx.classEnrollment.update({ where: { id: enrollmentId }, data: { status: 'DROPPED', dropDate: toDay(p.dropDate)!, notes: oldNotes } })
    const enrollment = await tx.classEnrollment.create({
      data: { id: newId(), classId: p.target.id, studentId, enrollmentDate: toDay(p.startDate)!, status: 'ACTIVE', notes: note },
    })
    const adjust = (month: number, year: number, amount: number, reason: string) => tx.tuitionAdjustment.create({
      data: { id: newId(), studentId, classId: p.target.id, billingMonth: month, billingYear: year, amount, reason, createdById: userId ?? null },
    })
    for (const c of covered) {
      await adjust(c.month, c.year, -c.amount, `Đã gồm trong phiếu lớp ${p.oldClassName} T${c.month}/${c.year} (chuyển lớp từ ${vnDate(p.startDate)})`)
    }
    if (applyAdjustment && settlement) {
      const months = settlement.months.map(s => `T${s.month}/${s.year}`).join(', ')
      await adjust(settlement.month, settlement.year, settlement.amount,
        `${settlement.amount > 0 ? 'Thu thêm' : 'Giảm'} chênh lệch chuyển lớp từ ${p.oldClassName} (${months})`)
    }
    await recountClassActiveStudents(p.old.classId, tx)
    await recountClassActiveStudents(p.target.id, tx)
    return enrollment
  })

  for (const i of oldClass) {
    if (!i.recordId) continue
    if (i.outcome === 'delete') await prisma.tuitionRecord.delete({ where: { id: i.recordId } })
    else if (i.outcome === 'recalculate') await calculateTuitionForStudent(studentId, p.old.classId, i.month, i.year)
  }
  for (const i of newClass) {
    // Tháng "covered" cũng lập phiếu lớp mới (0đ) để thấy rõ buổi lớp mới đã gồm trong phiếu lớp cũ.
    if (i.outcome === 'create' || i.outcome === 'recalculate' || (i.outcome === 'covered' && i.after.sessions > 0)) {
      await calculateTuitionForStudent(studentId, p.target.id, i.month, i.year)
    }
  }

  const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { id: created.id }, include: enrollmentInclude })
  return { enrollment: enrollmentDoc(enrollment), adjustment: applyAdjustment ? settlement!.amount : 0 }
}
