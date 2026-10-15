import { db, C, toObj } from '../lib/firebase'
import { getPaymentStatus } from './tuitionCalculator'
import type { TuitionRecord } from '../types/models'

/** Read only: recover a lost response without replaying a payment or creating an invoice. */
export async function getTuitionWorkflowResult(input: { studentId: string; classId: string; month: number; year: number; recordId?: string }) {
  let doc: FirebaseFirestore.DocumentSnapshot
  if (input.recordId) {
    doc = await db.collection(C.TUITION_RECORDS).doc(input.recordId).get()
  } else {
    const snap = await db.collection(C.TUITION_RECORDS).where('studentId', '==', input.studentId)
      .where('classId', '==', input.classId).where('billingMonth', '==', input.month).where('billingYear', '==', input.year).limit(2).get()
    if (snap.size > 1) throw Object.assign(new Error('Có nhiều phiếu phù hợp; cần kiểm tra trước khi thực hiện lại.'), { status: 409 })
    if (snap.empty) return null
    doc = snap.docs[0]
  }
  if (!doc.exists) return null
  const record = toObj<TuitionRecord>(doc as FirebaseFirestore.QueryDocumentSnapshot)
  if (record.studentId !== input.studentId || record.classId !== input.classId || record.billingMonth !== input.month || record.billingYear !== input.year) {
    throw Object.assign(new Error('Phiếu không khớp học viên, lớp hoặc kỳ học phí.'), { status: 409 })
  }
  const [finalStatus, invoiceDoc] = await Promise.all([
    getPaymentStatus(doc.id), db.collection('misaInvoices').doc(doc.id).get(),
  ])
  const invoice = invoiceDoc.data()
  return {
    recordId: doc.id, paid: finalStatus.remaining <= 0, finalStatus,
    invoiceDraft: { enabled: true, status: invoice?.status || 'OUTCOME_UNKNOWN',
      refId: invoice?.refId || '', transactionId: invoice?.transactionId || '',
      message: invoice?.lastErrorMessage || (invoice ? '' : 'Phiếu đã lưu nhưng chưa xác nhận được kết quả hóa đơn. Kiểm tra danh sách hóa đơn trước khi tạo lại.') },
  }
}
