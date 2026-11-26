/**
 * Hoàn tác một lần chuyển lớp (POST /students/:id/enroll/:enrollmentId/transfer).
 *
 *   Xem trước (không ghi gì):  npx tsx scripts/undo-transfer.ts <studentId> <oldEnrollmentId>
 *   Thực hiện:                 npx tsx scripts/undo-transfer.ts <studentId> <oldEnrollmentId> --apply
 *
 * Đảo ngược đúng những gì transferEnrollment đã ghi:
 *   - ghi danh lớp cũ: DROPPED → ACTIVE, bỏ dropDate, bỏ dòng ghi chú "Chuyển từ lớp …";
 *   - xoá ghi danh lớp mới do lần chuyển tạo ra;
 *   - xoá các khoản điều chỉnh học phí (chuyển lớp) ghi cho lớp mới;
 *   - xoá phiếu học phí lớp mới (chỉ khi chưa thu tiền, chưa có hoá đơn MISA);
 *   - tính lại phiếu lớp cũ các tháng bị ảnh hưởng (phiếu đã thu/đã có HĐ được tính toán tự giữ nguyên);
 *   - đếm lại sĩ số hai lớp.
 * Dừng lại, không ghi gì, nếu có bất cứ thứ gì không khớp hoặc đã phát sinh tiền / hoá đơn / điểm danh ở lớp mới.
 */
import { prisma } from '../src/lib/db'
import { recountClassActiveStudents } from '../src/lib/classSync'
import { calculateTuitionForStudent } from '../src/services/tuitionCalculator'

const [studentId, oldEnrollmentId, flag] = process.argv.slice(2)
const APPLY = flag === '--apply'
const day = (d: Date | null) => d ? d.toISOString().slice(0, 10) : null
const key = (m: number, y: number) => `${y}-${String(m).padStart(2, '0')}`
const stop = (msg: string): never => { console.error(`\n✖ DỪNG: ${msg}\nKhông có gì bị thay đổi.`); process.exit(1) }

async function main() {
  if (!studentId || !oldEnrollmentId) stop('Thiếu tham số <studentId> <oldEnrollmentId>')

  const old = await prisma.classEnrollment.findFirst({ where: { id: oldEnrollmentId, studentId }, include: { class: true } })
  if (!old) return stop('Không tìm thấy ghi danh cũ')
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { fullName: true } })
  const noteLines = (old.notes ?? '').split('\n')
  const transferNote = [...noteLines].reverse().find(l => l.startsWith(`Chuyển từ lớp ${old.class.name} sang lớp `))
  if (old.status !== 'DROPPED' || !old.dropDate || !transferNote) stop('Ghi danh cũ không ở trạng thái "đã chuyển lớp"')

  // Ghi danh mới: cùng học viên, ACTIVE, ghi chú đúng câu chuyển lớp, bắt đầu ngay sau ngày nghỉ lớp cũ.
  const startDate = new Date(old.dropDate!.getTime() + 86400000)
  const candidates = await prisma.classEnrollment.findMany({
    where: { studentId, status: 'ACTIVE', notes: transferNote, enrollmentDate: startDate },
    include: { class: true, weekdayPlans: true },
  })
  if (candidates.length !== 1) stop(`Tìm thấy ${candidates.length} ghi danh lớp mới khớp (cần đúng 1)`)
  const neu = candidates[0]
  if (neu.weekdayPlans.length) stop('Ghi danh lớp mới đã được chỉnh lịch học riêng sau khi chuyển — cần xử lý tay')
  if (await prisma.classEnrollment.findFirst({ where: { studentId, classId: old.classId, status: 'ACTIVE' } })) {
    stop(`Học viên đã có ghi danh ACTIVE khác ở lớp ${old.class.name}`)
  }
  const fromMonth = day(startDate)!.slice(0, 7)

  const attendance = await prisma.studentAttendance.count({
    where: { studentId, classId: neu.classId, session: { sessionDate: { gte: startDate } } },
  })
  if (attendance) stop(`Đã có ${attendance} lượt điểm danh ở lớp ${neu.class.name} — cần quyết định giữ hay xoá trước`)

  const adjustments = await prisma.tuitionAdjustment.findMany({
    where: { studentId, classId: neu.classId, createdAt: { gte: new Date(neu.createdAt.getTime() - 60000) }, reason: { contains: 'chuyển lớp' } },
  })

  const lockInfo = async (ids: string[]) => {
    const inv = ids.length ? await prisma.misaInvoice.findMany({
      where: { OR: [{ id: { in: ids } }, { recordIds: { hasSome: ids } }] }, select: { id: true, recordIds: true },
    }) : []
    return new Set(inv.flatMap(i => [i.id, ...i.recordIds]))
  }
  const newRecords = await prisma.tuitionRecord.findMany({
    where: { studentId, classId: neu.classId }, include: { _count: { select: { payments: true } } },
  })
  const newInvoiced = await lockInfo(newRecords.map(r => r.id))
  const lockedNew = newRecords.filter(r => r.status === 'PAID' || r.status === 'PARTIAL' || r.paidAmount > 0 || r._count.payments > 0 || newInvoiced.has(r.id))
  if (lockedNew.length) stop(`Phiếu lớp mới đã thu tiền / có hoá đơn: ${lockedNew.map(r => key(r.billingMonth, r.billingYear)).join(', ')}`)
  if (newRecords.some(r => key(r.billingMonth, r.billingYear) < fromMonth)) stop('Học viên có phiếu lớp mới trước ngày chuyển — từng học lớp này, cần xử lý tay')

  const oldRecords = (await prisma.tuitionRecord.findMany({ where: { studentId, classId: old.classId } }))
    .filter(r => key(r.billingMonth, r.billingYear) >= fromMonth)
  // Tháng tính lại phiếu lớp cũ: tháng bắt đầu chuyển + tháng có phiếu lớp mới (lớp mới chỉ được lập phiếu khi lớp cũ có phiếu tháng đó)
  // + tháng lớp cũ còn phiếu.
  const months = new Map<string, [number, number]>()
  const [fy, fm] = fromMonth.split('-').map(Number)
  if (oldRecords.length || newRecords.length) months.set(fromMonth, [fm, fy])
  for (const r of [...newRecords, ...oldRecords]) months.set(key(r.billingMonth, r.billingYear), [r.billingMonth, r.billingYear])

  console.log(`Học viên: ${student?.fullName} (${studentId})`)
  console.log(`Lần chuyển: ${transferNote}`)
  console.log(`\nSẽ thực hiện${APPLY ? '' : ' (XEM TRƯỚC — chưa ghi gì)'}:`)
  console.log(`  • Ghi danh ${old.id} lớp ${old.class.name}: DROPPED (nghỉ ${day(old.dropDate)}) → ACTIVE`)
  console.log(`  • Xoá ghi danh ${neu.id} lớp ${neu.class.name} (từ ${day(neu.enrollmentDate)})`)
  for (const a of adjustments) console.log(`  • Xoá điều chỉnh T${a.billingMonth}/${a.billingYear} ${a.amount.toLocaleString('vi-VN')}đ — ${a.reason}`)
  for (const r of newRecords) console.log(`  • Xoá phiếu lớp mới T${r.billingMonth}/${r.billingYear}: ${r.finalAmount.toLocaleString('vi-VN')}đ (${r.status})`)
  for (const r of oldRecords) console.log(`    Phiếu lớp cũ hiện tại T${r.billingMonth}/${r.billingYear}: ${r.finalAmount.toLocaleString('vi-VN')}đ (${r.status})`)
  for (const [k] of months) console.log(`  • Tính lại phiếu lớp cũ ${k} (phiếu đã thu / có HĐ sẽ được giữ nguyên)`)
  if (!APPLY) { console.log('\nChạy lại với --apply để thực hiện.'); return }

  await prisma.$transaction(async tx => {
    await tx.classEnrollment.update({
      where: { id: old.id },
      data: { status: 'ACTIVE', dropDate: null, notes: noteLines.filter(l => l !== transferNote).join('\n') || null },
    })
    await tx.classEnrollment.delete({ where: { id: neu.id } })
    await tx.tuitionAdjustment.deleteMany({ where: { id: { in: adjustments.map(a => a.id) } } })
    await tx.tuitionRecord.deleteMany({ where: { id: { in: newRecords.map(r => r.id) } } })
    await recountClassActiveStudents(old.classId, tx)
    await recountClassActiveStudents(neu.classId, tx)
  })
  console.log('\n✔ Đã khôi phục ghi danh, xoá ghi danh / điều chỉnh / phiếu lớp mới.')
  for (const [k, [m, y]] of months) {
    const { tuitionRecord } = await calculateTuitionForStudent(studentId, old.classId, m, y)
    console.log(`  Phiếu lớp cũ ${k}: ${Number(tuitionRecord.finalAmount).toLocaleString('vi-VN')}đ, ${tuitionRecord.totalSessions} buổi (${tuitionRecord.status})`)
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
