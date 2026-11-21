-- Ảnh chụp dữ liệu để hoàn tác thao tác nguy hiểm (src/lib/undo.ts). Giữ 30 ngày.
CREATE TABLE "undo_snapshots" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "branchId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "afterAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "undoneAt" TIMESTAMPTZ(3),
    "undoneById" TEXT,
    "undoResult" JSONB,

    CONSTRAINT "undo_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "undo_snapshots_expiresAt_idx" ON "undo_snapshots"("expiresAt");
