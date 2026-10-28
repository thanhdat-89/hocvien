#!/usr/bin/env bash
# Sao lưu database qlhv mỗi đêm (systemd timer qlhv-backup.timer), giữ 30 bản.
# Tách khỏi sao lưu của hocthemtoan (/var/backups/htt). Cài đặt: xem db/vps/README.md.
set -euo pipefail
OUT=/var/backups/qlhv
mkdir -p "$OUT" && chmod 700 "$OUT"
FILE="$OUT/qlhv-$(date +%F).dump"
sudo -u postgres pg_dump -Fc qlhv > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"
find "$OUT" -name 'qlhv-*.dump' -mtime +30 -delete
echo "$(date '+%F %T') qlhv backup: $(du -h "$FILE" | cut -f1)"
