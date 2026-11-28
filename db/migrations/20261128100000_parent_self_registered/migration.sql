-- SĐT phụ huynh tự đăng ký trên trang chia sẻ cqt.vn (học viên chưa có SĐT nào).
-- Khác NULL = chưa được admin xác nhận; admin sửa phụ huynh trong qlhv thì đặt lại NULL.
ALTER TABLE "parents" ADD COLUMN "selfRegisteredAt" TIMESTAMPTZ(3);
