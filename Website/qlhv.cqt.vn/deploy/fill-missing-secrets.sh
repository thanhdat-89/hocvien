#!/usr/bin/env bash
# Chạy trên Mac: điền các biến đang RỖNG trong /srv/qlhv-api/.env trên VPS bằng giá trị trong .env trên máy.
# Dùng cho biến "Sensitive" của Vercel (vercel env pull trả về rỗng), ví dụ khoá MEINVOICE.
#   1. Thêm các dòng còn thiếu (MEINVOICE_CLIENT_ID=..., ...) vào $LOCAL_ENV bằng trình soạn thảo
#   2. bash deploy/fill-missing-secrets.sh
# Không in giá trị; chỉ điền biến đang rỗng trên VPS, không ghi đè biến đã có giá trị.
set -euo pipefail
VPS=${VPS:-root@14.225.204.223}
KEY=${KEY:-$HOME/.ssh/htt_vps}
LOCAL_ENV=${LOCAL_ENV:-$HOME/Website/qlhv.cqt.vn/.env}

EMPTY=$(ssh -i "$KEY" "$VPS" "awk -F= '/^[A-Z0-9_]+=/{v=substr(\$0,index(\$0,\"=\")+1); gsub(/^\"|\"\$/,\"\",v); if(v==\"\") print \$1}' /srv/qlhv-api/.env")
[ -n "$EMPTY" ] || { echo "Không còn biến rỗng trên VPS."; exit 0; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT; chmod 700 "$TMP"
: > "$TMP/fill.env"
FILLED=(); MISSING=()
for name in $EMPTY; do
  line=$(grep -E "^${name}=" "$LOCAL_ENV" | tail -1 || true)
  value=${line#*=}; value=${value%\"}; value=${value#\"}
  if [ -n "$value" ]; then echo "$line" >> "$TMP/fill.env"; FILLED+=("$name"); else MISSING+=("$name"); fi
done
echo "Điền từ $LOCAL_ENV: ${FILLED[*]:-(không có)}"
[ ${#MISSING[@]} -eq 0 ] || echo "Vẫn thiếu (chưa có trong $LOCAL_ENV): ${MISSING[*]}"
[ -s "$TMP/fill.env" ] || exit 0

ssh -i "$KEY" "$VPS" 'set -e; cd /srv/qlhv-api; cp -a .env ".env.before-fill-$(date +%Y%m%d%H%M%S)"
  python3 -c "
import sys
fill = dict(l.split(\"=\", 1) for l in sys.stdin.read().splitlines() if \"=\" in l)
out = []
for l in open(\".env\").read().splitlines():
    k = l.split(\"=\", 1)[0]
    out.append(k + \"=\" + fill.pop(k) if k in fill else l)
open(\".env.new\", \"w\").write(\"\\n\".join(out) + \"\\n\")
"
  chown qlhv:qlhv .env.new && chmod 600 .env.new && mv .env.new .env
  sudo -u qlhv -H pm2 reload qlhv-api --update-env >/dev/null && echo "Đã điền và khởi động lại qlhv-api"' < "$TMP/fill.env"
