// Điểm kiểm tra, nhận xét tháng (và BTVN) được nhập trên theodoi.cqt.vn — hệ thống riêng cho giáo viên, trợ giảng, CTV.
// Trang phụ huynh (cqt.vn/hoc-vien/…) lấy dữ liệu học tập trực tiếp từ theodoi.

export const THEODOI_URL = 'https://theodoi.cqt.vn'

export function TheodoiNotice({ studentId }: { studentId?: string }) {
  const href = studentId ? `${THEODOI_URL}/hoc-vien/${encodeURIComponent(studentId)}` : `${THEODOI_URL}/btvn`
  return (
    <div className="bg-surface-container-lowest rounded-2xl p-8 text-center max-w-xl mx-auto mt-6 border border-outline-variant/20">
      <span className="material-symbols-outlined text-5xl text-primary" aria-hidden="true">school</span>
      <h2 className="font-headline text-lg font-bold text-on-surface mt-3">Học tập đã chuyển sang theodoi.cqt.vn</h2>
      <p className="text-sm text-on-surface-variant mt-2">
        Bài tập về nhà, điểm kiểm tra và nhận xét tháng được nhập trên trang theo dõi học tập.
        Phụ huynh vẫn xem như cũ trên trang chia sẻ của học viên.
      </p>
      <a href={href} target="_blank" rel="noopener noreferrer"
        className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90">
        <span className="material-symbols-outlined text-base" aria-hidden="true">open_in_new</span>
        {studentId ? 'Mở học viên trên theodoi' : 'Mở theodoi.cqt.vn'}
      </a>
    </div>
  )
}

export default function MovedToTheodoi() {
  return <div className="p-4 sm:p-6"><TheodoiNotice /></div>
}
