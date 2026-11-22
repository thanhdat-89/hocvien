-- Số lần gọi MISA theo ngày và kết quả (services/misaHealth.ts).
CREATE TABLE "misa_call_stats" (
    "day" DATE NOT NULL,
    "outcome" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "misa_call_stats_pkey" PRIMARY KEY ("day","outcome")
);
