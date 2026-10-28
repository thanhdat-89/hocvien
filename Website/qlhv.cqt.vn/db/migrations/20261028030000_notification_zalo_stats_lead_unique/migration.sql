-- DropIndex
DROP INDEX "leads_zaloUserId_idx";

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "zaloQueued" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zaloSentCount" INTEGER,
ADD COLUMN     "zaloTotalTargets" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "leads_zaloUserId_key" ON "leads"("zaloUserId");

