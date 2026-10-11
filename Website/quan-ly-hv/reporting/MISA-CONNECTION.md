# Kết nối MISA Developer Gateway

Đối chiếu trực tiếp ngày 11/10/2026:
- https://developer.misa.vn/products-openapi/MEINVOICE
- https://developer.misa.vn/products-openapi/ESIGN

Tài liệu gateway mới dùng `ClientID` và `ClientSecret` trong header, khác bộ API integration cũ dùng AppID. Backend hiện hỗ trợ kiểm tra xác thực và đọc mẫu/chứng thư; chưa triển khai ký, phát hành, gửi email hay tự động bật LIVE ngày 01/11/2026.

## Cấu hình backend

Thêm vào `.env` của `qlhv.cqt.vn` và biến môi trường backend Vercel. Không đưa bí mật vào GitHub hoặc biến VITE.

```dotenv
# Hỗ trợ bí danh Client_ID/Client_Secret và taxcode/username/password cho meInvoice.
MEINVOICE_CLIENT_ID=
MEINVOICE_CLIENT_SECRET=
MEINVOICE_TAXCODE=
MEINVOICE_USERNAME=
MEINVOICE_PASSWORD=
ESIGN_CLIENT_ID=
ESIGN_CLIENT_SECRET=
ESIGN_USERNAME=
ESIGN_PASSWORD=
```

Dùng mã số thuế và tài khoản đơn vị được MISA cấp quyền; ưu tiên tài khoản TEST. Các khóa ứng dụng không thay thế thông tin đăng nhập. Không dùng tài khoản/mật khẩu ví dụ trong tài liệu. Gateway được tài liệu công bố tại `https://developer.misa.vn/apis`; chưa xác minh cách chọn môi trường TEST bằng gateway, cần MISA cung cấp tài khoản/phạm vi thử nghiệm trước kiểm thử nghiệp vụ.

## Chức năng đã chuẩn bị

- Quản trị viên mở Học phí → Hóa đơn điện tử để xem các tên biến còn thiếu và kiểm tra kết nối.
- `GET /api/tuition/misa/connection`: chỉ trả tên biến đã cấu hình/còn thiếu.
- `POST /api/tuition/misa/connection/check` với `product: meinvoice` hoặc `esign`: đăng nhập và đọc danh sách mẫu/chứng thư. Giới hạn kiểm tra mỗi sản phẩm 30 giây trong mỗi tiến trình; không tự thử lại mật khẩu.
- meInvoice: `POST /itg/meinvoice/invoice/token`, sau đó `GET /itg/meinvoice/invoice/templates`.
- eSign: `POST /esign/v1/auth/login-api`, sau đó `GET /esign/v1/certificates/by-userId` với `AuthorizationRM: Bearer remoteSigningAccessToken`.
- Token chỉ tồn tại trong lần kiểm tra ở backend. Không trả token, khóa, mật khẩu hoặc nội dung phản hồi MISA về trình duyệt/nhật ký.
- Chứng thư hoặc mẫu được đọc thành công không đồng nghĩa đã ký/phát hành thành công. Mã eSign 122 được nhận diện là yêu cầu OTP. Quản trị viên nhập mã trực tiếp trên website; gateway dùng otpType=0 cho Email/SMS hoặc 1 cho ứng dụng, remember=false. Sau xác thực chỉ đọc chứng thư và bỏ token, chưa lưu phiên để ký. Không ghi nhật ký nội dung OTP.

## Các bước còn lại sau khi đủ tài khoản thử nghiệm

1. Kiểm tra quyền gateway và tài khoản TEST, mẫu đúng loại hóa đơn và năm.
2. Thực hiện đăng nhập/OTP eSign, chọn chứng thư hoạt động và xác minh luồng XML hóa đơn của meInvoice tương thích eSign.
3. Lưu snapshot người mua/tiền học và RefID cố định cho mỗi yêu cầu, có kiểm tra hóa đơn lập thủ công và phản chiếu Supabase.
4. Thêm xem trước, duyệt và ký thử; đối soát theo RefID khi timeout trước khi thử lại.
5. Kiểm thử phát hành TEST, trạng thái thuế, tải XML/PDF, gửi email và lỗi từng bước.
6. Chốt nghiệp vụ với người phụ trách hóa đơn rồi bật LIVE bằng cấu hình riêng. Mốc 01/11/2026 không tự mở phát hành.

## Kiểm tra thực tế 11/10/2026

meInvoice đăng nhập và đọc được 1 mẫu đang hoạt động. eSign dùng cùng tài khoản theo xác nhận của chủ website, trả lỗi 122 yêu cầu xác thực hai lớp. Chưa xác thực OTP, chưa đọc được chứng thư và chưa ký/phát hành. Mã 122 đối chiếu nguồn: https://www.misa.vn/155007/tai-lieu-open-api-tich-hop-chu-ky-so-misa-esign/.
