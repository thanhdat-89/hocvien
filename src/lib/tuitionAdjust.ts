// Khoản điều chỉnh học phí một tháng (bảng tuition_adjustments): + thu thêm, − giảm.
// Thu thêm cộng vào học phí gốc, giảm cộng vào phần giảm trừ — để hoá đơn MISA luôn giữ "gốc − giảm = thành tiền", không có số âm.

export interface AdjustmentLike { amount: number; reason: string }

/** Cộng các khoản điều chỉnh vào học phí gốc / giảm trừ (giảm trừ không vượt học phí gốc). */
export function applyAdjustments(baseAmount: number, discountAmount: number, adjustments: AdjustmentLike[]) {
  const adjustmentAmount = adjustments.reduce((sum, a) => sum + a.amount, 0)
  const surcharge = adjustments.filter(a => a.amount > 0).reduce((sum, a) => sum + a.amount, 0)
  const reduction = adjustments.filter(a => a.amount < 0).reduce((sum, a) => sum - a.amount, 0)
  const base = baseAmount + surcharge
  const discount = Math.min(discountAmount + reduction, base)
  return {
    baseAmount: base,
    discountAmount: discount,
    adjustmentAmount,
    adjustmentNote: adjustments.length ? adjustments.map(a => a.reason).join('; ') : null,
  }
}
