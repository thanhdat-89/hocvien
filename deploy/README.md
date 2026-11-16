# Triển khai backend qlhv lên VPS

| | |
|---|---|
| VPS | `14.225.204.223` (Ubuntu 24.04, chung máy với hocthemtoan.vn) |
| Tách biệt | user Linux `qlhv`, thư mục `/srv/qlhv-api`, PM2 riêng, database `qlhv` + role `qlhv_app` |
| Cổng nội bộ | `127.0.0.1:3600`, nginx `api.qlhv.cqt.vn` |
| Frontend | vẫn ở Vercel (`qlhv.cqt.vn`), gọi `https://api.qlhv.cqt.vn` như cũ |
| Sao lưu | `qlhv-backup.timer` mỗi đêm 02:30 → `/var/backups/qlhv` |

| File | Vai trò |
|---|---|
| `sync-to-vps.sh` | (Mac) đẩy mã nguồn bằng rsync rồi chạy `deploy.sh` |
| `setup-vps.sh` | (root, một lần) user, `.env`, PM2 khởi động cùng máy, nginx, file cron |
| `deploy.sh` | (user qlhv) `npm ci` → migration → build → PM2 reload → kiểm tra `/health` |
| `ecosystem.config.cjs` | PM2: một tiến trình `qlhv-api` |
| `nginx/` | site `api.qlhv.cqt.vn` + snippet proxy (ghi đè `X-Forwarded-For`) |
| `cron/qlhv-api` | thay cho `crons` trong `vercel.json`, **comment sẵn** |
| `run-cron.sh` | gọi endpoint cron qua localhost với `CRON_SECRET`, ghi `/var/log/qlhv-api/cron.log` |
| `env.example` | danh sách biến môi trường |

## Giai đoạn 1 — chạy thử song song (không ảnh hưởng production)

Vercel + Firestore vẫn phục vụ người dùng. VPS chạy bản PostgreSQL với **chế độ thử nghiệm**: không có khoá MISA, SePay, Zalo, Telegram và cron chưa bật, nên không thể tạo hoá đơn thật hay gửi tin cho phụ huynh.

```sh
# trên Mac, trong thư mục backend của nhánh postgres-migration
bash deploy/sync-to-vps.sh --no-deploy
ssh -i ~/.ssh/htt_vps root@14.225.204.223 'cd /srv/qlhv-api && bash deploy/setup-vps.sh'
bash deploy/sync-to-vps.sh
```

Nạp dữ liệu thử từ một bản export (chạy trên Mac qua đường hầm SSH — file export chứa dữ liệu cá nhân không bị chép lên VPS):

```sh
ssh -i ~/.ssh/htt_vps -N -L 55433:127.0.0.1:5432 root@14.225.204.223 &
# lấy mật khẩu: ssh ... 'grep QLHV_DB_PASSWORD /root/qlhv-secrets.env'
DATABASE_URL="postgresql://qlhv_app:<mật khẩu>@127.0.0.1:55433/qlhv" npm run db:import -- "$HOME/qlhv-backup-YYYY-MM-DD"
```

Kiểm tra trước khi có DNS (đi thẳng tới VPS bằng header Host):

```sh
curl -H 'Host: api.qlhv.cqt.vn' http://14.225.204.223/health        # {"status":"ok","db":"ok"}
```

Muốn thử cả giao diện: tạo bản ghi DNS tạm `api-vps.qlhv.cqt.vn` → VPS, thêm vào `server_name`, `certbot --nginx -d api-vps.qlhv.cqt.vn`, rồi chạy frontend local trỏ vào địa chỉ đó.

## Giai đoạn 2 — buổi tối chuyển chính thức

Chọn giờ ít người dùng. Mọi bước đều quay lại được cho tới khi có người ghi dữ liệu mới trên VPS.

1. **Dừng ghi**: báo nhân viên ngừng thao tác. Trên dashboard SePay, tạm tắt webhook (giao dịch vẫn được SePay lưu, gửi lại được sau).
2. **Xuất – nhập dữ liệu**:
   ```sh
   node db/export-firestore.cjs "$HOME/qlhv-backup-YYYY-MM-DD-cutover"      # trong thư mục main
   # xoá dữ liệu thử trên VPS (database phải trống trước khi nhập), rồi nhập qua đường hầm như trên
   ```
   Đọc báo cáo của script nhập: không được có “Trường không được ánh xạ” hay “Collection chưa được xử lý”.
3. **Đối chiếu**: tổng phải thu / đã thu / thanh toán theo tháng giữa Firestore và PostgreSQL phải khớp (cùng phép so như `db/README.md`).
4. **Điền khoá thật và bật cron** trên VPS:
   - `/srv/qlhv-api/.env`: chép **đúng** `JWT_SECRET`, `CRON_SECRET`, `REPORTS_SECRET`, `TUITION_BULK_PASSWORD` và mọi khoá MISA/SePay/Zalo/ZNS/Telegram/Cloudinary từ Vercel (`vercel env pull` trên Mac). `JWT_SECRET` giống cũ → không ai bị đăng xuất.
   - Bỏ comment các dòng trong `/etc/cron.d/qlhv-api`.
   - `sudo -u qlhv -H pm2 reload qlhv-api --update-env`
5. **Chuyển DNS**: bản ghi `api.qlhv.cqt.vn` → `14.225.204.223` (TTL thấp từ trước 1 ngày). Khi đã trỏ: `certbot --nginx -d api.qlhv.cqt.vn`.
6. **Webhook**: bật lại webhook SePay (URL giữ nguyên `https://api.qlhv.cqt.vn/api/webhooks/sepay`), dùng “gửi lại” cho các giao dịch trong lúc tắt. Kiểm tra webhook Zalo, Telegram.
7. **Tắt phía Vercel**: xoá các cron trong dự án Vercel backend để không chạy song song (Vercel không còn nhận traffic sau khi DNS đổi, nhưng cron Vercel gọi thẳng deployment).
8. **Kiểm tra nhanh**: đăng nhập, danh sách học viên, bảng học phí tháng hiện tại (so tổng với bước 3), ghi nhận một thanh toán thử rồi xoá, trang phụ huynh `/hoc-vien/<id>`.

### Quay lại

- Trước khi có ghi mới trên VPS: trỏ DNS về Vercel như cũ, bật lại cron Vercel. Firestore chưa bị đổi gì.
- Sau khi đã có ghi mới trên VPS: phải chuyển các bản ghi mới về Firestore trước (đối chiếu theo `createdAt`/`updatedAt`), không đổi DNS ngược ngay.
- Giữ Firestore ở chế độ chỉ đọc ít nhất 30 ngày.

## Vận hành

```sh
cd /srv/qlhv-api && sudo -u qlhv -H pm2 status   # hoặc: logs qlhv-api | reload qlhv-api
tail -f /var/log/qlhv-api/cron.log
ls -la /var/backups/qlhv
```
