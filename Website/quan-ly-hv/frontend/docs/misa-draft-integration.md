# Bản nháp hóa đơn học phí và chuẩn bị XML MISA

## Workflow hiện tại

Tạo phiếu học phí thường hoặc học riêng sẽ ghi phiếu, invoiceDrafts và invoiceOutbox cùng batch Firestore. Không yêu cầu thanh toán đủ. Tính lại phiếu khôi phục nháp thiếu, giữ nguyên nội dung nháp đã chỉnh sửa. Không backfill hàng loạt phiếu cũ.

Tự lấy mẫu bán hàng số 2 đang hoạt động theo năm ngày hóa đơn tại Việt Nam. Nếu chỉ có một mẫu hợp lệ sẽ chọn mẫu đó; nhiều mẫu hoặc lỗi kết nối chuyển NEEDS_REVIEW để quản trị viên kiểm tra. Cấu hình MEINVOICE_DEFAULT_TEMPLATE_ID và MEINVOICE_DEFAULT_SERIES có thể chỉ định mẫu. Không chọn mẫu ngẫu nhiên.

Quản trị viên mở nháp ở trang Hóa đơn điện tử để sửa người mua, ngày và mẫu, lưu phiên bản mới, xem PDF hoặc bấm “Chuẩn bị XML trên MISA”. Endpoint sync chỉ chấp nhận phiên bản đã lưu. Worker xử lý cùng hàng đợi.

## Phạm vi MISA

Adapter gọi bước SignType=1 để chuẩn bị XML chưa ký. Không ký số, gửi email hoặc thực hiện bước gửi XML đã ký. Thành công chỉ được ghi MISA_XML_PREPARED kèm TransactionID; không ghi MISA_DRAFT_CREATED. Việc hiển thị trong danh sách nháp của MISA chưa được xác minh. Muốn đạt yêu cầu lưu nháp trực tiếp trong giao diện MISA cần xác nhận hợp đồng API với MISA trước rollout.

Nguồn tham chiếu:
- https://doc.meinvoice.vn/itg/Doc/publish/SignType1.html
- https://doc.meinvoice.vn/itg/Doc/Info/CreateInvoiceResult.html
- https://doc.meinvoice.vn/itg/Doc/GetTemplate.html

## Cơ chế xử lý

Outbox PENDING/RETRY → PROCESSING với lease và RefID cố định → DONE. Draft lần lượt PENDING_MISA → CREATING_MISA → MISA_XML_PREPARED. Claim bằng transaction, gọi MISA ngoài transaction, lưu kết quả bằng transaction kiểm tra lease.

Lỗi trước khi gửi có thể thử lại sau 5 phút, tối đa 5 lần trên một phiên bản. Lỗi xác thực được coi là chưa gửi. Timeout, phản hồi không khớp RefID, provider từ chối sau khi gửi, kết quả ngoài phạm vi hoặc lease hết hạn chuyển OUTCOME_UNKNOWN; không tự gửi lại. Lỗi lưu kết quả sau khi gọi MISA giữ PROCESSING và chuyển OUTCOME_UNKNOWN khi lease hết hạn. Cần quản trị viên đối chiếu RefID với MISA; chưa có API đối chiếu tự động được xác minh.

Chặn sửa nháp đang xử lý, kết quả chưa rõ hoặc đã chuẩn bị XML. Dữ liệu phiếu/thanh toán thay đổi trước khi gửi chuyển NEEDS_REVIEW; quản trị viên lưu lại nháp. RefID được giữ xuyên suốt.

## Bật và vận hành

Cấu hình mẫu mặc định tắt; .env local đã bật MEINVOICE_AUTO_PREPARE_XML=true theo yêu cầu tự động hóa. Biến môi trường production cần cấu hình riêng. Không chạy API tạo XML thật trong kiểm thử.

```env
MEINVOICE_AUTO_PREPARE_XML=false
MEINVOICE_DEFAULT_TEMPLATE_ID=
MEINVOICE_DEFAULT_SERIES=
CRON_SECRET=
```

Sau khi xác minh hành vi mong muốn trên MISA, đặt MEINVOICE_AUTO_PREPARE_XML=true ở backend. Dùng các biến MEINVOICE_* hoặc alias hiện có của misaConnectionConfig. Không đưa credential vào frontend.

Cần deploy composite index trong firestore.indexes.json cho invoiceOutbox(status ASC, nextRetryAt ASC). GET /api/tuition/cron/process-invoices yêu cầu Authorization: Bearer <CRON_SECRET> và từ chối khi thiếu secret. Mỗi request xử lý tối đa một phiếu, tổng timeout provider 12 giây để phù hợp request 30 giây.

vercel.json cấu hình cron 02:00 UTC hằng ngày; chỉ phù hợp lượng ít (tối đa một phiếu/ngày qua lịch này). Nếu cần nhiều phiếu hoặc xử lý gần thời điểm tạo, dùng scheduler đã xác minh hỗ trợ tần suất cao gọi endpoint, hoặc chạy worker trên VPS:

```sh
npm run invoices:worker
```

Worker chạy liên tục, kiểm tra mỗi 15 giây sau lượt xử lý. Không chạy tiến trình liên tục trong Vercel request. Không dùng fire-and-forget sau khi trả response.

Nháp/outbox BLOCKED từ implementation cũ chưa tự chuyển trạng thái; quản trị viên mở và lưu lại để đưa vào hàng đợi mới. Không tự gửi lại những nháp không xác định đã gửi hay chưa.

## Kiểm tra

npm run test:misa-preview chạy test payload, phân quyền, mẫu mặc định, ghi nguyên tử, gateway giả lập, lease/concurrency, RefID/revision, retry, timeout, persistence failure và cron secret. Build backend/frontend đã kiểm tra. Test dùng provider giả lập, không tạo hóa đơn thật. Chưa deploy production hoặc bật cờ gửi XML.

## Tự động sau thao tác học phí

POST /tuition/calculate cho một học viên và POST /tuition/toggle-paid tự gọi runTuitionInvoiceWorkflow sau toàn bộ ghi phiếu/thanh toán. Cập nhật source của nháp chưa gửi trong transaction, giữ người mua, mẫu và RefID; gọi bước XML và chờ kết quả trong request. Phiếu đã lưu vẫn thành công nếu MISA lỗi; response kèm invoiceWorkflow để giao diện báo trạng thái. Không cần mở màn hình hóa đơn để lưu/gửi thủ công khi thông tin hợp lệ.

Nháp đang xử lý, kết quả chưa rõ hoặc đã chuẩn bị XML không bị reset khi thanh toán/tính lại. Nếu nhiều mẫu hoặc thiếu thông tin, cần quản trị viên kiểm tra ngoại lệ. Tạo hàng loạt theo lớp vẫn ghi outbox, worker xử lý sau để tránh vượt thời gian request.

## Tích hợp với nhánh GitHub hiện tại

Thay adapter/route cũ bằng workflow XML chưa ký và màn hình draft/outbox. Giao diện tạo nhóm và endpoint /invoices cũ không còn trong phiên bản này; dữ liệu misaInvoices đã lưu được giữ nguyên. Worker từ chối gửi phiếu có bản ghi misaInvoices chưa REMOVED_FROM_MISA để tránh trùng; quản trị viên phải đối chiếu các bản ghi cũ trước khi chuyển workflow. Giữ nguyên các sửa lỗi schedule fallback, nhóm dòng học viên và phân biệt học viên trùng tên từ main.
