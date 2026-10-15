import { getTuitionScheduleSummary } from './tuitionScheduleSummary'

export const invoiceHeaderRows = [
  ['File mẫu danh sách hóa đơn để nhập vào phần mềm '],
  ['Hướng dẫn:'],
  ['- Điền dữ liệu hóa đơn cần lập trên phần mềm vào các cột tương ứng trên file này'],
  ['- Các cột có dấu (*) là những cột bắt buộc'],
  ['- Nếu muốn nhập thêm thông tin khác, người dùng có thể tự thêm cột trên file này (VD: Mã khách hàng, Mã hàng, Tỷ lệ chiết khấu)'],
  ['- Các dòng dữ liệu phía dưới chỉ là ví dụ minh họa'],
  [''],
  ['Số thứ tự hóa đơn (*)', 'Người mua hàng', 'Hình thức thanh toán (*)', 'Tên hàng hóa/dịch vụ (*)', 'ĐVT', 'Số lượng', 'Đơn giá', 'Khuyến mãi', 'Thành tiền'],
].map(row => [...row, ...Array(9 - row.length).fill('')])

export async function buildTuitionExport(month: number, year: number) {
  const source = 'firebase'
  const rows = await getTuitionScheduleSummary(month, year)
  if (rows.some(row => ![row.totalSessions, row.ratePerSession, row.discountAmount, row.finalAmount].every(Number.isFinite))) {
    throw new Error('Invalid tuition export amounts')
  }
  return {
    month, year, source, generatedAt: new Date().toISOString(), sheetName: 'Hóa đơn bán hàng',
    studentCount: new Set(rows.map(row => row.studentId)).size, rowCount: rows.length,
    totalSessions: rows.reduce((sum, row) => sum + row.totalSessions, 0),
    tuitionDue: rows.reduce((sum, row) => sum + row.finalAmount, 0),
    values: [...invoiceHeaderRows, ...rows.map((row, index) => [String(index + 1), row.studentName, 'Chuyển khoản/ Tiền mặt', row.className, 'Buổi học', row.totalSessions, row.ratePerSession, row.discountAmount, row.finalAmount])],
  }
}
