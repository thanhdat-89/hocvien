-- "Họ và tên" trên hoá đơn mặc định là tên học viên; người dùng có thể sửa riêng sau.
UPDATE "students" SET "invoiceFullName" = btrim("fullName")
WHERE "invoiceFullName" IS NULL AND btrim("fullName") <> '';
