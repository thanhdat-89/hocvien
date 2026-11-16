import * as XLSX from 'xlsx'

interface InvoiceRow {
  studentName: string
  className: string
  totalSessions: number
  ratePerSession: number
  discountAmount: number
  finalAmount: number
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
  const data = rows.map((row, index) => [
    String(index + 1),
    row.studentName,
    'Chuyển khoản/ Tiền mặt',
    row.className,
    'Buổi học',
    row.totalSessions,
    row.ratePerSession,
    row.discountAmount,
    row.finalAmount,
  ])
  const sheet = XLSX.utils.aoa_to_sheet([...headerRows, ...data])
  sheet['!cols'] = [{"wch": 22.33}, {"wch": 20}, {"wch": 24}, {"wch": 24.83}, {"wch": 14.83}, {"wch": 14.83}, {"wch": 24.83}, {"wch": 24.83}, {"wch": 24.83}]
  for (let index = 0; index < rows.length; index++) {
    sheet[`A${index + 9}`].z = '@'
    sheet[`I${index + 9}`].z = '#,##0'
  }
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Hóa đơn bán hàng')
  return workbook
}
