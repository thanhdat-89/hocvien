# Chuẩn bị tích hợp MISA meInvoice

Nghiên cứu ngày 11/10/2026: xem [MEINVOICE-RESEARCH.md](MEINVOICE-RESEARCH.md). Quy tắc thanh toán đủ dưới đây chỉ dùng rà soát; trước triển khai phải chốt thời điểm lập theo giao dịch thu tiền/hoàn thành dịch vụ, không mặc định chờ thu đủ mới lập hóa đơn. Ký eSign không mặc định tương đương API HSM.

## Đã chuẩn bị

Trang Học phí có tab Hóa đơn điện tử, dùng chung tháng/năm và dữ liệu lịch học phí. Tab rà soát các khoản có phiếu thanh toán đủ, chưa thanh toán đủ hoặc chưa có phiếu; chỉ dựa vào giao dịch đã lưu, không dùng checkbox chưa áp dụng. Một dòng tương ứng một khoản học phí theo lớp, chưa phải một hóa đơn MISA.

Đã kết nối meInvoice để xác thực, đọc mẫu và tạo hóa đơn nháp trực tiếp. eSign hỗ trợ xác thực hai lớp và đọc chứng thư, đã chọn chứng thư của HỘ KINH DOANH TÔ THỊ NGỌC QUỲNH. Website hiện lưu RefID/trạng thái và có thể đọc lại trạng thái từ MISA; danh sách dựa trên lịch học phí của tháng nên không thay thế danh sách tất cả hóa đơn đã phát hành.

Nút xuất Excel dùng mẫu hiện có, chỉ lấy phiếu thanh toán đủ có số tiền khớp lịch hiện tại. Các phiếu chênh lệch được cảnh báo và bỏ qua. Người dùng cần rà soát người mua và hóa đơn đã lập trên MISA trước khi nhập file.

## Tạo bản nháp MISA và xem trước trên website (12/10/2026)

1. Mở **Học phí → Hóa đơn điện tử**, chọn tháng/năm. Đăng nhập tài khoản quản trị viên.
2. Với phiếu đã thanh toán đủ, website hiển thị tóm tắt hóa đơn để kiểm tra người mua, số tiền và nội dung trước khi gửi.
3. Chọn mẫu hóa đơn bán hàng đang hoạt động. Hiện đơn vị có mẫu **Hóa đơn bán hàng khởi tạo từ máy tính tiền**, ký hiệu **2C26MHP**, mẫu số **2**. Mẫu được đọc lại từ meInvoice; không lấy ký hiệu hoặc số tiền do trình duyệt tự gửi lên.
4. Kiểm tra ngày hóa đơn dự kiến, người mua, địa chỉ và thông tin liên hệ. Tên được gợi ý từ phụ huynh chính hoặc học viên, chưa được xem là thông tin đã xác nhận. Nếu nhập mã số thuế, cần tên đơn vị và địa chỉ.
5. Bấm **Tạo hóa đơn nháp trên MISA**. Website gửi trực tiếp sang API MISA; dữ liệu theo dõi lưu ở `misaInvoices/{tuitionRecordId}` trong Firebase và được phản chiếu sang Supabase theo cấu hình dual-write. Mỗi phiếu chỉ có một RefID, yêu cầu chưa rõ kết quả sẽ bị khóa để tránh tạo trùng. Hóa đơn tạo ra có `PublishStatus=0`; website không ký hoặc phát hành.
6. Website hiển thị tóm tắt nội dung, đơn vị tính, số lượng, khuyến mãi và thành tiền trước khi gửi.

Bản nháp lấy học phí, giảm giá và thành tiền từ phiếu đã lưu, không từ lịch được tính lại. Một dòng dịch vụ tương ứng học phí của một lớp trong một tháng; đơn vị tính Tháng, số lượng 1. Mẫu bán hàng gửi số tiền sau giảm giá và không tự thêm thuế. Chưa hỗ trợ mẫu GTGT, gộp phiếu hoặc hóa đơn điều chỉnh/thay thế.

Token, Client Secret, mật khẩu và OTP không trả về frontend. Thanh toán hiện chưa tự tạo hóa đơn; quản trị viên chủ động bấm tạo sau khi kiểm tra thông tin. API backend chưa có thao tác ký/phát hành.

Trạng thái có bốn nhãn: **Chưa tạo HĐ**, **Đã tạo HĐ nháp**, **Đã phát hành**, **Đã gửi CQT**. Sau khi người dùng thao tác tiếp trên MISA, bấm **Cập nhật trạng thái** để đọc lại `PublishStatus` và `SendToTaxStatus` theo RefID. Khi MISA trả TransactionID cho hóa đơn đã phát hành, website lấy link tra cứu PDF và hiện nút **Xem hóa đơn MISA**.

MISA có API riêng để tạo, ký và phát hành hóa đơn. Tài liệu eSign/API đã cấu hình hiện chỉ xác nhận đọc được chứng thư; chưa xác minh được API ký/phát hành cho đúng mẫu MTT và chữ ký từ xa của đơn vị. Vì vậy hiện chưa có bộ hẹn 30 phút hoặc phát hành tự động. Không bật phát hành trước khi có xác nhận endpoint/tài khoản phù hợp.

Kiểm thử: `npm run test:misa-preview` kiểm tra tính đủ tiền, xác thực người mua, tạo hóa đơn `PublishStatus=0`, và ánh xạ trạng thái theo phản hồi MISA. Frontend: `cd frontend && npm run build`.

Tài liệu hiện hành: [MISA Developer — meInvoice](https://developer.misa.vn/products-openapi/MEINVOICE), mục **API xem trước hóa đơn khi chưa phát hành**, **Lấy danh sách mẫu hóa đơn** và **API Get Token**.

Kiểm tra thực tế 12/10/2026: đã tạo một hóa đơn nháp MISA cho An Khanh, Học riêng, 1.250.000đ; MISA trả `PublishStatus=0`, “Chưa cấp số”. Không ký hoặc phát hành hóa đơn này.

## Cần chốt trước khi nối API

- Người đứng tên hóa đơn: phụ huynh hay học viên; tên, địa chỉ, email và mã số thuế khi cần.
- Một hóa đơn mỗi phiếu theo lớp, hay gộp nhiều lớp/học viên trong cùng giao dịch.
- Xử lý thanh toán từng phần, miễn giảm, hoàn tiền và sửa phiếu sau phát hành.
- Mẫu/ký hiệu, nội dung và quy tắc thuế theo cấu hình kế toán đang sử dụng; không tự suy ra thuế suất từ lớp học.
- AppID do MISA cấp, quyền API, thông tin môi trường thử nghiệm và cơ chế xác nhận ký MISA eSign. Lưu bí mật trên backend, không vào Git/frontend.

## Các bước tiếp theo

1. Xác minh với MISA API ký/phát hành nào hỗ trợ đúng mẫu MTT và chứng thư eSign đã chọn.
2. Thiết kế hàng đợi xử lý thanh toán đủ, có retry/idempotency, sau khi chốt quy tắc người mua và mẫu hóa đơn tự chọn.
3. Sau khi có API phát hành được xác nhận, bổ sung bộ hẹn 30 phút, link tra cứu hóa đơn và xử lý lỗi từng bước. Kiểm tra trạng thái bằng RefID trước khi retry.

Tài liệu: https://doc.meinvoice.vn/itg/Doc/GetToken.html. Cần xác minh API hiện hành với thông tin MISA cung cấp trước khi triển khai kết nối thật.
