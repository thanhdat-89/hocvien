#!/usr/bin/env bash
# Tạo database `qlhv` + role `qlhv_app` tách biệt trên PostgreSQL 17 của VPS. Chạy MỘT lần, bằng root:
#   scp db/vps/setup-qlhv-db.sh root@14.225.204.223:/root/ && ssh root@14.225.204.223 bash /root/setup-qlhv-db.sh
#
# Tách biệt với hocthemtoan/nganhang:
#  - qlhv thuộc qlhv_app; PUBLIC không có quyền CONNECT → htt_web/htt_bank không vào được qlhv.
#  - pg_hba.conf: qlhv_app chỉ vào được database qlhv qua localhost; mọi database khác bị từ chối.
#  - Không sửa quyền của database hocthemtoan.
# Mật khẩu sinh ngẫu nhiên, lưu ở /root/qlhv-secrets.env (600), không in ra màn hình.
set -euo pipefail

HBA=/etc/postgresql/17/main/pg_hba.conf
SECRETS=/root/qlhv-secrets.env

[ "$(id -u)" = 0 ] || { echo "Cần chạy bằng root"; exit 1; }
[ ! -e "$SECRETS" ] || { echo "$SECRETS đã tồn tại — dừng để không ghi đè"; exit 1; }
if sudo -u postgres psql -Atc "select 1 from pg_roles where rolname='qlhv_app'" | grep -q 1; then
  echo "Role qlhv_app đã tồn tại — dừng"; exit 1
fi
if grep -q qlhv_app "$HBA"; then
  echo "pg_hba.conf đã có luật qlhv_app — dừng"; exit 1
fi

PW=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)
umask 077
cat > "$SECRETS" <<EOF
QLHV_DB_PASSWORD=$PW
DATABASE_URL=postgresql://qlhv_app:$PW@127.0.0.1:5432/qlhv
EOF

sudo -u postgres psql -v ON_ERROR_STOP=1 -q -v pw="$PW" <<'SQL'
CREATE ROLE qlhv_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30 PASSWORD :'pw';
CREATE DATABASE qlhv OWNER qlhv_app ENCODING 'UTF8' LOCALE_PROVIDER libc LOCALE 'C.UTF-8' TEMPLATE template0;
REVOKE ALL ON DATABASE qlhv FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE qlhv TO qlhv_app;
ALTER DATABASE qlhv SET timezone TO 'Asia/Ho_Chi_Minh';
\c qlhv
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO qlhv_app;
SQL
unset PW

cp -a "$HBA" "$HBA.bak-$(date +%Y%m%d-%H%M%S)"
python3 - "$HBA" <<'PY'
import sys
path = sys.argv[1]
lines = open(path).read().splitlines(keepends=True)
block = """# --- qlhv: qlhv_app chỉ vào database qlhv qua localhost; mọi nơi khác bị từ chối ---
host    qlhv            qlhv_app        127.0.0.1/32            scram-sha-256
host    qlhv            qlhv_app        ::1/128                 scram-sha-256
host    all             qlhv_app        all                     reject
local   all             qlhv_app                                reject
# --- hết qlhv ---
"""
# Chèn trước luật đầu tiên để được so khớp trước các luật "all".
first_rule = next(i for i, l in enumerate(lines) if l.strip() and not l.lstrip().startswith('#'))
open(path, 'w').write(''.join(lines[:first_rule]) + block + ''.join(lines[first_rule:]))
PY

if [ "$(sudo -u postgres psql -Atc 'select count(*) from pg_hba_file_rules where error is not null')" != 0 ]; then
  echo "pg_hba.conf có lỗi — khôi phục bản .bak mới nhất rồi chạy lại"; exit 1
fi
sudo -u postgres psql -Atc 'select pg_reload_conf()' >/dev/null

echo "Đã tạo database qlhv và role qlhv_app. Thông tin kết nối: $SECRETS"
