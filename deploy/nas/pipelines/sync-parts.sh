#!/bin/sh
# sync-parts.sh — part-definitions.yaml을 part_definitions 테이블로 동기화(멱등).
# 사용: sh sync-parts.sh [--prune] [yaml경로]
#   --prune: YAML에 없는 파트를 비활성화(기본 꺼짐 — 오타 하나로 전 사업이 멈추는 것 방지)
set -eu

PRUNE=""
YAML=""
for a in "$@"; do
  case "$a" in
    --prune) PRUNE="--prune" ;;
    *) YAML="$a" ;;
  esac
done

COMPOSE_DIR="${COMPOSE_DIR:-$HOME/agent-backbone}"
YAML="${YAML:-$COMPOSE_DIR/pipelines/part-definitions.yaml}"
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

[ -f "$YAML" ] || { echo "FATAL: YAML 없음: $YAML"; exit 1; }
cd "$COMPOSE_DIR"
PG_USER=$(grep '^PG_USER=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r' | sed "s/^[\"']//;s/[\"']$//")
PG_DB=$(grep '^PG_DB=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r' | sed "s/^[\"']//;s/[\"']$//")
PR_PW=$(grep '^PIPELINE_RUNNER_PASSWORD=' .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d ' \r' || true)
[ -n "$PG_USER" ] && [ -n "$PG_DB" ] || { echo "FATAL: .env의 PG_USER/PG_DB가 비었다"; exit 1; }

cleanup() { sudo -n docker compose exec -T postgres sh -c 'rm -f /tmp/init-parts.sql /tmp/parts.sql /tmp/role.sql' 2>/dev/null || true; }
trap cleanup EXIT   # 실패해도 컨테이너에 사업 키워드가 담긴 임시파일을 남기지 않는다

psqlf() { sudo -n docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -q -v ON_ERROR_STOP=1 -f "$1"; }

# 1) 스키마(추가형, 트랜잭션, 재적용 안전)
sudo -n docker compose cp "$HERE/init-parts.sql" postgres:/tmp/init-parts.sql >/dev/null
psqlf /tmp/init-parts.sql

# 2) 롤 LOGIN 부여 — 레포만으로 복원 가능하게(전엔 수동 부여라 어디에도 기록이 없었다)
if [ -n "$PR_PW" ]; then
  T0=$(mktemp); chmod 600 "$T0"
  printf "ALTER ROLE pipeline_runner LOGIN PASSWORD '%s';\n" "$PR_PW" > "$T0"
  sudo -n docker compose cp "$T0" postgres:/tmp/role.sql >/dev/null
  rm -f "$T0"
  psqlf /tmp/role.sql
else
  echo "WARN: .env에 PIPELINE_RUNNER_PASSWORD가 없다 — 롤이 NOLOGIN으로 남는다(n8n 접속 불가)"
fi

# 3) YAML → SQL → 적용
TMP=$(mktemp)
python3 "$HERE/load-parts.py" "$YAML" $PRUNE > "$TMP"
sudo -n docker compose cp "$TMP" postgres:/tmp/parts.sql >/dev/null
rm -f "$TMP"
psqlf /tmp/parts.sql

echo "--- 현재 파트 ---"
sudo -n docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -c \
  "SELECT part_key, name, active, synced_at::timestamp(0) FROM part_definitions ORDER BY part_key"
