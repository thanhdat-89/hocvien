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

- Cấu hình rclone (chỉ root đọc): `/root/.config/rclone/rclone.conf`, gồm remote `qlhv-gdrive` (Drive, quyền `drive`, OAuth client riêng
  trong GCP project `qlhv-gdrive` từ 20/11/2026) và `qlhv-gdrive-crypt` (mã hoá, trỏ vào `qlhv-gdrive:QLHV-backup`).
- Mật khẩu mã hoá: `QLHV_BACKUP_PASSPHRASE` trong `/root/qlhv-secrets.env`. **Phải cất thêm một bản ngoài VPS**
  (trình quản lý mật khẩu): VPS mất thì chỉ còn mật khẩu này giải mã được bản trên Drive.
- Đẩy lỗi (ví dụ quyền Google bị thu hồi): bản trên VPS vẫn có, chuông thông báo của QLHV hiện cảnh báo "Sao lưu",
  `journalctl -u qlhv-backup.service` có chi tiết. Cấp lại quyền: chạy `rclone authorize "drive"` trên máy có trình duyệt
  rồi thay dòng `token = ...` của `[qlhv-gdrive]` trong file cấu hình.

Khôi phục từ Drive trên một máy bất kỳ có rclone (không cần VPS cũ):

```bash
rclone config create gd drive scope=drive                          # đăng nhập đúng tài khoản Google đã dùng
rclone config create gdc crypt remote=gd:QLHV-backup filename_encryption=off \
  directory_name_encryption=false password="$(rclone obscure 'MẬT_KHẨU_ĐÃ_CẤT')"
rclone ls gdc:                                                      # danh sách bản sao lưu
rclone copy gdc:qlhv-2026-10-29.dump .                              # tải và giải mã một bản
pg_restore --list qlhv-2026-10-29.dump | head                       # kiểm tra trước khi khôi phục
```

## Báo lỗi, điểm khôi phục trong ngày, khôi phục từng phần (21/11/2026)

**Báo lỗi.** `qlhv-backup` và `qlhv-checkpoint` lỗi → Telegram (bot chung) qua `theodoi-alert@` (cài từ repo theodoi,
`/usr/local/sbin/theodoi-alert.sh`). Drop-in: `systemd/qlhv-backup.service.d/alert.conf`.

**Điểm khôi phục.**

| Loại | Khi nào | Ở đâu (VPS) | Giữ | Drive (`qlhv-gdrive-crypt:`) |
|---|---|---|---|---|
| Đêm | 02:30 | `/var/backups/qlhv/qlhv-YYYY-MM-DD.dump` | 30 ngày | gốc, 30 ngày |
| Trong ngày | 15 phút một lần, chỉ khi có ghi mới (`qlhv-checkpoint.timer`) | `/var/backups/qlhv/checkpoints/` | 48 giờ | `checkpoints/` mỗi 2 giờ, 14 ngày |
| Trước thao tác nguy hiểm | backend, ngay trước khi chạy (`src/middleware/checkpointGuard.ts`) | `/home/qlhv/backups/checkpoints/pre-<thao-tác>-<giờ>-<đối tượng>-<người>.dump` | 14 ngày | `pre-op/` mỗi 2 giờ, 14 ngày |

Thao tác nguy hiểm: xoá hẳn học viên, xoá toàn bộ học viên, thêm học viên hàng loạt, nhập lịch học riêng, chuyển lớp,
tạo lịch tháng / tạo buổi từ lịch, xoá lịch học, xoá buổi hàng loạt, tính học phí hàng loạt, xoá thanh toán. Không tạo
được bản sao lưu → thao tác bị chặn (503) và báo Telegram. Bật bằng `CHECKPOINT_DIR=/home/qlhv/backups/checkpoints`
trong `/srv/qlhv-api/.env` (bỏ trống = tắt). Job tạo lịch ngày 1 hằng tháng (cron) đã có bản 15 phút ngay trước.

Cài đặt (root):

```sh
install -m 750 db/vps/qlhv-backup.sh /usr/local/bin/qlhv-backup
install -m 750 db/vps/qlhv-checkpoint.sh /usr/local/sbin/qlhv-checkpoint
install -m 750 db/vps/qlhv-restore-rows.sh /usr/local/sbin/qlhv-restore-rows
cp db/vps/systemd/qlhv-checkpoint.{service,timer} /etc/systemd/system/
cp -r db/vps/systemd/qlhv-backup.service.d /etc/systemd/system/
install -d -m 700 -o qlhv -g qlhv /home/qlhv/backups /home/qlhv/backups/checkpoints
systemctl daemon-reload && systemctl enable --now qlhv-checkpoint.timer
```

**Khôi phục từng phần — `qlhv-restore-rows`.** Không khôi phục đè cả database: thanh toán SePay / hoá đơn MISA vào sau
điểm khôi phục sẽ mất. Dựng điểm khôi phục ra database tạm rồi chép lại đúng phần hỏng (một transaction; lỗi → huỷ hết):

```sh
qlhv-restore-rows list                                   # chọn điểm khôi phục (thường là file pre-… của thao tác gây lỗi)
qlhv-restore-rows open /home/qlhv/backups/checkpoints/pre-xoa-hoc-vien-….dump
qlhv-restore-rows student <studentId>                    # chỉ xem: THIẾU / KHÁC / THỪA từng bảng
qlhv-restore-rows student <studentId> --apply            # chép lại dòng thiếu (học viên bị xoá nhầm)
qlhv-restore-rows rows tuition_records '"billingMonth" = 11 and "billingYear" = 2026' --overwrite  # học phí bị tính đè
qlhv-restore-rows rows sessions '"classId" = '"'"'<id>'"'"' and "sessionDate" >= '"'"'2026-12-01'"'"'' --delete-extra  # buổi tạo nhầm
qlhv-restore-rows close
```

`--apply` chỉ thêm dòng thiếu; `--overwrite` ghi đè dòng khác; `--delete-extra` xoá dòng không có trong điểm khôi phục
(xoá theo CASCADE — luôn xem trước). Xong tự đếm lại sĩ số lớp (nếu đụng ghi danh) và `pm2 reload qlhv-api` (xoá cache).
Điểm khôi phục khác migration với database thật → script từ chối, phải chép tay.
