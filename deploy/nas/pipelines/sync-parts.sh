#!/bin/sh
# sync-parts.sh — part-definitions.yaml을 part_definitions 테이블로 동기화(멱등).
# 사용: sh sync-parts.sh [yaml경로]   (생략 시 ~/agent-backbone/pipelines/part-definitions.yaml)
set -eu

COMPOSE_DIR="${COMPOSE_DIR:-$HOME/agent-backbone}"
YAML="${1:-$COMPOSE_DIR/pipelines/part-definitions.yaml}"
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

[ -f "$YAML" ] || { echo "FATAL: YAML 없음: $YAML"; exit 1; }
cd "$COMPOSE_DIR"
PG_USER=$(grep '^PG_USER=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
PG_DB=$(grep '^PG_DB=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')

# 1) 스키마(추가형, 재적용 안전)
sudo -n docker compose cp "$HERE/init-parts.sql" postgres:/tmp/init-parts.sql >/dev/null
sudo -n docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -q -v ON_ERROR_STOP=1 -f /tmp/init-parts.sql
sudo -n docker compose exec -T postgres rm -f /tmp/init-parts.sql

# 2) YAML → SQL → 적용
TMP=$(mktemp)
python3 "$HERE/load-parts.py" "$YAML" > "$TMP"
sudo -n docker compose cp "$TMP" postgres:/tmp/parts.sql >/dev/null
rm -f "$TMP"
sudo -n docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -q -v ON_ERROR_STOP=1 -f /tmp/parts.sql
sudo -n docker compose exec -T postgres rm -f /tmp/parts.sql

echo "--- 현재 파트 ---"
sudo -n docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -c \
  "SELECT part_key, name, active, jsonb_object_keys(config) AS section FROM part_definitions ORDER BY part_key, section" \
  2>/dev/null | head -30
