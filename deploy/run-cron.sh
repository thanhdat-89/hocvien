#!/usr/bin/env bash
# Gọi một endpoint cron của backend qua localhost với Bearer CRON_SECRET (đọc từ .env, không in ra).
#   run-cron.sh /api/classes/cron/audit
set -euo pipefail
ENDPOINT=${1:?Thiếu đường dẫn cron}
SECRET=$(grep -E '^CRON_SECRET=' /srv/qlhv-api/.env | cut -d= -f2- | tr -d '"')
[ -n "$SECRET" ] || { echo "$(date '+%F %T') thiếu CRON_SECRET" >&2; exit 1; }
STATUS=$(curl -sS -o /tmp/qlhv-cron.out -w '%{http_code}' -m 300 -H "Authorization: Bearer $SECRET" "http://127.0.0.1:3600$ENDPOINT")
echo "$(date '+%F %T') $ENDPOINT HTTP $STATUS $(head -c 300 /tmp/qlhv-cron.out)" >> /var/log/qlhv-api/cron.log
[ "$STATUS" -lt 400 ]
