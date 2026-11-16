-- Cơ sở làm việc của từng tài khoản (thay ô chọn cơ sở trên thanh trên cùng).
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "defaultBranchId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_defaultBranchId_fkey" FOREIGN KEY ("defaultBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Tài khoản hiện có: cơ sở đầu tiên được phân công; ADMIN chưa phân công thì cơ sở hoạt động đầu tiên
UPDATE "users" u SET "defaultBranchId" = (
  SELECT ub."branchId" FROM "user_branches" ub JOIN "branches" b ON b."id" = ub."branchId"
  WHERE ub."userId" = u."id" AND b."isActive" ORDER BY b."createdAt" LIMIT 1);
UPDATE "users" SET "defaultBranchId" = (SELECT "id" FROM "branches" WHERE "isActive" ORDER BY "createdAt" LIMIT 1)
WHERE "defaultBranchId" IS NULL AND "role" = 'ADMIN';
