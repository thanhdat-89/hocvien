import * as XLSX from 'xlsx'

interface InvoiceRow {
  studentName: string
  className: string
  totalSessions: number
  ratePerSession: number
  discountAmount: number
  finalAmount: number
  /** Điều chỉnh học phí tháng: + thu thêm (tách thành dòng riêng), − giảm (đã gồm trong khuyến mãi) */
  adjustmentAmount?: number
  adjustmentNote?: string | null
}

// Header text, row positions and column widths from Mẫu xuất hóa đơn.xlsx.
const headerRows: (string | number)[][] = [
  [
    "File mẫu danh sách hóa đơn để nhập vào phần mềm ",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "Hướng dẫn:",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "- Điền dữ liệu hóa đơn cần lập trên phần mềm vào các cột tương ứng trên file này",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "- Các cột có dấu (*) là những cột bắt buộc",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "- Nếu muốn nhập thêm thông tin khác, người dùng có thể tự thêm cột trên file này (VD: Mã khách hàng, Mã hàng, Tỷ lệ chiết khấu)",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "- Các dòng dữ liệu phía dưới chỉ là ví dụ minh họa",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "Số thứ tự hóa đơn (*)",
    "Người mua hàng",
    "Hình thức thanh toán (*)",
    "Tên hàng hóa/dịch vụ (*)",
    "ĐVT",
    "Số lượng",
    "Đơn giá",
    "Khuyến mãi",
    "Thành tiền"
  ]
]

export function buildInvoiceWorkbook(rows: readonly InvoiceRow[]) {
  // Mỗi dòng phải giữ "số lượng × đơn giá − khuyến mãi = thành tiền": khoản thu thêm (điều chỉnh dương)
  // tách thành dòng riêng cùng STT (cùng hoá đơn); khoản giảm đã nằm trong cột khuyến mãi.
  const data = rows.flatMap((row, index) => {
    const surcharge = Math.max(0, row.adjustmentAmount ?? 0)
    const lines: (string | number)[][] = [[
      String(index + 1),
      row.studentName,
      'Chuyển khoản/ Tiền mặt',
      row.className,
      'Buổi học',
      row.totalSessions,
      row.ratePerSession,
      row.discountAmount,
      row.finalAmount - surcharge,
    ]]
    if (surcharge) lines.push([
      String(index + 1),
      row.studentName,
      'Chuyển khoản/ Tiền mặt',
      `Thu thêm: ${row.adjustmentNote || 'điều chỉnh học phí'}`,
      'Lần',
      1,
      surcharge,
      0,
      surcharge,
    ])
    return lines
  })
  const sheet = XLSX.utils.aoa_to_sheet([...headerRows, ...data])
  sheet['!cols'] = [{"wch": 22.33}, {"wch": 20}, {"wch": 24}, {"wch": 24.83}, {"wch": 14.83}, {"wch": 14.83}, {"wch": 24.83}, {"wch": 24.83}, {"wch": 24.83}]
  for (let index = 0; index < data.length; index++) {
    sheet[`A${index + 9}`].z = '@'
    sheet[`I${index + 9}`].z = '#,##0'
  }
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Hóa đơn bán hàng')
  return workbook
}
