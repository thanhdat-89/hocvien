-- AlterTable
ALTER TABLE "tuition_records" ADD COLUMN     "adjustmentAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "adjustmentNote" TEXT;

-- CreateTable
CREATE TABLE "tuition_adjustments" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "billingMonth" INTEGER NOT NULL,
    "billingYear" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tuition_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tuition_adjustments_studentId_classId_billingYear_billingMo_idx" ON "tuition_adjustments"("studentId", "classId", "billingYear", "billingMonth");

-- AddForeignKey
ALTER TABLE "tuition_adjustments" ADD CONSTRAINT "tuition_adjustments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuition_adjustments" ADD CONSTRAINT "tuition_adjustments_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuition_adjustments" ADD CONSTRAINT "tuition_adjustments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

