# Chuẩn bị tích hợp MISA meInvoice

Nghiên cứu ngày 11/10/2026: xem [MEINVOICE-RESEARCH.md](MEINVOICE-RESEARCH.md). Quy tắc thanh toán đủ dưới đây chỉ dùng rà soát; trước triển khai phải chốt thời điểm lập theo giao dịch thu tiền/hoàn thành dịch vụ, không mặc định chờ thu đủ mới lập hóa đơn. Ký eSign không mặc định tương đương API HSM.

## Đã chuẩn bị

Trang Học phí có tab Hóa đơn điện tử, dùng chung tháng/năm và dữ liệu lịch học phí. Tab rà soát các khoản có phiếu thanh toán đủ, chưa thanh toán đủ hoặc chưa có phiếu; chỉ dựa vào giao dịch đã lưu, không dùng checkbox chưa áp dụng. Một dòng tương ứng một khoản học phí theo lớp, chưa phải một hóa đơn MISA.

Đã kết nối meInvoice để xác thực, đọc mẫu và lấy liên kết xem trước hóa đơn chưa phát hành. eSign hỗ trợ xác thực hai lớp và đọc chứng thư, đã chọn chứng thư của HỘ KINH DOANH TÔ THỊ NGỌC QUỲNH. Chưa tích hợp ký hoặc phát hành, chưa tạo hàng đợi phát hành hoặc lưu trạng thái hóa đơn thật. “Chưa đồng bộ MISA” nghĩa là chưa biết trạng thái bên MISA; không suy ra khách hàng chưa có hóa đơn. Danh sách dựa trên lịch học phí của tháng nên không thay thế danh sách tất cả hóa đơn đã phát hành.

Nút xuất Excel dùng mẫu hiện có, chỉ lấy phiếu thanh toán đủ có số tiền khớp lịch hiện tại. Các phiếu chênh lệch được cảnh báo và bỏ qua. Người dùng cần rà soát người mua và hóa đơn đã lập trên MISA trước khi nhập file.

## Thử bản nháp và xem trước (12/10/2026)

1. Mở **Học phí → Hóa đơn điện tử**, chọn tháng/năm. Đăng nhập tài khoản quản trị viên.
2. Với phiếu đã thanh toán đủ, bấm **Bản nháp / xem trước**. Backend kiểm tra các giao dịch thanh toán đã lưu, không chỉ trạng thái PAID hoặc checkbox.
3. Chọn mẫu hóa đơn bán hàng đang hoạt động. Hiện đơn vị có mẫu **Hóa đơn bán hàng khởi tạo từ máy tính tiền**, ký hiệu **2C26MHP**, mẫu số **2**. Mẫu được đọc lại từ meInvoice; không lấy ký hiệu hoặc số tiền do trình duyệt tự gửi lên.
4. Kiểm tra ngày hóa đơn dự kiến, người mua, địa chỉ và thông tin liên hệ. Tên được gợi ý từ phụ huynh chính hoặc học viên, chưa được xem là thông tin đã xác nhận. Nếu nhập mã số thuế, cần tên đơn vị và địa chỉ.
5. Bấm **Lưu bản nháp**. Bản nháp lưu tại `invoiceDrafts/{tuitionRecordId}` ở Firebase, phản chiếu qua cơ chế Supabase hiện có. Không đẩy bản nháp lên danh sách hóa đơn MISA. Mỗi phiếu giữ một RefID UUID, tăng revision khi sửa; phiên bản cũ bị từ chối để tránh ghi đè.
6. Bấm **Xem trên mẫu MISA**, sau đó mở liên kết trả về. API `/invoice/unpublishview` chỉ tạo bản xem trước; liên kết có hạn khoảng 5 phút. Có thể lấy lại liên kết bằng cùng nút. Backend kiểm tra đầu file PDF, hủy đọc ngay sau đó; nếu MISA trả link nhưng file rỗng hoặc không đọc được, giao diện cảnh báo và không xem đây là PDF đã được kiểm chứng.

Bản nháp lấy học phí, giảm giá và thành tiền từ phiếu đã lưu, không từ lịch được tính lại. Một dòng dịch vụ tương ứng học phí của một lớp trong một tháng; đơn vị tính Tháng, số lượng 1. Mẫu bán hàng dùng số tiền sau giảm giá, không tự thêm thuế suất GTGT hoặc cộng thêm tiền thuế. Chưa hỗ trợ bản nháp mẫu GTGT, gộp phiếu hoặc hóa đơn điều chỉnh/thay thế. Quy tắc thuế và cách thể hiện nội dung cần được rà soát trước khi triển khai phát hành.

Phiếu hoặc giao dịch thanh toán thay đổi sau khi lưu thì phải lưu lại bản nháp trước khi xem. Liên kết xem trước không lưu trong database/audit log; token, Client Secret, mật khẩu và OTP không trả về frontend. Backend chỉ có các lệnh xác thực, đọc mẫu và xem trước, không có lệnh ký/phát hành. Thanh toán không tự tạo hoặc phát hành hóa đơn. Cần có sự đồng ý riêng của chủ tài khoản trước khi bổ sung luồng ký/phát hành.

Kiểm thử: `npm run test:misa-preview` kiểm tra tiền thanh toán, phiếu sửa/hoàn tiền, revision/RefID, quyền ADMIN, dữ liệu giả mạo từ client và danh sách API được phép. Frontend: `cd frontend && npm run build`.

Tài liệu hiện hành: [MISA Developer — meInvoice](https://developer.misa.vn/products-openapi/MEINVOICE), mục **API xem trước hóa đơn khi chưa phát hành**, **Lấy danh sách mẫu hóa đơn** và **API Get Token**.

Kiểm tra thực tế 12/10/2026: mẫu được đọc thành công, bản nháp thử phiếu An Khanh (1.350.000đ) được lưu và xác nhận có trong Supabase. MISA trả liên kết xem trước nhưng trình duyệt kiểm thử nhận HTTP 200 với nội dung tải rỗng, kể cả khi lấy lại liên kết. Vì vậy chưa xác nhận PDF trên mẫu MISA hiển thị đầy đủ; cần kiểm tra lại khả năng dựng/tải mẫu phía MISA. Nội dung bản nháp trên website vẫn xem được. Không ký hoặc phát hành trong quá trình kiểm tra này.

## Cần chốt trước khi nối API

- Người đứng tên hóa đơn: phụ huynh hay học viên; tên, địa chỉ, email và mã số thuế khi cần.
- Một hóa đơn mỗi phiếu theo lớp, hay gộp nhiều lớp/học viên trong cùng giao dịch.
- Xử lý thanh toán từng phần, miễn giảm, hoàn tiền và sửa phiếu sau phát hành.
- Mẫu/ký hiệu, nội dung và quy tắc thuế theo cấu hình kế toán đang sử dụng; không tự suy ra thuế suất từ lớp học.
- AppID do MISA cấp, quyền API, thông tin môi trường thử nghiệm và cơ chế xác nhận ký MISA eSign. Lưu bí mật trên backend, không vào Git/frontend.

## Các bước tiếp theo

1. Rà soát nội dung bản xem trước, thông tin người mua và cách gộp các phiếu; xác nhận quy tắc thuế trước khi dùng chính thức.
2. Bản nháp đã có snapshot số tiền, RefID, revision và transaction ở nguồn dữ liệu chính. Bổ sung quản lý vòng đời phát hành riêng, không dùng trạng thái bản nháp để suy ra trạng thái MISA.
3. Ghi nhận chuyển sang thanh toán đủ trên tất cả API thanh toán; tạo yêu cầu qua cơ chế hàng đợi có thể khôi phục, giữ thanh toán đã thành công khi MISA lỗi. Chưa tự xuất chỉ vì dữ liệu lịch thay đổi.
4. Tích hợp API đăng nhập/đọc mẫu/tạo/tra trạng thái/ký/phát hành theo tài liệu được cấp. Khi timeout, tra cứu mã tham chiếu trước khi gửi lại. Kiểm tra lỗi từng hóa đơn và trạng thái cấp mã, không chỉ HTTP 200.
5. Thử nghiệm lỗi mạng, gọi lại, thanh toán một phần, sửa/hoàn tiền, ký cần duyệt. Bắt đầu bằng chế độ chờ kiểm tra và ký; bật tự động sau khi xác minh eSign hỗ trợ.
6. Hiển thị số hóa đơn, mã tra cứu, lỗi, lịch sử thao tác và quyền xử lý. Quy trình điều chỉnh/thay thế sau phát hành riêng biệt với việc bỏ đánh dấu thanh toán.

Tài liệu: https://doc.meinvoice.vn/itg/Doc/GetToken.html. Cần xác minh API hiện hành với thông tin MISA cung cấp trước khi triển khai kết nối thật.
