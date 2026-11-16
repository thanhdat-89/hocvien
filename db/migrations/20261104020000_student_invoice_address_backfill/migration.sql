-- Hồ sơ chỉ còn hiển thị địa chỉ ở "Thông tin hoá đơn": chép địa chỉ cũ sang nếu chưa có.
UPDATE "students" SET "invoiceAddress" = btrim("address")
WHERE "invoiceAddress" IS NULL AND "address" IS NOT NULL AND btrim("address") <> '';
