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
