# Giai đoạn 0 — chuẩn bị VPS cho qlhv

VPS: `14.225.204.223` (Ubuntu 24.04, 4 vCPU, 5,8 GB RAM, PostgreSQL 17.11). Chạy bằng root.

## 1. Tạo database và role

```sh
scp -i ~/.ssh/htt_vps db/vps/setup-qlhv-db.sh root@14.225.204.223:/root/
ssh -i ~/.ssh/htt_vps root@14.225.204.223 bash /root/setup-qlhv-db.sh
```

Script dừng nếu role, file mật khẩu hoặc luật pg_hba đã có, nên chạy lại không ghi đè gì. Trước khi sửa `pg_hba.conf`, script sao lưu file đó thành `.bak-<thời gian>`.

## 2. Sao lưu hằng đêm

Script dùng systemd timer, vì VPS chưa cài gói `cron`:

```sh
scp -i ~/.ssh/htt_vps db/vps/qlhv-backup.sh root@14.225.204.223:/usr/local/bin/qlhv-backup
ssh -i ~/.ssh/htt_vps root@14.225.204.223 'chmod 750 /usr/local/bin/qlhv-backup
cat > /etc/systemd/system/qlhv-backup.service <<EOF
[Unit]
Description=Sao lưu database qlhv
[Service]
Type=oneshot
ExecStart=/usr/local/bin/qlhv-backup
EOF
cat > /etc/systemd/system/qlhv-backup.timer <<EOF
[Unit]
Description=Sao lưu database qlhv mỗi đêm
[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload && systemctl enable --now qlhv-backup.timer && systemctl start qlhv-backup.service && ls -la /var/backups/qlhv'
```

Vẫn cần chép bản sao lưu ra ngoài VPS (Google Drive, R2…). Nơi lưu sẽ chọn sau.

## Kiểm tra sau khi chạy

```sh
ssh -i ~/.ssh/htt_vps root@14.225.204.223 'sudo -u postgres psql -Atc "
select has_database_privilege('"'"'htt_web'"'"','"'"'qlhv'"'"','"'"'CONNECT'"'"') as web_vao_qlhv,
       has_database_privilege('"'"'htt_bank'"'"','"'"'qlhv'"'"','"'"'CONNECT'"'"') as bank_vao_qlhv,
       (select datdba::regrole from pg_database where datname='"'"'qlhv'"'"') as chu_so_huu"'
```

Kết quả đúng: `f|f|qlhv_app`. Luật pg_hba ngăn `qlhv_app` vào `hocthemtoan` có thể kiểm tra bằng `select * from pg_hba_file_rules where '"'"'qlhv_app'"'"' = any(user_name)`.

## Sao lưu lên Google Drive (mã hoá)

Từ 29/10/2026, `qlhv-backup` (02:30 mỗi đêm) sau khi dump còn đẩy bản mới lên Google Drive, thư mục `QLHV-backup`,
giữ 30 ngày. File trên Drive (`qlhv-YYYY-MM-DD.dump.bin`) được mã hoá bằng rclone crypt; không có mật khẩu thì không đọc được.

- Cấu hình rclone (chỉ root đọc): `/root/.config/rclone/rclone.conf`, gồm remote `qlhv-gdrive` (Drive, quyền `drive.file`:
  chỉ thấy file do rclone tạo) và `qlhv-gdrive-crypt` (mã hoá, trỏ vào `qlhv-gdrive:QLHV-backup`).
- Mật khẩu mã hoá: `QLHV_BACKUP_PASSPHRASE` trong `/root/qlhv-secrets.env`. **Phải cất thêm một bản ngoài VPS**
  (trình quản lý mật khẩu): VPS mất thì chỉ còn mật khẩu này giải mã được bản trên Drive.
- Đẩy lỗi (ví dụ quyền Google bị thu hồi): bản trên VPS vẫn có, chuông thông báo của QLHV hiện cảnh báo "Sao lưu",
  `journalctl -u qlhv-backup.service` có chi tiết. Cấp lại quyền: chạy `rclone authorize "drive"` trên máy có trình duyệt
  rồi thay dòng `token = ...` của `[qlhv-gdrive]` trong file cấu hình.

Khôi phục từ Drive trên một máy bất kỳ có rclone (không cần VPS cũ):

```bash
rclone config create gd drive scope=drive.file                     # đăng nhập đúng tài khoản Google đã dùng
rclone config create gdc crypt remote=gd:QLHV-backup filename_encryption=off \
  directory_name_encryption=false password="$(rclone obscure 'MẬT_KHẨU_ĐÃ_CẤT')"
rclone ls gdc:                                                      # danh sách bản sao lưu
rclone copy gdc:qlhv-2026-10-29.dump .                              # tải và giải mã một bản
pg_restore --list qlhv-2026-10-29.dump | head                       # kiểm tra trước khi khôi phục
```
