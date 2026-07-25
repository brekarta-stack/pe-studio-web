#!/bin/sh
# restore-rehearsal.sh — 백업만으로 시스템을 되살릴 수 있는지 실증한다(D5 성공 기준).
#
# 검증하는 것(가장 위험한 실패 모드부터):
#  1. pg 덤프가 오류 없이 로드되는가 (globals + 본덤프, ON_ERROR_STOP)
#  2. 테이블 목록이 라이브와 일치하는가
#  3. ★ **N8N_ENCRYPTION_KEY가 실제로 크레덴셜을 복호화하는가** — 스크래치 n8n을 백업 키로 띄우고
#     복원된 워크플로를 실행해 크레덴셜(Bearer 토큰)이 동작하는지 확인. 이게 되면 "복구 가능"이 증명된다.
#     (키가 어긋나면 백업은 성공인데 모든 크레덴셜이 영구 소실 — 조용한 최악의 실패)
#  4. Kuma 데이터 아카이브가 온전한가
#
# 격리: 스크래치 컨테이너 2개(pg-restore-test / n8n-restore-test)만 쓰고 끝나면 지운다.
#      운영 컨테이너·볼륨·DB는 건드리지 않는다(읽기만).
# 사용: sudo sh restore-rehearsal.sh [백업디렉토리]   (생략 시 최신 백업)
set -u
umask 077

COMPOSE_DIR="${COMPOSE_DIR:-$HOME/agent-backbone}"
BACKUP_ROOT="${BACKUP_ROOT:-/volume2/backup/agent-backbone}"
NET=agent-backbone_default
PG_IMG=pgvector/pgvector:0.8.5-pg17-bookworm
N8N_IMG=n8nio/n8n:2.32.2
FAILS=0

SRC="${1:-$(ls -1d "$BACKUP_ROOT"/daily/*/ 2>/dev/null | tail -1)}"
[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "FATAL: 백업 디렉토리를 찾을 수 없다: $SRC"; exit 1; }
echo "== 복원 리허설 대상: $SRC =="

step() { echo; echo "-- $* --"; }
fail() { echo "  [FAIL] $*"; FAILS=$((FAILS+1)); }
pass() { echo "  [PASS] $*"; }

cleanup() {
  docker rm -f n8n-restore-test pg-restore-test >/dev/null 2>&1
}
trap cleanup EXIT

cleanup

# ── 0. 매니페스트 무결성 ──
step "0. SHA256 매니페스트"
if [ -f "$SRC/SHA256SUMS" ] && ( cd "$SRC" && sha256sum -c SHA256SUMS >/dev/null 2>&1 ); then
  pass "체크섬 일치"
else
  fail "체크섬 불일치 또는 매니페스트 없음"
fi

PGDUMP=$(ls -1 "$SRC"/pg_*.sql.gz 2>/dev/null | grep -v globals | head -1)
[ -n "$PGDUMP" ] || { fail "pg 덤프 없음"; exit 1; }

# ── 1. 스크래치 Postgres에 복원 ──
step "1. Postgres 복원"
docker run -d --name pg-restore-test --network "$NET" -e POSTGRES_PASSWORD=rehearsal "$PG_IMG" >/dev/null
i=0; until docker exec pg-restore-test pg_isready -U postgres -q 2>/dev/null; do
  i=$((i+1)); [ $i -gt 60 ] && { fail "스크래치 pg 기동 실패"; exit 1; }; sleep 1
done
gzip -dc "$SRC/pg_globals.sql.gz" 2>/dev/null | docker exec -i pg-restore-test psql -U postgres -q >/dev/null 2>&1
if gzip -dc "$PGDUMP" | docker exec -i pg-restore-test psql -U postgres -q -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
  pass "덤프 로드 무오류"
else
  fail "덤프 로드 중 오류"
fi

PG_DB=$(grep '^PG_DB=' "$SRC/env.backup" | cut -d= -f2- | tr -d ' \r')
PG_USER=$(grep '^PG_USER=' "$SRC/env.backup" | cut -d= -f2- | tr -d ' \r')

# ── 2. 테이블 대조 ──
step "2. 라이브와 테이블 목록 대조"
Q="SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1"
docker exec pg-restore-test psql -U postgres -d "$PG_DB" -tAc "$Q" 2>/dev/null | sort > /tmp/rh_restored.txt
(cd "$COMPOSE_DIR" && docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc "$Q" 2>/dev/null) | sort > /tmp/rh_live.txt
R=$(wc -l < /tmp/rh_restored.txt); L=$(wc -l < /tmp/rh_live.txt)
if [ "$R" -gt 0 ] && diff -q /tmp/rh_restored.txt /tmp/rh_live.txt >/dev/null 2>&1; then
  pass "테이블 $R개 완전 일치"
else
  fail "테이블 불일치 (복원 $R / 라이브 $L)"; diff /tmp/rh_restored.txt /tmp/rh_live.txt | head -5
fi
rm -f /tmp/rh_restored.txt /tmp/rh_live.txt

# ── 3. ★ 크레덴셜 복호화 검증 (핵심) ──
step "3. N8N_ENCRYPTION_KEY로 크레덴셜이 실제 복호화되는가"
EKEY=$(head -1 "$SRC/n8n_encryption_key.txt" 2>/dev/null | tr -d ' \r\n')
# 백업 키 == 라이브 키 인지 해시로 대조(값은 출력하지 않는다)
LIVEKEY=$(grep '^N8N_ENCRYPTION_KEY=' "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d ' \r')
if [ -n "$LIVEKEY" ] && [ -n "$EKEY" ]; then
  if [ "$(printf %s "$EKEY" | sha256sum)" = "$(printf %s "$LIVEKEY" | sha256sum)" ]; then
    pass "백업 키 == 라이브 키(해시 대조)"
  else
    fail "백업 키와 라이브 키가 다르다 — 이 백업으로는 현재 크레덴셜을 못 연다"
  fi
fi
if [ -z "$EKEY" ]; then
  fail "백업에 암호화 키가 없다 — 크레덴셜 복구 불가"
else
  # ⚠️ 컨테이너 env에 N8N_RUNNERS_BROKER_PORT를 주면 서버가 그 포트를 점유해
  #    이후 `n8n execute`(CLI)가 같은 포트를 쓰려다 충돌한다. 포트 지정은 exec 쪽에만.
  docker run -d --name n8n-restore-test --network "$NET" \
    -e DB_TYPE=postgresdb -e DB_POSTGRESDB_HOST=pg-restore-test -e DB_POSTGRESDB_DATABASE="$PG_DB" \
    -e DB_POSTGRESDB_USER=postgres -e DB_POSTGRESDB_PASSWORD=rehearsal \
    -e N8N_ENCRYPTION_KEY="$EKEY" -e N8N_SECURE_COOKIE=false -e N8N_DIAGNOSTICS_ENABLED=false \
    -e GENERIC_TIMEZONE=Asia/Seoul -e TZ=Asia/Seoul \
    "$N8N_IMG" >/dev/null
  i=0; until docker logs n8n-restore-test 2>&1 | grep -q "Editor is now accessible"; do
    i=$((i+1)); [ $i -gt 90 ] && break; sleep 2
  done
  # 복원된 워크플로 개수
  WF=$(docker exec pg-restore-test psql -U postgres -d "$PG_DB" -tAc "SELECT count(*) FROM workflow_entity" 2>/dev/null | tr -d ' ')
  CR=$(docker exec pg-restore-test psql -U postgres -d "$PG_DB" -tAc "SELECT count(*) FROM credentials_entity" 2>/dev/null | tr -d ' ')
  echo "  복원된 워크플로 $WF개 / 크레덴셜 $CR개"
  [ "${WF:-0}" -gt 0 ] || fail "워크플로가 복원되지 않음"
  [ "${CR:-0}" -gt 0 ] || fail "크레덴셜이 복원되지 않음"

  # 핵심: 복원된 크레덴셜로 실제 호출이 되는가(= 복호화 성공)
  OUT=$(docker exec -e N8N_RUNNERS_BROKER_PORT=5699 n8n-restore-test \
        n8n execute --id tbsmoke000000001 2>&1)
  if echo "$OUT" | grep -q '"status": "success"'; then
    pass "★ 복원된 크레덴셜로 LiteLLM 호출 성공 — 암호화 키 체인 검증 완료"
  else
    fail "복원된 크레덴셜로 호출 실패(복호화 실패 가능성)"
    echo "$OUT" | grep -iE "decrypt|credential|error|message" | head -4
  fi
fi

# ── 4. Kuma 아카이브 ──
step "4. Kuma 데이터"
if [ -f "$SRC/kuma_data.tar.gz" ] && tar -tzf "$SRC/kuma_data.tar.gz" 2>/dev/null | grep -q 'data/kuma.db'; then
  pass "kuma.db 포함, 아카이브 온전"
else
  fail "kuma 아카이브 손상 또는 kuma.db 없음"
fi

echo
if [ "$FAILS" -eq 0 ]; then
  echo "== 복원 리허설 통과: 이 백업만으로 시스템 복구 가능 =="
  exit 0
fi
echo "== 복원 리허설 실패 $FAILS건 — 위 [FAIL] 항목 해소 필요 =="
exit 1
