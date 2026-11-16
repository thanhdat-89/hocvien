# Nghiên cứu tích hợp meInvoice — 11/10/2026

## Phạm vi và mức xác minh

Đã thử mở https://developer.misa.vn/products-openapi/MEINVOICE. Trong phiên trình duyệt hiện tại chưa đăng nhập, trang chuyển về /products-openapi và hiển thị đang cập nhật danh sách sản phẩm. Chưa xác minh tài liệu/quyền riêng trong tài khoản đang chờ duyệt. Các kết luận API dưới đây đối chiếu bộ tài liệu công khai chính thức https://doc.meinvoice.vn/itg/; cần đối chiếu lại phiên bản được cấp sau phê duyệt.

Không gọi API bằng tài khoản thật, không thử phát hành, ký, gửi email hoặc hủy hóa đơn. Chưa biết hạn mức API, phí tích hợp, SLA, webhook hay quyền thử nghiệm của AppID sẽ được cấp.

## Xác thực và môi trường

API integration xác thực bằng AppID, taxcode, username, password và trả token Bearer. Các lỗi được mô tả gồm InvalidAppID, InactiveAppID, UnAuthorize. Tách cấu hình TEST/LIVE, bí mật chỉ ở backend; không sao chép token/cookie minh họa. Endpoint mô tả lấy token là /api/integration/auth/token, nhưng ví dụ Curl ở cùng tài liệu dùng /api/integration/invoice/token: cần xác minh trên môi trường thử nghiệm, không trộn với API v3.

Nguồn: https://doc.meinvoice.vn/itg/Doc/GetToken.html và https://doc.meinvoice.vn/itg/intro.html.

## Các chức năng được tài liệu mô tả

Base URL hóa đơn: https://testapi.meinvoice.vn/api/integration/invoice hoặc https://api.meinvoice.vn/api/integration/invoice. Bảng dưới là khả năng kỹ thuật được mô tả, chưa khẳng định AppID được cấp tất cả quyền.

| Chức năng | Đường dẫn tương đối | Cách dùng dự kiến |
| --- | --- | --- |
| Lấy mẫu/ký hiệu | GET /templates | Chọn mẫu đã được phép dùng cho đúng năm/loại hóa đơn |
| Xem trước | POST /unpublishview | Rà soát người mua và số tiền trước khi phát hành |
| Phát hành | POST tại base URL | Gửi dữ liệu, xử lý theo cơ chế ký được cấp |
| Tra trạng thái | POST /status | Theo TransactionID hoặc RefID; inputType tương ứng 1 hoặc 2 |
| Xem sau phát hành | POST /publishview | Tạo liên kết xem mới khi cần; tài liệu ghi liên kết tồn tại 5 phút |
| Tải bản hóa đơn | POST /Download | XML/PDF/HTML/All; lưu bản cần thiết thay vì chỉ giữ link tạm |
| Gửi email | POST /sendemail | Theo dõi riêng trạng thái gửi, không tạo hóa đơn lại khi gửi email lỗi |
| Hủy | POST /cancel | Chức năng có trong tài liệu; chưa tự động áp dụng vào nghiệp vụ |

Nguồn theo chức năng:
- https://doc.meinvoice.vn/itg/Doc/GetTemplate.html
- https://doc.meinvoice.vn/itg/Doc/ViewInvoiceUnPublish.html
- https://doc.meinvoice.vn/itg/Doc/PublishInvoice.html
- https://doc.meinvoice.vn/itg/Doc/GetStatusInvoice.html
- https://doc.meinvoice.vn/itg/Doc/ViewInvoicePublish.html
- https://doc.meinvoice.vn/itg/Doc/DowloadInvoice.html
- https://doc.meinvoice.vn/itg/Doc/SendEmail.html
- https://doc.meinvoice.vn/itg/Doc/Cancel.html

## Ký số: eSign cần xác minh riêng

Tài liệu integration phân loại USB/file=1, HSM đồng bộ=2, HSM bất đồng bộ=3, vé không mã không ký=4, hóa đơn máy tính tiền không ký=5. HSM đồng bộ xử lý tạo/ký/phát hành/gửi thuế trên MISA; bất đồng bộ đưa vào hàng chờ và cần tra trạng thái sau đó. Không suy ra eSign của đơn vị dùng được SignType=2/3.

Hướng dẫn web phân biệt eSign với HSM. eSign cần kết nối và xác thực tài khoản. Hướng dẫn ký phiên trên AMIS Kế toán mô tả phiên 24 giờ với sinh trắc học khi kích hoạt; đây không phải cam kết hỗ trợ ký nền API của website. Chốt luồng eSign, thời hạn phiên, xác nhận của người ký và phản hồi hết phiên khi được cấp tài liệu.

Nguồn:
- https://doc.meinvoice.vn/itg/Doc/publish/SignType2.html
- https://doc.meinvoice.vn/itg/Doc/publish/SignType3.html
- https://helpv4.meinvoice.vn/kb/r10_thiet_lap_ky_so/
- https://helpv4.meinvoice.vn/kb/thiet-lap-ky-so-thong-qua-chu-ky-so-tu-xa-misa-esign/?lang=vi
- https://helpact.misa.vn/kb/thiet-lap-tinh-nang-ky-phien-tren-ung-dung-chu-ky-so-misa-esign/

## Dữ liệu, chống trùng và trạng thái

InvoiceData có RefID do ứng dụng tạo làm khóa kiểm tra trùng; nên giữ cùng RefID khi gửi lại cùng yêu cầu. Ký hiệu lấy từ API mẫu; ngày, tiền tệ, tỷ giá và hình thức thanh toán phải hợp lệ. Nếu khai mã số thuế người mua, tài liệu yêu cầu tên đơn vị và địa chỉ. Điều chỉnh/thay thế có dữ liệu tham chiếu hóa đơn gốc; không ghi đè hóa đơn đã phát hành.

Nguồn: https://doc.meinvoice.vn/itg/Doc/Info/InvoiceData.html.

Thiết kế đề xuất: lưu snapshot nội dung tiền/người mua, RefID, TransactionID, số/ký hiệu, trạng thái gửi thuế, mã CQT, trạng thái email và lỗi từng lần gọi. Kiểm tra lỗi toàn phản hồi và từng kết quả; không coi HTTP 200 hoặc success ngoài cùng là đủ. Với hóa đơn có mã, tài liệu status phân biệt chờ cấp mã, lỗi gửi, đã cấp mã và bị từ chối. Khi timeout, tra RefID trước khi quyết định gửi lại; không tạo RefID mới để né lỗi trùng. Chưa thấy cam kết webhook trong bộ tài liệu đã đọc, nên chuẩn bị polling có backoff và giới hạn.

## Quy định liên quan và thay đổi kế hoạch

Nguồn Chính phủ xác nhận Nghị định 254/2026/NĐ-CP và Thông tư 91/2026/TT-BTC có hiệu lực từ 01/07/2026. Cần dùng quy định hiện hành, không chỉ dựa vào ví dụ API từ 2024.

- https://vanban.chinhphu.vn/?classid=1&docid=218689&orggroupid=2&pageid=27160
- https://vanban.chinhphu.vn/?docid=219006&pageid=27160

Hướng dẫn thuế về giáo dục nêu nguyên tắc dịch vụ: lập khi hoàn thành, không phụ thuộc thu tiền; nếu thu trước/trong khi cung cấp thì lập khi thu tiền, ngoại trừ đặt cọc bảo đảm hợp đồng. Do đó quy tắc chỉ thanh toán đủ mới xuất không bao quát nghĩa vụ; cần chốt theo giao dịch thu thực tế và hoàn thành dịch vụ, tránh xuất trùng khoản đã lập trước. Phân biệt tiền học trả trước với đặt cọc.

Nguồn: https://xaydungchinhsach.chinhphu.vn/nguoi-nop-thue-can-chuan-bi-gi-de-chi-phi-y-te-giao-duc-duoc-giam-tru-khi-tinh-thue-tncn-119260923170826068.htm và https://baochinhphu.vn/thoi-diem-lap-hoa-don-khoan-tam-ung-hop-dong-102260922161203758.htm.

Đây là điểm cần kế toán/đơn vị chốt trước phát hành thật: loại hóa đơn của hộ kinh doanh, cách thể hiện thuế, tên người mua, gộp lớp, thu từng phần và dịch vụ đã hoàn thành. Không tự áp 0% cho học phí. API cancel là khả năng kỹ thuật, không quyết định trường hợp pháp luật cho phép hủy; hoàn tiền/bỏ tích đã đóng không tự hủy hóa đơn.

## So sánh bổ sung MEINVOICEBOT — 11/10/2026

Link https://developer.misa.vn/products-openapi/MEINVOICEBOT cũng chuyển về danh sách sản phẩm và báo đang cập nhật trong phiên chưa đăng nhập. Chưa đọc được danh sách endpoint/quyền/giá riêng của sản phẩm này. Nhận định BOT thuộc nhóm xử lý hóa đơn là suy luận từ tên sản phẩm và tài liệu MISA về meInvoicebot/meInbot, chưa xác minh trực tiếp catalog API MEINVOICEBOT.

- MEINVOICE phù hợp luồng lập/ký/phát hành hóa đơn học phí; bộ API integration đã mô tả các chức năng này.
- Tài liệu eShop xác nhận meInbot là nhóm xử lý hóa đơn đầu vào, có kết nối cơ quan thuế và chọn thời gian đồng bộ. Đây là chức năng sản phẩm/tích hợp eShop, không chứng minh API BOT công khai có cùng quyền.
- Phân hệ xử lý hóa đơn có AVA kiểm tra thông tin người mua/bán, tiền và liên hệ điều chỉnh/thay thế; MISA lưu ý phải kiểm chứng kết quả. Chưa xác minh AVA được cung cấp qua API BOT.
- Tài liệu SME còn mô tả lấy hóa đơn đầu ra đã phát hành từ nhà cung cấp khác hoặc CQT về hạch toán. Vì vậy nhóm xử lý hóa đơn không chỉ có đầu vào; đồng bộ hóa đơn đầu ra đã có khác với phát hành hóa đơn mới.
- Với QLHV, BOT có thể hữu ích khi mở rộng quản lý chi phí/đối soát hóa đơn thủ công, nếu API được cấp hỗ trợ. Không thay đổi lựa chọn MEINVOICE cho phát hành học phí, không mặc định AppID/quyền/gói tài nguyên dùng chung hoặc BOT giải quyết ký eSign.

Nguồn:
- https://helpeshop.misa.vn/kb/ket-noi-misa-meinvoice-xu-ly-hoa-don-va-tao-nhanh-phieu-nhap-kho-tu-hoa-don-mua-hang-cua-nha-cung-cap-tren-dien-thoai
- https://helpv4.meinvoice.vn/kb/misa-ava-giai-thich-ket-qua-kiem-tra-hoa-don-dau-vao/
- https://helpsme2021.misa.vn/2026/kb/misa-outbot/ (nội dung từ kết quả tìm kiếm chính thức; mở trực tiếp chưa thành công).

## Quy trình đề xuất và mốc 01/11/2026

1. Chốt quy tắc thời điểm lập, người mua, số tiền và hóa đơn đã lập thủ công.
2. Lưu snapshot và yêu cầu có khóa chống trùng từ nguồn dữ liệu chính trên Firebase.
3. Lấy mẫu, xem trước, xác nhận ký theo tài khoản eSign được cấp.
4. Gửi, đọc kết quả từng hóa đơn và theo dõi trạng thái thuế; timeout phải đối soát.
5. Sau kết quả phù hợp, gửi email và lưu XML/PDF; lỗi email xử lý riêng.
6. Xử lý sai sót/hoàn tiền bằng luồng được duyệt, có phân quyền và nhật ký.

Thử nghiệm bằng dữ liệu mô phỏng trước; sau cấp API dùng TEST với tài khoản/mẫu riêng. Kiểm thử gửi lặp, mất kết nối sau MISA đã nhận, lỗi ký/hết phiên, thiếu dữ liệu, thu từng phần, thuế từ chối, lỗi email và thay đổi phiếu.

01/11/2026 (giờ Việt Nam) là mốc dự kiến sử dụng tích hợp, không phải tự động mở LIVE và không hoãn nghĩa vụ hóa đơn trước mốc này. Chỉ bật khi quyền LIVE, tài khoản, mẫu, eSign và đối soát thử nghiệm đạt. Khi chưa đạt, tiếp tục phát hành qua meInvoice thủ công và đối soát để tránh trùng. Chưa cấu hình bật chính thức trong mã nguồn.
