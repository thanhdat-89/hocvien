#!/usr/bin/env bash
# Cài môi trường cho backend qlhv trên VPS — chạy MỘT lần bằng root (sau db/vps/setup-qlhv-db.sh).
#   bash /srv/qlhv-api/deploy/setup-vps.sh
# Tách biệt với hocthemtoan: user Linux riêng (qlhv), thư mục riêng, PM2 riêng, database riêng.
# Không bật cron và không điền khoá MISA/SePay/Zalo/Telegram — việc đó làm lúc chuyển chính thức.
set -euo pipefail
APP=/srv/qlhv-api
[ "$(id -u)" = 0 ] || { echo "Cần chạy bằng root"; exit 1; }
[ -f /root/qlhv-secrets.env ] || { echo "Thiếu /root/qlhv-secrets.env — chạy db/vps/setup-qlhv-db.sh trước"; exit 1; }
[ -f $APP/deploy/env.example ] || { echo "Chưa có mã nguồn ở $APP — chạy deploy/sync-to-vps.sh từ máy Mac trước"; exit 1; }

# 1. User và thư mục
id qlhv >/dev/null 2>&1 || useradd -m -s /bin/bash qlhv
# Lệnh chạy bằng user qlhv không được kế thừa thư mục /root (PM2 sinh tiến trình con sẽ báo EACCES).
cd $APP
mkdir -p /var/log/qlhv-api
chown -R qlhv:qlhv $APP /var/log/qlhv-api

# 2. .env (không ghi đè nếu đã có)
if [ ! -f $APP/.env ]; then
  # shellcheck disable=SC1091
  DATABASE_URL=$(grep -E '^DATABASE_URL=' /root/qlhv-secrets.env | cut -d= -f2-)
  rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  sed -e "s#^DATABASE_URL=.*#DATABASE_URL=${DATABASE_URL}#" \
      -e "s#^JWT_SECRET=.*#JWT_SECRET=$(rand 48)#" \
      -e "s#^CRON_SECRET=.*#CRON_SECRET=$(rand 40)#" \
      -e "s#^REPORTS_SECRET=.*#REPORTS_SECRET=$(rand 40)#" \
      -e "s#^TUITION_BULK_PASSWORD=.*#TUITION_BULK_PASSWORD=$(rand 16)#" \
      $APP/deploy/env.example > $APP/.env
  chown qlhv:qlhv $APP/.env && chmod 600 $APP/.env
  echo "Đã tạo $APP/.env (chế độ thử nghiệm: khoá ngẫu nhiên, chưa có khoá dịch vụ ngoài)"
fi

# 3. PM2 cho user qlhv (tự khởi động cùng máy) + xoay vòng log
sudo -u qlhv -H pm2 ping >/dev/null
sudo -u qlhv -H pm2 install pm2-logrotate >/dev/null 2>&1 || true
pm2 startup systemd -u qlhv --hp /home/qlhv >/dev/null

# 4. Nginx (HTTPS cấp sau khi DNS api.qlhv.cqt.vn trỏ về VPS)
cp $APP/deploy/nginx/qlhv-proxy.conf /etc/nginx/snippets/qlhv-proxy.conf
cp $APP/deploy/nginx/api.qlhv.cqt.vn.conf /etc/nginx/sites-available/api.qlhv.cqt.vn
ln -sf /etc/nginx/sites-available/api.qlhv.cqt.vn /etc/nginx/sites-enabled/api.qlhv.cqt.vn
nginx -t && systemctl reload nginx

# 5. Cron: cài file nhưng mọi dòng đang comment (bật ở bước chuyển chính thức)
chmod 755 $APP/deploy/run-cron.sh
cp $APP/deploy/cron/qlhv-api /etc/cron.d/qlhv-api && chmod 644 /etc/cron.d/qlhv-api

echo "Xong. Tiếp theo: sudo -u qlhv -H bash $APP/deploy/deploy.sh"
