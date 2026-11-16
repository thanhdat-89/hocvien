#!/usr/bin/env bash
# Sao lưu database qlhv mỗi đêm (systemd timer qlhv-backup.timer), giữ 30 bản trên VPS.
# Tách khỏi sao lưu của hocthemtoan (/var/backups/htt). Cài đặt: xem db/vps/README.md.
# Có remote rclone "qlhv-gdrive-crypt" (Google Drive, mã hoá) thì đẩy thêm bản mới lên Drive, giữ 30 ngày;
# đẩy lỗi thì ghi cảnh báo vào chuông thông báo của QLHV (bản trên VPS vẫn giữ).
set -euo pipefail
OUT=/var/backups/qlhv
REMOTE=qlhv-gdrive-crypt:
mkdir -p "$OUT" && chmod 700 "$OUT"
FILE="$OUT/qlhv-$(date +%F).dump"
sudo -u postgres pg_dump -Fc qlhv > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"
find "$OUT" -name 'qlhv-*.dump' -mtime +30 -delete
echo "$(date '+%F %T') qlhv backup: $(du -h "$FILE" | cut -f1)"

if rclone listremotes 2>/dev/null | grep -qx "$REMOTE"; then
  if rclone copyto "$FILE" "${REMOTE}$(basename "$FILE")" --retries 5 2>/tmp/qlhv-backup-upload.err \
    && rclone delete "$REMOTE" --min-age 30d 2>>/tmp/qlhv-backup-upload.err; then
    echo "$(date '+%F %T') qlhv backup: đã đẩy lên Google Drive"
  else
    echo "$(date '+%F %T') qlhv backup: LỖI đẩy lên Google Drive: $(tail -c 300 /tmp/qlhv-backup-upload.err)" >&2
    # Báo qua chuông thông báo (hiện ở mọi cơ sở); không chứa đường dẫn hay khoá
    sudo -u postgres psql -q -d qlhv -c "INSERT INTO admin_alerts (id, type, message, data, \"createdAt\") VALUES
      (substr(md5(random()::text), 1, 20), 'backup_failed',
       'Sao lưu đêm $(date +%d/%m/%Y) chưa đẩy được lên Google Drive (bản trên VPS vẫn có). Kiểm tra quyền Google Drive của rclone.',
       '{}'::jsonb, now())" || true
    exit 1
  fi
fi
