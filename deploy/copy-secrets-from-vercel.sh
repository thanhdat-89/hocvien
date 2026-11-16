#!/usr/bin/env bash
# Chạy trên Mac lúc chuyển chính thức: chép biến môi trường production của dự án Vercel hocvien-backend
# sang /srv/qlhv-api/.env trên VPS. Giữ DATABASE_URL của VPS; bỏ biến chỉ dành cho Vercel/Firebase/Supabase
# và MAINTENANCE_MODE. Giá trị không bao giờ được in ra; file tạm bị xoá khi kết thúc.
#   bash deploy/copy-secrets-from-vercel.sh
set -euo pipefail
VPS=${VPS:-root@14.225.204.223}
KEY=${KEY:-$HOME/.ssh/htt_vps}
BACKEND_DIR=${BACKEND_DIR:-$HOME/Website/qlhv.cqt.vn}   # thư mục đang liên kết dự án Vercel hocvien-backend

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"

(cd "$BACKEND_DIR" && vercel env pull --yes --environment production "$TMP/vercel.env" >/dev/null)
grep -E '^[A-Z0-9_]+=' "$TMP/vercel.env" \
  | grep -vE '^(VERCEL|VERCEL_[A-Z0-9_]*|TURBO_[A-Z0-9_]*|NX_[A-Z0-9_]*|MAINTENANCE_MODE|FIREBASE_[A-Z0-9_]*|GOOGLE_APPLICATION_CREDENTIALS|SUPABASE_[A-Z0-9_]*|STUDENTS_READ_SOURCE|REPORTS_READ_SOURCE|DATABASE_URL|PORT|HOST|NODE_ENV)=' \
  > "$TMP/keep.env" || true
[ -s "$TMP/keep.env" ] || { echo "Không lấy được biến nào từ Vercel — dừng, .env trên VPS giữ nguyên"; exit 1; }
for required in JWT_SECRET CRON_SECRET; do
  grep -q "^$required=" "$TMP/keep.env" || { echo "Vercel thiếu $required — dừng, .env trên VPS giữ nguyên"; exit 1; }
done
echo "Chép $(wc -l < "$TMP/keep.env" | tr -d ' ') biến: $(cut -d= -f1 "$TMP/keep.env" | tr '\n' ' ')"

ssh -i "$KEY" "$VPS" 'set -e; cd /srv/qlhv-api
  cp -a .env ".env.trial-$(date +%Y%m%d%H%M%S)"
  { grep -E "^DATABASE_URL=" .env; cat; } > .env.new
  chown qlhv:qlhv .env.new && chmod 600 .env.new && mv .env.new .env
  echo "Đã cập nhật /srv/qlhv-api/.env (bản chạy thử được lưu .env.trial-*)"' < "$TMP/keep.env"
