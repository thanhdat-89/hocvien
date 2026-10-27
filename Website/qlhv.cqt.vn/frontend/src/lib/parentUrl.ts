const IS_LOCAL =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')

// Trang chia sẻ phụ huynh nằm ở site cqt.vn (repo cqt.vn, thư mục hoc-vien/).
export function buildParentUrl(studentId: string) {
  return IS_LOCAL
    ? `http://localhost:5174/hoc-vien/index.html?id=${encodeURIComponent(studentId)}`
    : `https://www.cqt.vn/hoc-vien/${encodeURIComponent(studentId)}`
}
