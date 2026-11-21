#!/usr/bin/env bash
# pg_dump giả cho kiểm thử điểm khôi phục: ghi tham số vào file -f (máy dev không cần cài pg_dump).
set -euo pipefail
out=
while [ $# -gt 0 ]; do
  case "$1" in -f) out=$2; shift 2 ;; *) shift ;; esac
done
echo "fake dump" > "$out"
