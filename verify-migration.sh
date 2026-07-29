#!/usr/bin/env bash
#
# 마이그레이션 재현 검증 — 로컬 Postgres 에 빈 DB 를 만들어 schema.sql +
# migrations/*.sql 을 파일명 순으로 전부 적용해 보고, 결과를 단언한다.
#
#   ./verify-migration.sh
#
# 왜 필요한가:
# 마이그레이션은 운영 DB 에서 딱 한 번 돌고, 틀리면 그때 알게 된다.
# Supabase SQL Editor 에 붙여넣기 전에 "이 SQL 이 실제로 실행되는가"를
# 여기서 먼저 확인한다. 매번 새 DB 로 시작하므로 운영 데이터는 건드리지 않는다.
#
# 검증 항목:
#   1) 전체 체인이 처음부터 끝까지 오류 없이 적용되는가
#   2) 20260802 가 기존 배정을 accepted 로 이행하는가 (진행 중 업무가 안 뒤집히는가)
#   3) 새로 만드는 배정의 기본값이 draft 인가
#   4) 다시 실행해도 안전한가 (멱등) — 이행된 값이 덮이지 않는가
#
# 필요: brew install postgresql@17 && brew services start postgresql@17

set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

DB="pe_migration_check"
SQL_DIR="supabase"
# psql 은 기본적으로 오류를 건너뛰고 계속한다 — 검증에서는 첫 오류에 멈춰야 한다
PSQL="psql -v ON_ERROR_STOP=1 -q -d $DB"

if ! pg_isready -q; then
  echo "✖ Postgres 가 떠 있지 않습니다. brew services start postgresql@17"
  exit 1
fi

echo "▸ 빈 DB 재생성: $DB"
dropdb --if-exists "$DB"
createdb "$DB"

# schema.sql 의 RLS 정책이 Supabase 가 기본 제공하는 롤(anon 등)에 GRANT 를 건다.
# 로컬 Postgres 에는 그 롤이 없어 그대로 두면 거기서 멈춘다 — 이름만 맞춰 만들어 준다.
# (권한 자체를 검증하려는 게 아니라 마이그레이션이 끝까지 흐르는지 보려는 것)
echo "▸ Supabase 롤 흉내내기 (anon / authenticated / service_role)"
for role in anon authenticated service_role; do
  psql -q -d "$DB" -c "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$role') THEN
      CREATE ROLE $role NOLOGIN;
    END IF;
  END \$\$;" > /dev/null
done

echo "▸ schema.sql 적용"
$PSQL -f "$SQL_DIR/schema.sql" > /dev/null

# 20260802 직전까지의 마이그레이션 — 그 시점의 운영 DB 상태를 만든다
echo "▸ 마이그레이션 적용 (20260802 이전)"
for f in "$SQL_DIR"/migrations/*.sql; do
  [ "$(basename "$f")" = "20260802_artist_portal.sql" ] && continue
  $PSQL -f "$f" > /dev/null
done

# 기존 배정 한 건을 심는다 — "이미 진행 중이던 업무"를 재현하기 위함.
# 이게 없으면 이행 로직(accepted 로 채우기)이 아무것도 안 하고 통과해 버린다.
echo "▸ 기존 배정 시드 (이행 대상)"
$PSQL > /dev/null <<'SEED'
INSERT INTO quotes (id, product, quantity, name, email, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'papercraft', '100', '테스트고객', 'a@b.kr', '010')
ON CONFLICT (id) DO NOTHING;

INSERT INTO assignments (id, quote_id, artist_id, status, progress, artist_fee)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'artist-01', 'working', 40, 1000000)
ON CONFLICT (id) DO NOTHING;
SEED

echo "▸ 20260802_artist_portal.sql 적용"
$PSQL -f "$SQL_DIR/migrations/20260802_artist_portal.sql" > /dev/null

# ── 단언 ───────────────────────────────────────────────────
fail=0
check() { # check <설명> <기대> <실제>
  if [ "$2" = "$3" ]; then
    printf '  ✅ %s\n' "$1"
  else
    printf '  ❌ %s — 기대 %s, 실제 %s\n' "$1" "$2" "$3"
    fail=1
  fi
}
q() { $PSQL -t -A -c "$1"; }

echo
echo "3단계 · 구조 확인"
check "artist_accounts 테이블" 1 \
  "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='artist_accounts'")"
check "assignments.offer_status" 1 \
  "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='assignments' AND column_name='offer_status'")"
check "assignments.deliverables" 1 \
  "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='assignments' AND column_name='deliverables'")"
check "artist_accounts → artists FK" 1 \
  "$(q "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name='artist_accounts_artist_id_fkey'")"
check "아티스트당 계정 1개 부분 유니크" 1 \
  "$(q "SELECT count(*) FROM pg_indexes WHERE indexname='artist_accounts_artist_unique'")"

echo
echo "4단계 · 기존 배정 이행"
check "기존 배정이 accepted 로" "accepted" \
  "$(q "SELECT offer_status FROM assignments WHERE id='22222222-2222-2222-2222-222222222222'")"
check "offered_at 채워짐" "f" \
  "$(q "SELECT offered_at IS NULL FROM assignments WHERE id='22222222-2222-2222-2222-222222222222'")"
check "responded_at 채워짐" "f" \
  "$(q "SELECT responded_at IS NULL FROM assignments WHERE id='22222222-2222-2222-2222-222222222222'")"
check "진행률 보존 (덮어쓰지 않음)" "40" \
  "$(q "SELECT progress FROM assignments WHERE id='22222222-2222-2222-2222-222222222222'")"

echo
echo "신규 배정 기본값"
$PSQL > /dev/null <<'NEW'
INSERT INTO assignments (id, quote_id, artist_id)
VALUES ('33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111', 'artist-02');
NEW
check "새 배정은 draft 로 시작" "draft" \
  "$(q "SELECT offer_status FROM assignments WHERE id='33333333-3333-3333-3333-333333333333'")"
check "deliverables 기본 빈 배열" "[]" \
  "$(q "SELECT deliverables::text FROM assignments WHERE id='33333333-3333-3333-3333-333333333333'")"

echo
echo "멱등성 · 다시 실행"
$PSQL -f "$SQL_DIR/migrations/20260802_artist_portal.sql" > /dev/null
check "재실행해도 기존 건은 accepted 유지" "accepted" \
  "$(q "SELECT offer_status FROM assignments WHERE id='22222222-2222-2222-2222-222222222222'")"
check "재실행해도 draft 건이 안 뒤집힘" "draft" \
  "$(q "SELECT offer_status FROM assignments WHERE id='33333333-3333-3333-3333-333333333333'")"

echo
if [ "$fail" = "0" ]; then
  echo "✅ 전부 통과 — 마이그레이션은 안전합니다."
  dropdb --if-exists "$DB"
else
  echo "❌ 실패한 항목이 있습니다. DB '$DB' 를 남겨 두었으니 psql 로 들여다보세요."
  exit 1
fi
