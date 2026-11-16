-- Quan hệ phụ huynh là chữ tự do ("Bố", "Mẹ", "Ông/Bà"...). Đổi kiểu tại chỗ để giữ giá trị đã có.
ALTER TABLE "parents" ALTER COLUMN "relationship" TYPE TEXT USING "relationship"::text;

-- DropEnum
DROP TYPE "Relationship";
