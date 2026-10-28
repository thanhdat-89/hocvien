# Chuyển QLHV từ Firestore sang PostgreSQL trên VPS

Đích: database `qlhv`, role `qlhv_app` trên PostgreSQL 17 của VPS Vietnix. Database và role riêng — không dùng chung với `hocthemtoan` (website) hay ngân hàng câu hỏi; `qlhv_app` không có quyền trên database khác và ngược lại. Backend qlhv chuyển từ Vercel sang VPS cùng lúc để kết nối PostgreSQL qua localhost; frontend qlhv và cqt.vn ở lại Vercel.

| File | Nội dung |
|---|---|
| `schema.prisma` | Schema (Prisma 6.19, cùng phiên bản với site hocthemtoan.vn) |
| `migrations/` | Migration Prisma; `20261028000000_init` gồm cả unique có điều kiện và CHECK mà Prisma không diễn đạt được |
| `import-firestore.ts` | Nhập bản export vào PostgreSQL trống, kiểm SHA-256, báo cáo bất thường và trường không ánh xạ |
| `export-firestore.cjs` | Xuất toàn bộ Firestore ra NDJSON + manifest SHA-256 (chỉ đọc) |

Đã kiểm tra: `prisma validate` hợp lệ; migration init chạy sạch trên PostgreSQL 17 (35 bảng); unique phiếu học phí chặn đúng phiếu học riêng trùng tháng.

## Quyết định thiết kế

- **ID** giữ nguyên ID Firestore (text) — link phụ huynh `/hoc-vien/<id>`, MISA và SePay không đổi.
- **Học riêng**: Firestore ghi `classId = "private"`; PostgreSQL dùng `classId = NULL`. Lớp truy cập dữ liệu chuyển đổi hai chiều để API trả về như cũ.
- **Bỏ denormalized** (`studentName`, `className`, `teacherName`, `primaryParent*`...) — lấy bằng join, nên tên lớp/học viên luôn là tên hiện tại. Giữ ảnh chụp có chủ đích ở: khuyến mãi đã áp (`promotionName/Type/Value`), người thu tiền (`receivedByName`), tên lớp trong bảng điểm, toàn bộ hoá đơn MISA (JSONB) và log.
- **Lịch sử đơn giá lớp** (`tuitionRateHistory[]`) thành bảng `class_tuition_rates`.
- **Sổ SePay, bảng điểm, log** không có khoá ngoại để không mất dấu vết khi bản ghi gốc bị xoá.
- **Unique thay cho transaction tự viết**: 1 ghi danh ACTIVE/học viên/lớp; 1 phiếu/học viên/lớp-hoặc-học-riêng/tháng; 1 buổi/lớp/ngày/giờ; `sepayId` duy nhất (chống webhook trùng); 1 điểm danh/buổi/học viên.

## Ánh xạ collection

| Firestore | PostgreSQL |
|---|---|
| users, teachers, students, subjects, classes, schedules, sessions, holidays, promotions, payments, notifications | cùng tên (snake_case) |
| students/{id}/parents, students/{id}/reviews | `parents`, `student_reviews` |
| classEnrollments, privateSchedules | `class_enrollments`, `private_sessions` |
| studentAttendances, teacherAttendances, studentPromotions, tuitionRecords, bankTransactions, monthlyScores | snake_case tương ứng |
| misaInvoices, misaInvoiceReplacements, invoiceDrafts, invoiceOutbox | `misa_invoices`, `misa_invoice_replacements`, `invoice_drafts`, `invoice_outbox` |
| monthlyInvoiceRuns (+ items) | `monthly_invoice_runs`, `monthly_invoice_run_items` |
| znsTemplates, znsLogs, adminAlerts, materials, leads, activityLogs, classIntegrityAudits | snake_case tương ứng |

**Không chuyển** (cache tự dựng lại hoặc dữ liệu cũ của ứng dụng khác):

- `readViews`, `readViewRevisions`, `aggregates` — cache đọc của Firestore; PostgreSQL tính trực tiếp.
- `__supabaseSyncQueue` — tàn dư hướng Supabase đã bỏ.
- `profiles`, `admin_activity_logs` — của cổng CTV cũ (`hocthemtoan-vn/ctv`), không phải qlhv. Lưu trong bản export để tra cứu.
- `leads` từ cổng CTV (snake_case, `collaborator_id`) được gộp vào bảng `leads` với `source = 'ctv'`.

## Hiện trạng dữ liệu (đo ngày 28/10/2026, chỉ đọc)

Bản export 28/10/2026: 5.443 tài liệu. Nhập thử vào PostgreSQL dev: không còn trường nào chưa ánh xạ; tổng học phí, tổng đã thu và tổng thanh toán từng tháng (07–10/2026) khớp hoàn toàn với Firestore. Khoảng 5.500 tài liệu; lớn nhất: activityLogs 2.024, privateSchedules 849, sessions 630, tuitionRecords 528, payments 514, misaInvoices 224, students 174.

Script nhập phải xử lý và báo cáo các điểm sau (không tự sửa im lặng):

| Vấn đề | Số lượng | Cách xử lý khi nhập |
|---|---|---|
| `students.dateOfBirth` dạng `m/d/yy` (nhập từ Excel kiểu Mỹ) | 81 | Đọc tháng trước, năm `yy` → `20yy`; năm sinh khớp khối lớp ở 76/81 |
| `students.dateOfBirth` không khớp khối lớp (năm 2026, 2018 cho HV lớp 8) | 5 | Giữ nguyên, báo cáo để sửa tay |
| `students.enrollmentDate` dạng `15-Jul` (thiếu năm) | 3 | Báo cáo để sửa tay; tạm dùng ngày của `createdAt` |
| `tuitionRecords.classId = "private"` | 90 | → `classId = NULL` |
| `studentPromotions.classId = "private"` | 6 | → `classId = NULL` |
| `monthlyScores.classId` trỏ tới lớp đã xoá | 3 | Giữ nguyên ID + tên lớp (không có khoá ngoại) |
| `sessions.scheduleId` trỏ tới lịch đã xoá | 1 | → `NULL` |
| `bankTransactions.matchedPaymentId` trỏ tới thanh toán đã xoá | 1 | Giữ nguyên (sổ nhật ký) |
| Phiếu học phí T7/2026: `paidAmount` ≠ tổng thanh toán và `paid + remaining ≠ final` | 1 | Báo cáo để kiểm tra; nhập nguyên giá trị |
| `misaInvoices.refId` trùng | 6 nhóm | Không đặt unique trên `refId` |
| `monthlyScores` của học viên đã xoá | 5 | Bỏ qua (có báo cáo) |
| `teacherAttendances` trỏ tới buổi học đã xoá | 8 | Bỏ qua (có báo cáo) |
| `leads.status` tiếng Việt từ CTV ("Chờ tư vấn", "Đã hủy") | 9 | Giữ nguyên chuỗi gốc |

## Việc tiếp theo

1. **Giai đoạn 0 (VPS):** tạo database `qlhv` + role `qlhv_app` (chỉ có quyền trên `qlhv`), thêm `qlhv` vào `backup.sh` và đẩy bản sao lưu mã hoá ra ngoài VPS.
2. **Giai đoạn 2:** lớp truy cập dữ liệu Prisma thay cho `db.collection(...)` trong 47 file, giữ nguyên hợp đồng API; viết lại `test/firebase-only.test.cjs` cho hướng PostgreSQL.
3. **Giai đoạn 3:** script nhập từ NDJSON của `export-firestore.cjs` vào schema này + `verify.sql` đối chiếu số bản ghi và tổng tiền theo tháng.
