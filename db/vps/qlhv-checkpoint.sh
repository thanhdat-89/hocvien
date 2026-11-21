#!/usr/bin/env bash
# /usr/local/sbin/qlhv-checkpoint — điểm khôi phục trong ngày, systemd qlhv-checkpoint.timer chạy mỗi 15 phút, bằng root.
#  1. Database qlhv có ghi mới (trừ nhật ký thao tác) kể từ lần trước → pg_dump vào /var/backups/qlhv/checkpoints,
#     giữ 48 giờ. Không có gì mới → bỏ qua.
#  2. Cứ 2 giờ: đẩy bản mới nhất + các điểm khôi phục trước thao tác nguy hiểm (backend tạo ở
#     /home/qlhv/backups/checkpoints, xem src/middleware/checkpointGuard.ts) lên Google Drive
#     (qlhv-gdrive-crypt:checkpoints/, pre-op/), giữ 14 ngày trên Drive.
# Lỗi → exit 1 → theodoi-alert@ báo Telegram. Khôi phục từng phần: qlhv-restore-rows (db/vps/README.md).
set -euo pipefail
OUT=/var/backups/qlhv/checkpoints
PREOP=/home/qlhv/backups/checkpoints
REMOTE=qlhv-gdrive-crypt:
KEEP_MIN=$((48 * 60))
UPLOAD_EVERY_MIN=120
mkdir -p "$OUT" && chmod 700 "$OUT"

# Tổng số dòng đã ghi (bộ đếm tích luỹ của PostgreSQL) — đổi ⇒ có dữ liệu mới
COUNTER=$(sudo -u postgres psql -d qlhv -Atc "select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)
  from pg_stat_user_tables where relname not in ('activity_logs', '_prisma_migrations')")
LAST=$(cat "$OUT/.counter" 2>/dev/null || echo none)

if [ "$COUNTER" != "$LAST" ]; then
  FILE="$OUT/qlhv-$(date +%Y%m%d-%H%M).dump"
  sudo -u postgres pg_dump -Fc qlhv > "$FILE.tmp"
  [ -s "$FILE.tmp" ] || { rm -f "$FILE.tmp"; echo "pg_dump ra file rỗng" >&2; exit 1; }
  mv "$FILE.tmp" "$FILE" && chmod 600 "$FILE"
  echo "$COUNTER" > "$OUT/.counter"
  echo "$(date '+%F %T') checkpoint: $(basename "$FILE") ($(du -h "$FILE" | cut -f1))"
fi
find "$OUT" -name 'qlhv-*.dump' -mmin +$KEEP_MIN -delete

# Đẩy lên Google Drive (nếu có rclone remote), tối đa 2 giờ một lần
if rclone listremotes 2>/dev/null | grep -qx "$REMOTE" \
  && { [ ! -e "$OUT/.uploaded" ] || [ -n "$(find "$OUT/.uploaded" -mmin +$UPLOAD_EVERY_MIN)" ]; }; then
  NEWEST=$(ls -1t "$OUT"/qlhv-*.dump 2>/dev/null | head -1 || true)
  ERR=$(mktemp); trap 'rm -f "$ERR"' EXIT
  if [ -n "$NEWEST" ] && { [ ! -e "$OUT/.uploaded" ] || [ "$NEWEST" -nt "$OUT/.uploaded" ]; }; then
    rclone copyto "$NEWEST" "${REMOTE}checkpoints/$(basename "$NEWEST")" --retries 5 2>>"$ERR" \
      || { echo "LỖI đẩy checkpoint lên Drive: $(tail -c 300 "$ERR")" >&2; exit 1; }
  fi
  if [ -d "$PREOP" ]; then
    rclone copy "$PREOP" "${REMOTE}pre-op" --include 'pre-*.dump' --retries 5 2>>"$ERR" \
      || { echo "LỖI đẩy điểm khôi phục trước thao tác lên Drive: $(tail -c 300 "$ERR")" >&2; exit 1; }
  fi
  rclone delete "${REMOTE}checkpoints" --min-age 14d 2>>"$ERR" || true
  rclone delete "${REMOTE}pre-op" --min-age 14d 2>>"$ERR" || true
  touch "$OUT/.uploaded"
  echo "$(date '+%F %T') checkpoint: đã đồng bộ lên Google Drive"
fi
