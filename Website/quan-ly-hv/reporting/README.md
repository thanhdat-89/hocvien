# Báo cáo QLHV tự động qua Google Apps Script

## Chỉ tiêu

- Tuần: Thứ Hai đến Chủ nhật; chạy vào tối Chủ nhật, giờ Việt Nam.
- Tháng: ngày 1 đến ngày cuối tháng; chạy tối ngày cuối tháng.
- Tổng học viên: toàn bộ hồ sơ đang có; thêm chỉ tiêu riêng số đang học.
- Theo lớp: số học viên duy nhất có enrollment ACTIVE trong mỗi lớp; một học viên ở nhiều lớp được tính ở từng lớp.
- Học viên mới: enrollmentDate ISO thuộc kỳ; hồ sơ ngày cũ/thiếu được đếm trong ghi chú, không tự đoán ngày.
- Học phí phải thu tháng: tổng finalAmount sau giảm giá của tuitionRecords có billingMonth/billingYear thuộc tháng; gồm các bản ghi đã thanh toán. Không dùng payments và không báo doanh thu tuần. Chưa tạo bản ghi học phí thì chưa có khoản phải thu tương ứng trong báo cáo.
- Snapshot số học viên và lớp tại thời điểm chạy; không tái dựng lịch sử nếu chạy lại sau kỳ.

## Kích hoạt

1. Trên backend Vercel đặt REPORTS_SECRET là chuỗi ngẫu nhiên dài (chỉ trên server) và triển khai mã nguồn chứa GET /api/reports/snapshot. Không đưa secret vào frontend hoặc GitHub.
2. Vào https://script.google.com, tạo project mới bằng tài khoản sở hữu thư mục Drive qlhv.cqt.vn. Dán Code.gs.
3. Project Settings → Script Properties:
   - REPORTS_API_URL = https://hocvien-backend.vercel.app/api/reports/snapshot
   - REPORTS_SECRET = cùng giá trị backend.
4. Đặt timezone project Asia/Ho_Chi_Minh.
5. Chạy previewWeekReport và previewMonthReport, cấp quyền Google Drive/Sheets/UrlFetch. Khi Firestore đang hết reads, API sẽ lỗi và không tạo báo cáo rỗng; thử lại sau khi quota hồi phục.
6. Xem file thử nghiệm trong folder qlhv.cqt.vn, kiểm tra dữ liệu. Sau đó chạy setupReports một lần để tạo trigger.
7. Mục Triggers/Executions cho biết lịch và các lỗi; cấu hình nhận email khi trigger lỗi.

Trigger chạy hằng ngày khoảng 23:30, sai số thông thường ±15 phút; chỉ xuất vào Chủ nhật/ngày cuối tháng. Lịch này không bảo đảm đúng 23:59. Báo cáo có thời điểm chốt rõ ràng; cập nhật sau giờ chạy chưa được tính. Nếu cần đủ dữ liệu đến 23:59:59, cần chuyển sang chốt sau 00:00 ngày tiếp theo và lưu snapshot cuối kỳ.

Mỗi kỳ có một file riêng, gồm Tổng quan, Theo lớp, Học viên mới, Ghi chú. Ngày cuối tháng trùng Chủ nhật sẽ tạo cả hai báo cáo. Khóa script ngăn chạy song song; Script Properties ghi kỳ đã thành công. Lần retry tìm lại file đúng tên trong folder; file thất bại được điền lại. Không đánh dấu hoàn thành trước khi ghi xong. File thử nghiệm có tiền tố THỬ NGHIỆM và không chiếm kỳ chính thức.

## Trạng thái và database

Chưa kích hoạt lịch tự động: cần REPORTS_SECRET trên Vercel và chủ tài khoản cấp quyền Apps Script. Kết nối Google Drive trong cuộc trò chuyện không cung cấp token cho tác vụ nền của website.

API hiện đọc database Firestore đang chạy; Supabase mới có staging trống, không được dùng làm nguồn báo cáo. Sau khi backend chuyển PostgreSQL, thay truy vấn trong src/routes/reports.ts và giữ nguyên JSON để Apps Script tiếp tục hoạt động. Lịch hằng ngày này không đọc Supabase và không ngăn Supabase bị pause.

Chi phí: không cần nâng gói để viết mã/thiết lập trigger, nhưng vẫn chịu hạn mức Apps Script, Drive, Firestore và hosting. Không có thao tác xuất toàn bộ dữ liệu mỗi phút.
