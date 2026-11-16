-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "before" JSONB,
ALTER COLUMN "ip" DROP NOT NULL;

