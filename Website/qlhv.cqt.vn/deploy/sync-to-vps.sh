#!/usr/bin/env bash
# Chạy trên máy Mac: đẩy mã nguồn backend lên VPS rồi chạy deploy.sh bằng user qlhv.
#   bash deploy/sync-to-vps.sh            # đẩy + triển khai
#   bash deploy/sync-to-vps.sh --no-deploy # chỉ đẩy mã nguồn (lần đầu, trước setup-vps.sh)
# Không cần GitHub trên VPS. Không đẩy .env, node_modules, dist, frontend (frontend vẫn ở Vercel).
set -euo pipefail
VPS=${VPS:-root@14.225.204.223}
KEY=${KEY:-$HOME/.ssh/htt_vps}
cd "$(dirname "$0")/.."

npx tsc --noEmit -p .   # không đẩy mã nguồn lỗi kiểu

# Chỉ đẩy file được git theo dõi: file chưa commit trong thư mục (ví dụ prisma.config.ts cũ) có thể làm hỏng
# migration hay build trên VPS.
UNTRACKED=$(mktemp); trap 'rm -f "$UNTRACKED"' EXIT
{ git ls-files --others --exclude-standard; git ls-files --others --ignored --exclude-standard --directory; } | sed 's#^#/#' > "$UNTRACKED"

rsync -azm --delete -e "ssh -i $KEY" --exclude-from="$UNTRACKED" \
  --exclude node_modules --exclude dist --exclude .env --exclude 'frontend/' --exclude 'test/' \
  --exclude '.playwright-mcp/' --exclude '*.log' --exclude 'scratchpad_*' --exclude 'firebase-service-account.json' \
  ./ "$VPS:/srv/qlhv-api/"

if [ "${1:-}" = "--no-deploy" ]; then echo "Đã đẩy mã nguồn."; exit 0; fi
ssh -i "$KEY" "$VPS" 'chown -R qlhv:qlhv /srv/qlhv-api && cd /srv/qlhv-api && sudo -u qlhv -H bash deploy/deploy.sh'
