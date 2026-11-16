# Kế hoạch tối ưu desktop theo kích thước cửa sổ

Phạm vi: giao diện quản lý học viên Math Center. Phân trang lịch sử và sidebar tự thu gọn đã được triển khai; các thay đổi bảng/thanh công cụ còn lại thuộc đợt tiếp theo. Không đổi dữ liệu, nghiệp vụ học phí, thanh toán, MISA hoặc phân quyền.

## Căn cứ và hướng thiết kế

Ảnh cửa sổ thu hẹp cho thấy bảng học phí phải cuộn ngang mới thấy cột phiếu, thanh toán và thao tác. Mã hiện tại dành 256px cố định cho sidebar từ 1.024px, thêm khoảng đệm hai bên 64px, trong khi bảng học phí có chiều rộng tối thiểu 1.020px. Tổng nhu cầu xấp xỉ 1.340px. Vì vậy, chỉ có breakpoint mobile/desktop ở 1.024px chưa đủ. Kích thước ảnh chụp có thể khác CSS pixel vì màn hình Retina và mức zoom; kiểm thử phải dựa trên viewport thực.

Giữ nhận diện đang có: xanh chính #0050d4, chữ #282b51, nền #f8f5ff, bề mặt #ffffff, chữ phụ #71749e, trạng thái thu tiền #006947. Giữ Lexend cho tiêu đề và Inter cho nội dung. Ưu tiên diện tích bảng, số tiền dễ đối chiếu, hành động rõ ràng; không thay palette hoặc thiết kế lại toàn bộ website.

## Bố cục đề xuất

| Chiều rộng viewport (CSS px) | Điều hướng | Nội dung |
| --- | --- | --- |
| Dưới 1.024 | Giữ menu dạng ngăn kéo hiện tại | Giữ các cải tiến mobile/tablet đã có |
| 1.024–1.279 | Sidebar gọn khoảng 72px, mở rộng bằng nút hoặc bàn phím | Đệm 16–20px; thanh công cụ tách hàng; bảng dùng chế độ gọn |
| 1.280–1.439 | Sidebar gọn mặc định, người dùng có thể mở rộng | Đệm 20–24px; bảng theo chiều rộng vùng nội dung thực tế |
| Từ 1.440 | Sidebar đầy đủ khoảng 240–256px | Bố cục quen thuộc; đệm tối đa 32px; bảng tận dụng chiều ngang |

Sidebar gọn phải có nhãn truy cập, tooltip khi hover/focus, trạng thái trang hiện tại và nút mở rộng. Khi cửa sổ thấp, phần danh sách menu cuộn riêng; tài khoản và đăng xuất luôn truy cập được. Không ép chuyển trang hay đóng biểu mẫu khi resize.

Đo chiều rộng vùng nội dung bằng container queries cho bảng/thanh công cụ; viewport chỉ quyết định khung điều hướng. Điều này xử lý cả khi sidebar được mở rộng, trình duyệt có panel bên cạnh hoặc người dùng tăng zoom.

## Phương án sidebar chỉ hiện icon, bung tên khi hover

Đề xuất theo yêu cầu bổ sung: giữ dải icon ở cạnh trái; phần tên menu trượt mở sang phải. Đây là hướng mở của sidebar, chưa phải di chuyển thanh điều hướng sang cạnh phải cửa sổ. Phần sidebar đã được hiện thực theo phương án này; trạng thái phát hành được ghi trong báo cáo triển khai.

| Trạng thái | Chiều rộng dành trong bố cục | Cách hiển thị |
| --- | --- | --- |
| Đủ chỗ cho nội dung | 256px | Menu đầy đủ như hiện tại |
| Không đủ chỗ cho bảng | 72px | Logo gọn, icon điều hướng, icon tài khoản/đăng xuất; giữ đánh dấu trang hiện tại |
| Hover vào icon hoặc focus bằng bàn phím | Vẫn 72px | Menu mở rộng phủ sang phải đến 256px, hiện nhãn đầy đủ; bảng giữ nguyên vị trí và kích thước |
| Rời cả vùng menu, không còn focus | 72px | Menu trở lại dải icon |

Chọn cách mở rộng toàn bộ panel để người dùng đọc được các mục theo ngữ cảnh. Phương án chỉ hiện nhãn riêng từng icon ít che bảng hơn, nhưng không thể hiện đầy đủ hiệu ứng sidebar trượt mở như yêu cầu. Khi panel đã mở, không cần thêm tooltip trùng nội dung.

Quy tắc tự thu gọn dựa trên chiều rộng bảng tối thiểu của từng trang cộng đệm và sidebar đầy đủ, thay vì một breakpoint cho mọi trang. Với học phí hiện tại, nhu cầu là khoảng 1.340 CSS px (1.020 + 64 + 256); với sidebar icon, còn khoảng 1.156px (1.020 + 64 + 72). Thu gọn giải phóng 184px nhưng cửa sổ nhỏ hơn vẫn cần chế độ bảng gọn hoặc cuộn ngang trong bảng.

Khi triển khai, dùng chiều rộng shell và mức tối thiểu ổn định của từng trang để quyết định trạng thái. Không quyết định mở lại chỉ vì bảng vừa hết tràn sau khi sidebar đã thu gọn: cách đó gây vòng lặp đóng/mở. Chỉ mở lại khi có thêm khoảng dư dự kiến 48px; các giá trị này cần kiểm chứng bằng preview. Thay đổi trạng thái không tải lại dữ liệu hay gọi API.

Tương tác dự kiến: mở sau khoảng 150ms hover để tránh bung khi con trỏ đi ngang; đóng sau khoảng 250ms khi rời cả icon lẫn phần tên. Click icon vẫn chuyển trang ngay. Escape đóng panel và không tự mở lại cho đến khi con trỏ/focus rời rồi vào lại. Hover không khóa cuộn trang, không đặt bảng thành `inert` và không lấy focus. Giữ vị trí icon cố định trong cả hai trạng thái.

Tên phải xuất hiện cả khi focus bằng Tab, không chỉ hover. Panel giữ mở khi con trỏ nằm trên phần nhãn hoặc focus còn ở menu. Thiết bị không hỗ trợ hover dùng nút mở/đóng rõ ràng; mobile giữ drawer hiện tại. Giảm hoặc bỏ chuyển động khi người dùng bật giảm chuyển động. Tham chiếu: [W3C về nội dung khi hover/focus](https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus.html).

Phạm vi triển khai dự kiến: `Layout.tsx` quản lý chế độ full/icon theo chiều rộng; `Sidebar.tsx` quản lý nhãn và hover/focus; `responsive.css` đồng bộ khoảng lệch nội dung với chiều rộng dành sẵn. Giữ nguyên đường dẫn, phân quyền và thao tác đăng xuất.

Nghiệm thu bổ sung: bảng không dịch chuyển khi hover; click toàn bộ hàng menu hoạt động; resize qua ngưỡng không nhấp nháy; bàn phím đọc và chọn được đủ mục; Escape đóng đúng; tài khoản và đăng xuất vẫn dùng được ở cửa sổ thấp; hover/focus không phát sinh API đọc/ghi dữ liệu.

## Các thay đổi theo thứ tự ưu tiên

1. **Khung chung và thanh đầu trang:** thay khoảng lệch sidebar cố định bằng biến kích thước đồng bộ; cho tiêu đề, tìm kiếm và tài khoản xuống hàng có kiểm soát; giảm khoảng đệm khi cửa sổ hẹp. Không dùng `overflow-x: hidden` để che nội dung lỗi.
2. **Bảng học phí:** khi vùng nội dung đủ rộng, giữ 8 cột; ở chế độ gọn, gộp buổi học/đơn giá, gộp phiếu/trạng thái thanh toán và đưa thao tác phụ vào menu. Luôn hiển thị học viên, lớp, số tiền, trạng thái thanh toán và hành động chính. Nếu vẫn cần cuộn ngang, chỉ cuộn trong bảng, có chỉ báo và thanh cuộn dễ thấy; cân nhắc cố định cột học viên và thao tác sau khi kiểm tra độ rộng tối thiểu. Không ẩn dữ liệu tài chính hoặc thu nhỏ chữ để ép vừa bảng.
3. **Học viên, lớp học, hóa đơn:** áp dụng cùng nguyên tắc cột ưu tiên; tên dài được xuống dòng, số tiền không vỡ dòng, hành động chính không bị cột bên cạnh che. Dùng nút xem chi tiết cho dữ liệu phụ.
4. **Bộ lọc và lịch sử hoạt động:** grid theo diện tích còn lại, ô ngày có độ rộng đủ dùng, tìm kiếm chuyển xuống hàng khi cần; phân trang nằm ngay dưới 10 dòng. Khi có kết quả dài, cho nội dung xuống dòng thay vì kéo rộng cả trang.
5. **Lịch và hộp thoại:** cửa sổ thấp vẫn xem được nút lưu/hủy; hộp thoại giới hạn bằng `dvh`, phần nội dung cuộn riêng. Lịch tuần có thể cuộn trong vùng lịch; giữ các thao tác thêm/sửa buổi học hiện tại.

## Kiểm thử và tiêu chí nghiệm thu

- Viewport: 1.024×768, 1.152×720, 1.280×720, 1.366×768, 1.440×900, 1.920×1.080; bổ sung cửa sổ thấp 1.280×600 và zoom 125%, 150%, 200%.
- Trình duyệt: Chrome/Brave, Safari và Firefox; kiểm tra bàn phím và trackpad.
- Các trang ưu tiên: học phí, học viên, lớp/lịch học, hóa đơn và lịch sử hoạt động. Dùng dữ liệu mô phỏng gồm tên dài, nhiều lớp/học viên, số tiền lớn và danh sách trống.
- Toàn trang không phát sinh cuộn ngang; cuộn ngang chỉ tồn tại trong vùng bảng/lịch được chỉ rõ. Không có cột hoặc nút bị cắt mà không thể truy cập.
- Khi resize liên tục, nội dung không đè lên nhau, không mất bộ lọc/biểu mẫu đang nhập và không phát sinh API ghi dữ liệu.
- So sánh ảnh trước/sau tại 1.440px và 1.920px để giữ nhận diện và bố cục desktop rộng. Chạy lại smoke mobile để tránh hồi quy.

## Triển khai

Làm theo ba đợt: (1) khung chung/sidebar/thanh đầu trang; (2) bảng học phí và các bảng quản lý; (3) lịch, bộ lọc và hộp thoại. Mỗi đợt có ảnh trước/sau ở các kích thước đại diện, kiểm thử thao tác bằng API mô phỏng và bản preview trước khi chuyển domain. Lưu phiên bản triển khai trước đó để có thể quay lại. Đợt sidebar chỉ thay khung điều hướng và khoảng lệch vùng nội dung. Các thay đổi cột bảng, thanh công cụ và lịch còn lại chưa áp dụng.

## Ghi nhận kiểm thử sidebar

Kiểm thử Chromium với API mô phỏng đã xác nhận: rail 72px ở học phí 1.280px, full menu ở 1.440px, hover phủ rộng 256px không dịch bảng hoặc icon, Tab/Escape, vùng nhãn giữ mở, nút mở/đóng cảm ứng, cửa sổ thấp 600px, chuyển trang học viên và drawer mobile 390px. Hover/resize không gọi API dữ liệu. Cần kiểm tra trực tiếp Safari/Firefox trong đợt kiểm thử đa trình duyệt; chưa có kết quả cho hai trình duyệt này.
