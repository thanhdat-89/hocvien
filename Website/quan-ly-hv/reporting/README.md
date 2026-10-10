# Báo cáo QLHV tự động qua Google Apps Script

## Chỉ tiêu

- Tuần: Thứ Hai đến Chủ nhật; chạy lúc khoảng 08:00 Chủ nhật, giờ Việt Nam.
- Tháng: ngày 1 đến ngày cuối tháng; chạy lúc khoảng 08:00 ngày cuối tháng, giờ Việt Nam.
- Tổng học viên: toàn bộ hồ sơ đang có; thêm chỉ tiêu riêng số đang học.
- Theo lớp: số học viên duy nhất có enrollment ACTIVE trong mỗi lớp; một học viên ở nhiều lớp được tính ở từng lớp.
- Học viên mới: enrollmentDate ISO thuộc kỳ; hồ sơ ngày cũ/thiếu được đếm trong ghi chú, không tự đoán ngày.
- Học phí phải thu tháng: tổng finalAmount sau giảm giá của tuitionRecords có billingMonth/billingYear thuộc tháng; gồm các bản ghi đã thanh toán. Không dùng payments và không báo doanh thu tuần. Chưa tạo bản ghi học phí thì chưa có khoản phải thu tương ứng trong báo cáo.
- Snapshot số học viên và lớp tại thời điểm chạy; không tái dựng lịch sử nếu chạy lại sau kỳ.

## Kích hoạt

1. Trên backend Vercel đặt REPORTS_SECRET là chuỗi ngẫu nhiên dài (chỉ trên server) và triển khai mã nguồn chứa GET /api/reports/snapshot. Không đưa secret vào frontend hoặc GitHub.
2. Vào https://script.google.com, tạo project mới bằng tài khoản sở hữu thư mục Drive qlhv.cqt.vn. Dán Code.gs.
3. Project Settings → Script Properties:
   - REPORTS_API_URL = https://api.qlhv.cqt.vn/api/reports/snapshot
   - REPORTS_SECRET = cùng giá trị backend.
4. Đặt timezone project Asia/Ho_Chi_Minh.
5. Chạy previewWeekReport và previewMonthReport, cấp quyền Google Drive/Sheets/UrlFetch. Khi Firestore đang hết reads, API sẽ lỗi và không tạo báo cáo rỗng; thử lại sau khi quota hồi phục.
6. Xem file thử nghiệm trong folder qlhv.cqt.vn, kiểm tra dữ liệu. Sau đó chạy setupReports một lần để tạo trigger.
7. Mục Triggers/Executions cho biết lịch và các lỗi; cấu hình nhận email khi trigger lỗi.

Trigger chạy hằng ngày khoảng 08:00, sai số thông thường ±15 phút; chỉ xuất vào Chủ nhật/ngày cuối tháng. Lịch này không bảo đảm đúng từng phút. Báo cáo có thời điểm chốt rõ ràng; cập nhật sau giờ chạy chưa được tính. Nếu cần đủ dữ liệu đến 23:59:59, cần chuyển sang chốt sau 00:00 ngày tiếp theo và lưu snapshot cuối kỳ.

Mỗi kỳ có một file riêng, gồm Tổng quan, Theo lớp, Học viên mới, Ghi chú. Ngày cuối tháng trùng Chủ nhật sẽ tạo cả hai báo cáo. Khóa script ngăn chạy song song; Script Properties ghi kỳ đã thành công. Lần retry tìm lại file đúng tên trong folder; file thất bại được điền lại. Không đánh dấu hoàn thành trước khi ghi xong. File thử nghiệm có tiền tố THỬ NGHIỆM và không chiếm kỳ chính thức.

## Trạng thái và database

Đã kích hoạt lịch tự động ngày 09/10/2026 (giờ Việt Nam):

- Backend production tại https://api.qlhv.cqt.vn; endpoint báo cáo tháng đã trả HTTP 200 khi xác thực bằng REPORTS_SECRET.
- Firestore indexes đã triển khai vào project hocthemtoan-7ecb8.
- Project Apps Script: https://script.google.com/home/projects/188xb6CGhKyBOur4yLK6D1lF6kUWvWFc7LdectqNigCOUZfshKgmF43k2/edit.
- Timezone project: Asia/Ho_Chi_Minh. Script Properties đã có REPORTS_API_URL và REPORTS_SECRET; không lưu giá trị secret trong tài liệu này.
- previewWeekReport và previewMonthReport đã thực thi thành công, kiểm tra đủ bốn tab Tổng quan, Theo lớp, Học viên mới, Ghi chú. Tab mặc định trống được xóa dù Google đặt tên Sheet1 hay Trang tính1; tab Tổng quan được chọn khi mở file.
- setupReports thực thi thành công lúc khoảng 16:30 ngày 09/10/2026. Trang Kích hoạt xác nhận đúng một trigger runScheduledReports chạy hằng ngày, khung 08:00–09:00 GMT+07:00; mã tạo trigger đặt atHour(8).nearMinute(0).
- Thông báo lỗi trigger hiện đặt hằng ngày. Chưa có lần chạy tự động nào sau khi cài; báo cáo tuần kế tiếp dự kiến sáng Chủ nhật 11/10/2026, báo cáo tháng kế tiếp dự kiến sáng 31/10/2026.

File thử nghiệm đã kiểm tra:

- Tuần 05/10–09/10/2026: https://docs.google.com/spreadsheets/d/10jw-ulrIFShSOntS2JX_YF35LnSQuYPhzvonmQBTH_I/edit.
- Tháng 01/10–09/10/2026: https://docs.google.com/spreadsheets/d/1a-Go9pFGUv23FTCVFNr3CL_ITrAj2JxYdvdJ_mMK0KQ/edit.
- Snapshot thử nghiệm: 168 học viên, 168 đang học, 13 học viên mới trong kỳ, 30 học viên không có đăng ký lớp ACTIVE; học phí phải thu tháng 144.455.000 VND từ 81 bản ghi. Đây là số liệu tại thời điểm thử nghiệm, không phải số chốt cuối kỳ.

Tác vụ nền sử dụng quyền của tài khoản Google đã cấp cho Apps Script. Kết nối Google Drive trong cuộc trò chuyện không cung cấp token cho tác vụ nền của website.

API báo cáo ưu tiên đọc bản sao Supabase và chỉ quay về Firestore nếu Supabase lỗi (trừ khi `REPORTS_FIREBASE_FALLBACK=false`). Backend vẫn đọc Firebase cho các API nghiệp vụ thông thường. Khi `SUPABASE_DUAL_WRITE=true`, các thao tác ghi qua backend được phản chiếu sang Supabase; Firebase vẫn là nguồn chuẩn. Nếu lần phản chiếu lỗi, backend giữ thao tác trong hàng đợi Firestore và thử đồng bộ lại trước khi tạo báo cáo. Báo cáo có thể trễ đến lần đồng bộ lại tiếp theo nếu cả hai dịch vụ lỗi cùng lúc.

Thiết lập backend: giữ `SUPABASE_DB_PASSWORD` trong biến môi trường server; đặt `SUPABASE_DUAL_WRITE=true` sau khi xác minh kết nối; `REPORTS_READ_SOURCE` mặc định là `supabase`, còn API học viên mặc định đọc Firebase. Không đưa thông tin kết nối vào frontend hoặc Git. Project Supabase Free vẫn có thể tạm dừng khi ít hoạt động; lịch báo cáo tuần/tháng không đảm bảo đủ hoạt động mỗi tuần để tránh pause.

Chi phí: không cần nâng gói để viết mã/thiết lập trigger, nhưng vẫn chịu hạn mức Apps Script, Drive, Firestore và hosting. Không có thao tác xuất toàn bộ dữ liệu mỗi phút.

## Đổi lịch đã cài

Sau khi cập nhật Code.gs trên Apps Script, chạy lại setupReports để xóa trigger cũ và tạo trigger 08:00 mới. Chỉ sửa file local không thay đổi trigger đã cài.


## Xuất quản lý học phí ngày 25

- Chạy khoảng 08:00 ngày 25 hằng tháng theo Asia/Ho_Chi_Minh, dùng trigger `runScheduledReports` hiện có (Apps Script có thể lệch khoảng 15 phút).
- Lưu Google Sheets `hoa-don-thang-{month}-{year}` vào thư mục Drive `qlhv.cqt.vn`, ID `1QdxyRceswELZAHUUCWgqbi3ORwTOsEB5`.
- Giống nút Xuất Excel với bộ lọc Tất cả: tab Hóa đơn bán hàng, 7 dòng hướng dẫn, dòng 8 có 9 tiêu đề; dữ liệu từ dòng 9. Giữ số thứ tự dạng text và tiền dạng số.
- Tính toàn bộ buổi đã xếp trong tháng, kể cả buổi sau ngày 25 và học viên chưa có phiếu; bỏ buổi CANCELLED, áp dụng ngày ghi danh/nghỉ và khuyến mãi giống website. Không tự tạo phiếu hoặc ghi nhận thanh toán.
- Backend `GET /api/reports/tuition-export?month=10&year=2026` dùng REPORTS_SECRET hiện có. Mặc định ưu tiên Supabase, thử đồng bộ queue trước khi đọc; fallback Firebase nếu lỗi, hoặc chặn fallback bằng REPORTS_FIREBASE_FALLBACK=false. Trả source và generatedAt để kiểm tra nguồn.
- Cập nhật Code.gs trên project Apps Script hiện có rồi chạy setupTuitionReports; hàm giữ trigger tuần/tháng. Chạy previewTuitionReport để kiểm tra file thử nghiệm, không chiếm kỳ chính thức.
- Một file mỗi tháng; chỉ đánh dấu thành công sau khi ghi xong. Nếu chạy lại cùng kỳ, tìm file đúng tên thay vì tạo bản sao. Thay đổi dữ liệu sau thời điểm xuất chưa được phản ánh.
