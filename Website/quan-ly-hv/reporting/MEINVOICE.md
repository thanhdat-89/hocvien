# Chuẩn bị tích hợp MISA meInvoice

## Đã chuẩn bị

Trang Học phí có tab Hóa đơn điện tử, dùng chung tháng/năm và dữ liệu lịch học phí. Tab rà soát các khoản có phiếu thanh toán đủ, chưa thanh toán đủ hoặc chưa có phiếu; chỉ dựa vào giao dịch đã lưu, không dùng checkbox chưa áp dụng. Một dòng tương ứng một khoản học phí theo lớp, chưa phải một hóa đơn MISA.

Chưa gọi MISA, chưa tạo hàng đợi phát hành hoặc lưu trạng thái hóa đơn thật. “Chưa đồng bộ MISA” nghĩa là chưa biết trạng thái bên MISA; không suy ra khách hàng chưa có hóa đơn. Danh sách dựa trên lịch học phí của tháng nên không thay thế danh sách tất cả hóa đơn đã phát hành.

Nút xuất Excel dùng mẫu hiện có, chỉ lấy phiếu thanh toán đủ có số tiền khớp lịch hiện tại. Các phiếu chênh lệch được cảnh báo và bỏ qua. Người dùng cần rà soát người mua và hóa đơn đã lập trên MISA trước khi nhập file.

## Cần chốt trước khi nối API

- Người đứng tên hóa đơn: phụ huynh hay học viên; tên, địa chỉ, email và mã số thuế khi cần.
- Một hóa đơn mỗi phiếu theo lớp, hay gộp nhiều lớp/học viên trong cùng giao dịch.
- Xử lý thanh toán từng phần, miễn giảm, hoàn tiền và sửa phiếu sau phát hành.
- Mẫu/ký hiệu, nội dung và quy tắc thuế theo cấu hình kế toán đang sử dụng; không tự suy ra thuế suất từ lớp học.
- AppID do MISA cấp, quyền API, thông tin môi trường thử nghiệm và cơ chế xác nhận ký MISA eSign. Lưu bí mật trên backend, không vào Git/frontend.

## Các bước tiếp theo

1. Bổ sung hồ sơ người nhận hóa đơn và snapshot dữ liệu tiền tại thời điểm lập.
2. Lưu yêu cầu hóa đơn với mã tham chiếu duy nhất theo đơn vị/phiếu và phiên bản; phân biệt trạng thái thanh toán và phát hành. Dùng nguồn dữ liệu chính để khóa chống tạo trùng, phản chiếu Supabase.
3. Ghi nhận chuyển sang thanh toán đủ trên tất cả API thanh toán; tạo yêu cầu qua cơ chế hàng đợi có thể khôi phục, giữ thanh toán đã thành công khi MISA lỗi. Chưa tự xuất chỉ vì dữ liệu lịch thay đổi.
4. Tích hợp API đăng nhập/đọc mẫu/tạo/tra trạng thái/ký/phát hành theo tài liệu được cấp. Khi timeout, tra cứu mã tham chiếu trước khi gửi lại. Kiểm tra lỗi từng hóa đơn và trạng thái cấp mã, không chỉ HTTP 200.
5. Thử nghiệm lỗi mạng, gọi lại, thanh toán một phần, sửa/hoàn tiền, ký cần duyệt. Bắt đầu bằng chế độ chờ kiểm tra và ký; bật tự động sau khi xác minh eSign hỗ trợ.
6. Hiển thị số hóa đơn, mã tra cứu, lỗi, lịch sử thao tác và quyền xử lý. Quy trình điều chỉnh/thay thế sau phát hành riêng biệt với việc bỏ đánh dấu thanh toán.

Tài liệu: https://doc.meinvoice.vn/itg/Doc/GetToken.html. Cần xác minh API hiện hành với thông tin MISA cung cấp trước khi triển khai kết nối thật.
