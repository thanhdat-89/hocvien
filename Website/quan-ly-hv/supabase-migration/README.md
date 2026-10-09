# Chuyển dữ liệu QLHV từ Firestore sang Supabase

Project nguồn: hocthemtoan-7ecb8. Project đích người dùng cung cấp: kpspgmqgemkvxjvaaazw (xác nhận lại trong dashboard trước khi chạy).

## Trạng thái bộ công cụ

Đây là bước chuẩn bị và nhập dữ liệu vào schema riêng `qlhv_migration`, không phải backend PostgreSQL đã hoạt động. Website vẫn dùng Firestore. Không thay biến môi trường production cho tới khi backend được chuyển và kiểm thử.

Bảng `documents` lưu toàn bộ collection/subcollection, mã tài liệu và JSONB dữ liệu gốc; các view giúp kiểm tra học viên/lịch và danh sách chưa có lịch tháng hiện tại. Giữ nguyên ngày cũ như `15-Jul`, mảng điểm, ID trùng tên và trường bổ sung. Không ép ngày sai thành ngày giả. Timestamp, reference, geopoint, bytes và số không hữu hạn dùng nhãn `$firestoreType`; backend mới phải giải mã trước khi trả API. Đây là vùng nhập trung gian, chưa phải mô hình quan hệ chuẩn hóa cuối cùng.

## 1. Tạo cấu trúc trong Supabase

Mở project QLHV CQT Math → SQL Editor → New query. Dán toàn bộ `schema.sql`, bấm Run. Schema này không cấp truy cập cho `anon`/`authenticated` và bật RLS. Dùng SQL Editor hoặc kết nối PostgreSQL ở backend để truy cập; không dùng trình duyệt đọc trực tiếp bảng chứa passwordHash/giao dịch.

## 2. Xuất Firestore một lần

Chờ quota reads reset; export đọc toàn bộ dữ liệu và có thể bị giới hạn nếu dữ liệu lớn. Chạy ở máy cá nhân, không trên frontend. Dừng thao tác ghi (quản trị viên và webhook/thanh toán/tác vụ nền) trong lúc xuất để có bản dữ liệu nhất quán; export này không phải snapshot nguyên tử. Nếu chưa dừng ghi, chỉ dùng bản xuất để thử nghiệm và xuất lại khi chuyển chính thức.

Trong thư mục backend `Website/qlhv.cqt.vn`, dùng dependencies hiện có:

```sh
node supabase-migration/export-firestore.cjs "$HOME/qlhv-backup-2026-10"
python3 supabase-migration/prepare-import.py "$HOME/qlhv-backup-2026-10"
```

Công cụ dùng `FIREBASE_SERVICE_ACCOUNT_JSON`, hoặc `GOOGLE_APPLICATION_CREDENTIALS`, hoặc file local `firebase-service-account.json`. Không gửi khóa lên chat/GitHub. Export tạo file riêng với quyền 600; không ghi đè file cũ. Nếu export lỗi, không nhập file thiếu manifest; dùng thư mục mới khi chạy lại.

Backup chứa dữ liệu cá nhân, passwordHash và có thể có thông tin tích hợp: lưu riêng, không commit. Converter kiểm tra SHA-256, số lượng và đường dẫn trước khi sinh `import.sql`; không đọc Firestore lại.

## 3. Nhập vào Supabase

Với file nhỏ: mở SQL Editor, dán `import.sql`, chạy một lần. Với file lớn: cài PostgreSQL client, vào nút Connect, lấy Session pooler URI (port 5432) và chạy bằng psql. Dùng URI thật từ dashboard; không đoán hostname. Nhập mật khẩu vào prompt của psql, không đưa password vào câu lệnh hoặc ảnh chụp:

```sh
psql 'postgresql://postgres.PROJECT_REF@POOLER_HOST:5432/postgres?sslmode=require' -W -v ON_ERROR_STOP=1 -f "$HOME/qlhv-backup-2026-10/import.sql"
```

Thay PROJECT_REF/POOLER_HOST đúng dashboard. Import nằm trong transaction và từ chối nếu bảng staging đã có dữ liệu để tránh trộn bản xuất cũ/mới. Không xóa bảng đang có dữ liệu để chạy lại nếu chưa có backup.

## 4. Đối chiếu

Chạy `verify.sql`. So từng collection_path và tổng số với manifest.json, kiểm tra cả `students/ID/parents`. Kiểm tra học viên trùng tên theo ID, lịch tháng, số tiền học phí/thanh toán và các liên kết thiếu. Danh sách tháng 10 có 23 hồ sơ ở thời điểm kiểm tra ngày 09/10/2026; dữ liệu sau đó có thể thay đổi, không coi 23 là hằng số.

## 5. Việc cần làm trước khi website chuyển sang Supabase

- Thiết kế bảng quan hệ chuẩn cho students, parents, classes, enrollments, sessions, private schedules, attendance, tuition, payments và các collection khác; giữ ID Firestore kiểu text và trường JSON phụ để không mất dữ liệu.
- Thay mọi thao tác Firebase trong routes/services, cả batch, transaction, tạo lịch, đối soát SePay, ZNS, trang phụ huynh và nhật ký. Chỉ sửa firebase.ts hoặc thêm DATABASE_URL là không đủ.
- Giữ cơ chế username/bcrypt/JWT hiện tại trong bước đầu; dữ liệu bảng users không tự tạo tài khoản Supabase Auth. Mật khẩu bcrypt có thể giữ nguyên khi backend mới dùng cùng cách xác minh.
- Trên Vercel dùng Transaction pooler port 6543, pool nhỏ và thông tin kết nối chỉ ở server. Không đặt password/service-role key trong VITE_*.
- Kiểm thử ở môi trường preview: đăng nhập, phân quyền, thêm/sửa học viên, xếp lịch, điểm danh, tính học phí, thanh toán và webhook chống trùng. Không gửi thông báo thật trong thử nghiệm.
- Trước cutover: sao lưu, dừng ghi ngắn hạn, xuất/nhập cuối cùng, đối chiếu, triển khai backend mới. Frontend có thể giữ API tương thích.
- Nếu rollback trước khi phát sinh ghi trên Supabase: dùng backend Firestore cũ. Nếu đã có ghi mới: phải đối chiếu/chuyển dữ liệu mới về, không đổi ngược tùy tiện.
- Tự sao lưu PostgreSQL định kỳ vì Supabase Free không bao gồm automatic backups. Export Google Sheets là báo cáo, không thay thế backup đầy đủ.

## Tài liệu chính thức

- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/platform/migrating-to-supabase

Bộ công cụ chưa chạy export/import thật; chưa sửa hay xóa dữ liệu Firebase và chưa đổi website production.
