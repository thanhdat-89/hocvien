-- Chuyển năm học: lớp mới ghi lớp năm trước được chuyển lên (mỗi lớp cũ tối đa một lớp kế tiếp).
-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "promotedFromId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "classes_promotedFromId_key" ON "classes"("promotedFromId");

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_promotedFromId_fkey" FOREIGN KEY ("promotedFromId") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

