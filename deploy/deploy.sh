#!/usr/bin/env bash
# Cài/cập nhật backend qlhv. Chạy bằng user qlhv (sync-to-vps.sh gọi tự động):
#   sudo -u qlhv -H bash /srv/qlhv-api/deploy/deploy.sh
set -euo pipefail
APP=/srv/qlhv-api
cd $APP
[ "$(whoami)" = qlhv ] || { echo "Chạy bằng user qlhv"; exit 1; }
[ -f .env ] || { echo "Thiếu $APP/.env — chạy deploy/setup-vps.sh"; exit 1; }
log() { echo -e "\n\033[1;34m==> $*\033[0m"; }

log "Cài thư viện"
npm ci --no-audit --no-fund
log "Sao lưu database qlhv trước khi migrate"
# Bằng chính tài khoản DB của ứng dụng (user qlhv không có sudo postgres). Lỗi → dừng deploy, chưa migrate.
# Giữ 10 bản gần nhất. Khôi phục: pg_restore --clean --if-exists -d "<DATABASE_URL>" <file>
BACKUP_DIR=$HOME/backups/pre-migrate
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
DB_URL=$(set -a; . ./.env; echo "${DATABASE_URL%%\?*}")   # pg_dump không nhận tham số ?schema=… của Prisma
BACKUP="$BACKUP_DIR/qlhv-$(date +%Y%m%d-%H%M%S).dump"
pg_dump -Fc "$DB_URL" -f "$BACKUP.tmp"
mv "$BACKUP.tmp" "$BACKUP" && chmod 600 "$BACKUP"
ls -1t "$BACKUP_DIR"/qlhv-*.dump | tail -n +11 | xargs -r rm -f
echo "Đã sao lưu: $BACKUP ($(du -h "$BACKUP" | cut -f1))"

log "Prisma client + migration"
npx prisma generate
npx prisma migrate deploy
log "Build"
npm run build
log "Khởi động lại (PM2)"
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save >/dev/null

for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3600/health | grep -q '"db":"ok"'; then echo "✓ backend đang chạy, database OK"; exit 0; fi
  sleep 1
done
echo "✗ /health lỗi — xem: pm2 logs qlhv-api"; exit 1
