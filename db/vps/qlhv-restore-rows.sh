#!/usr/bin/env bash
# /usr/local/sbin/qlhv-restore-rows — khôi phục TỪNG PHẦN database qlhv từ một điểm khôi phục (chạy bằng root trên VPS).
# Không khôi phục đè cả database: thanh toán SePay, hoá đơn MISA… vào sau điểm khôi phục sẽ mất. Thay vào đó dựng điểm
# khôi phục ra database tạm, so với database thật rồi chỉ chép lại đúng phần bị hỏng.
#
#   qlhv-restore-rows list [n]                 n điểm khôi phục mới nhất (đêm, mỗi 15 phút, trước thao tác nguy hiểm)
#   qlhv-restore-rows open <file.dump>         dựng file đó vào database tạm qlhv_restore
#   qlhv-restore-rows student <studentId> [cờ] học viên + mọi bảng có cột studentId (khôi phục học viên bị xoá)
#   qlhv-restore-rows class <classId> [cờ]     lớp + mọi bảng có cột classId
#   qlhv-restore-rows rows <bảng> '<where>' [cờ]  một bảng, điều kiện SQL, ví dụ:
#                    rows tuition_records '"billingMonth" = 11 and "billingYear" = 2026' --overwrite
#   qlhv-restore-rows close                    xoá database tạm
#
# Không cờ = chỉ xem: mỗi bảng có bao nhiêu dòng trong điểm khôi phục, bao nhiêu đang THIẾU, bao nhiêu KHÁC,
# bao nhiêu THỪA (có trong database thật, không có trong điểm khôi phục) so với database thật.
#   --apply         chép lại các dòng THIẾU (không đụng dòng đang có)
#   --overwrite     như --apply và ghi đè các dòng KHÁC bằng bản trong điểm khôi phục
#   --delete-extra  xoá thêm các dòng THỪA (ví dụ buổi học tạo nhầm hàng loạt). Xoá theo khoá ngoại CASCADE!
# Ghi trong một transaction; xong thì reload qlhv-api (xoá cache trong bộ nhớ) và đếm lại sĩ số lớp nếu có đụng ghi danh.
set -euo pipefail
# RESTORE_TARGET_DB: chỉ để thử script trên bản sao database (mặc định qlhv)
TMPDB=qlhv_restore LIVE=${RESTORE_TARGET_DB:-qlhv} STAGE=restore_stage
psql_() { sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -c 'set client_min_messages = warning' "$@"; }
q() { psql_ -d "$1" -Atc "$2"; }
die() { echo "✗ $*" >&2; exit 1; }
ident() { [[ $1 =~ ^[a-z_][a-z0-9_]*$ ]] || die "tên bảng không hợp lệ: $1"; }
idval() { [[ $1 =~ ^[A-Za-z0-9_-]+$ ]] || die "id không hợp lệ: $1"; }
[ "$(id -u)" = 0 ] || die "chạy bằng root"

cmd=${1:-}; shift || true
case "$cmd" in
  list)
    ls -1t /var/backups/qlhv/checkpoints/qlhv-*.dump /home/qlhv/backups/checkpoints/pre-*.dump /var/backups/qlhv/qlhv-*.dump \
      2>/dev/null | head -"${1:-30}" | while read -r f; do printf '%s  %s\n' "$(date -r "$f" '+%d/%m %H:%M')" "$f"; done
    exit 0 ;;
  open)
    f=${1:?thiếu file}; [ -f "$f" ] || die "không có file $f"
    sudo -u postgres dropdb --if-exists "$TMPDB" 2>/dev/null; sudo -u postgres createdb "$TMPDB"
    sudo -u postgres pg_restore --no-owner --no-privileges --exit-on-error -d "$TMPDB" < "$f" || die "pg_restore lỗi"
    echo "Đã dựng $f vào database $TMPDB (dữ liệu lúc $(date -r "$f" '+%d/%m/%Y %H:%M'))."
    exit 0 ;;
  close)
    sudo -u postgres dropdb --if-exists "$TMPDB" 2>/dev/null; q "$LIVE" "drop schema if exists $STAGE cascade" >/dev/null
    echo "Đã xoá database tạm."; exit 0 ;;
  student|class|rows) ;;
  *) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

# ── Chọn bảng + điều kiện ────────────────────────────────────────────
declare -a ENTRIES   # "bảng|where"
if [ "$cmd" = rows ]; then
  t=${1:?thiếu bảng}; w=${2:?thiếu điều kiện where}; shift 2; ident "$t"; ENTRIES=("$t|$w")
else
  id=${1:?thiếu id}; shift; idval "$id"
  if [ "$cmd" = student ]; then root=students col=studentId; else root=classes col=classId; fi
  ENTRIES=("$root|id = '$id'")
  for t in $(q "$LIVE" "select table_name from information_schema.columns where table_schema='public' and column_name='$col' order by 1"); do
    ENTRIES+=("$t|\"$col\" = '$id'")
  done
fi
MODE=view DELETE_EXTRA=0
for a in "$@"; do case "$a" in
  --apply) [ "$MODE" = overwrite ] || MODE=apply ;; --overwrite) MODE=overwrite ;; --delete-extra) DELETE_EXTRA=1 ;;
  *) die "cờ lạ: $a" ;; esac; done

[ "$(q postgres "select count(*) from pg_database where datname='$TMPDB'")" = 1 ] || die "chưa mở điểm khôi phục: qlhv-restore-rows open <file>"
mig="select coalesce(string_agg(migration_name, ',' order by migration_name), '') from _prisma_migrations where finished_at is not null"
[ "$(q "$TMPDB" "$mig")" = "$(q "$LIVE" "$mig")" ] || die "điểm khôi phục khác phiên bản schema (migration) với database thật — chép tay"

# ── Đưa các dòng trong điểm khôi phục sang schema tạm của database thật ─
q "$LIVE" "drop schema if exists $STAGE cascade; create schema $STAGE" >/dev/null
declare -A WHERE PK
TABLES=()
for e in "${ENTRIES[@]}"; do
  t=${e%%|*}; w=${e#*|}; ident "$t"
  [ -n "$(q "$LIVE" "select to_regclass('public.\"$t\"')")" ] || die "không có bảng $t"
  pk=$(q "$LIVE" "select string_agg(format('%I', a.attname), ',' order by a.attnum) from pg_index i
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum = any(i.indkey) where i.indrelid='public.\"$t\"'::regclass and i.indisprimary")
  [ -n "$pk" ] || die "bảng $t không có khoá chính"
  WHERE[$t]=$w PK[$t]=$pk; TABLES+=("$t")
  q "$LIVE" "create table $STAGE.\"$t\" (like public.\"$t\")" >/dev/null
  sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$TMPDB" -c "\\copy (select * from public.\"$t\" where $w) to stdout" \
    | sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$LIVE" -qc "\\copy $STAGE.\"$t\" from stdin"
done

# ── So sánh ─────────────────────────────────────────────────────────
join_on() { local t=$1 c out=""; IFS=, read -ra cs <<<"${PK[$t]}"; for c in "${cs[@]}"; do out+="${out:+ and }s.$c = l.$c"; done; echo "$out"; }
printf '%-28s %8s %8s %8s %8s\n' BẢNG "ĐIỂM KP" THIẾU KHÁC THỪA
total=0
for t in "${TABLES[@]}"; do
  on=$(join_on "$t"); w=${WHERE[$t]}
  r=$(q "$LIVE" "select (select count(*) from $STAGE.\"$t\"),
      (select count(*) from $STAGE.\"$t\" s where not exists (select 1 from public.\"$t\" l where $on)),
      (select count(*) from $STAGE.\"$t\" s join public.\"$t\" l on $on where to_jsonb(s) <> to_jsonb(l)),
      (select count(*) from (select * from public.\"$t\" where $w) l where not exists (select 1 from $STAGE.\"$t\" s where $on))")
  IFS='|' read -r n miss diff extra <<<"$r"
  printf '%-28s %8s %8s %8s %8s\n' "$t" "$n" "$miss" "$diff" "$extra"
  total=$((total + miss + diff + extra))
done

if [ "$MODE" = view ] && [ "$DELETE_EXTRA" = 0 ]; then
  q "$LIVE" "drop schema $STAGE cascade" >/dev/null
  echo; [ "$total" = 0 ] && echo "Không có gì khác." || echo "Chỉ xem. Thêm --apply / --overwrite / --delete-extra để ghi."
  exit 0
fi

# ── Ghi: thứ tự theo khoá ngoại (bảng được tham chiếu trước) ────────────
in_list=$(printf "'%s'," "${TABLES[@]}"); in_list=${in_list%,}
EDGES=$(q "$LIVE" "select c.conrelid::regclass::text || ' ' || c.confrelid::regclass::text from pg_constraint c
  where c.contype='f' and c.conrelid <> c.confrelid and c.conrelid::regclass::text in ($in_list) and c.confrelid::regclass::text in ($in_list)")
ORDER=() ; declare -A DONE
while [ ${#ORDER[@]} -lt ${#TABLES[@]} ]; do
  progress=0
  for t in "${TABLES[@]}"; do
    [ -n "${DONE[$t]:-}" ] && continue
    ready=1
    while read -r child parent; do
      [ "$child" = "$t" ] && [ -z "${DONE[$parent]:-}" ] && ready=0
    done <<<"$EDGES"
    [ $ready = 1 ] && { ORDER+=("$t"); DONE[$t]=1; progress=1; }
  done
  [ $progress = 1 ] || die "vòng khoá ngoại giữa các bảng, không tự sắp được thứ tự"
done

SQL="begin;"
if [ "$DELETE_EXTRA" = 1 ]; then
  for ((i=${#ORDER[@]}-1; i>=0; i--)); do t=${ORDER[$i]}; on=$(join_on "$t")
    SQL+=" delete from public.\"$t\" l where (${WHERE[$t]}) and not exists (select 1 from $STAGE.\"$t\" s where $on);"
  done
fi
if [ "$MODE" != view ]; then
  for t in "${ORDER[@]}"; do
    conflict="do nothing"
    if [ "$MODE" = overwrite ]; then
      set_list=$(q "$LIVE" "select string_agg(format('%I = excluded.%I', column_name, column_name), ', ') from information_schema.columns
        where table_schema='public' and table_name='$t' and column_name <> all(string_to_array('${PK[$t]//\"/}', ','))")
      [ -n "$set_list" ] && conflict="do update set $set_list"
    fi
    SQL+=" insert into public.\"$t\" select * from $STAGE.\"$t\" on conflict (${PK[$t]}) $conflict;"
  done
fi
if printf '%s\n' "${TABLES[@]}" | grep -qx class_enrollments; then
  SQL+=" update classes c set \"activeStudentCount\" = x.n from (select c2.id, (select count(*) from class_enrollments e
    where e.\"classId\" = c2.id and e.status = 'ACTIVE') n from classes c2) x where x.id = c.id and c.\"activeStudentCount\" <> x.n;"
fi
SQL+=" drop schema $STAGE cascade; commit;"
psql_ -d "$LIVE" -c "$SQL" || { q "$LIVE" "drop schema if exists $STAGE cascade" >/dev/null; die "ghi lỗi — đã huỷ toàn bộ, database thật không đổi"; }
echo; echo "✅ Đã ghi ($MODE$( [ "$DELETE_EXTRA" = 1 ] && echo ' + delete-extra'))."
if [ "$LIVE" = qlhv ]; then sudo -u qlhv pm2 reload qlhv-api --update-env >/dev/null && echo "Đã reload qlhv-api."; fi
