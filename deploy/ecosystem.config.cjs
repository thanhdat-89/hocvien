// PM2 (user qlhv): backend qlhv trên VPS.
// MỘT tiến trình: cache readViews và giới hạn kiểm tra MISA nằm trong bộ nhớ tiến trình.
//   pm2 startOrReload /srv/qlhv-api/deploy/ecosystem.config.cjs --update-env && pm2 save
module.exports = {
  apps: [
    {
      name: 'qlhv-api',
      cwd: '/srv/qlhv-api',
      script: 'dist/index.js',
      // VPS không có đường IPv6; Node mặc định thử mỗi địa chỉ 250ms nên kết nối IPv4 tới MISA/Telegram
      // (~200–250ms) lúc được lúc hỏng. Ưu tiên IPv4 và cho mỗi lần thử 2 giây.
      node_args: '--env-file=.env --dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=2000',
      env: { NODE_ENV: 'production', PORT: '3600', HOST: '127.0.0.1' },
      max_memory_restart: '500M',
      kill_timeout: 12000, // > 10 giây chờ request đang chạy trong index.ts
      time: true,
    },
  ],
}
