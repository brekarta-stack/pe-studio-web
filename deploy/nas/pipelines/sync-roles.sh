#!/bin/sh
# sync-roles.sh — n8n이 쓰는 제한 롤 2종에 LOGIN+비밀번호를 부여한다(멱등).
#
# 왜 별도 스크립트인가: 이전엔 이 부여가 **수동 1회 실행**이라 레포 어디에도 기록이 없었다
# (감사 지적). 백업에서 복원한 뒤 스키마만 재적용하면 NOLOGIN·무암호 롤이 생겨
# n8n 크레덴셜이 붙지 못한다. 이제 복원 절차에 이 한 줄이 들어간다.
#
# 비밀번호는 .env에서 읽고, 없으면 생성해 .env에 적는다. 값은 절대 출력하지 않는다.
# 사용: sh sync-roles.sh
set -eu
umask 077

COMPOSE_DIR="${COMPOSE_DIR:-$HOME/agent-backbone}"
cd "$COMPOSE_DIR"
PG_USER=$(grep '^PG_USER=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
PG_DB=$(grep '^PG_DB=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
[ -n "$PG_USER" ] && [ -n "$PG_DB" ] || { echo "FATAL: .env의 PG_USER/PG_DB가 비었다"; exit 1; }

cleanup() { sudo -n docker compose exec -T postgres rm -f /tmp/roles.sql 2>/dev/null || true; }
trap cleanup EXIT

TMP=$(mktemp); chmod 600 "$TMP"
for PAIR in "trade_analyst:TRADE_ANALYST_PASSWORD" "pipeline_runner:PIPELINE_RUNNER_PASSWORD"; do
  ROLE=${PAIR%%:*}; VAR=${PAIR##*:}
  grep -q "^$VAR=" .env || printf '%s=%s\n' "$VAR" "$(openssl rand -hex 24)" >> .env
  PW=$(grep "^$VAR=" .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
  [ -n "$PW" ] || { echo "FATAL: $VAR 가 비었다"; exit 1; }
  # 롤이 없으면 만든다(스키마 스크립트가 먼저 돌지 않은 경우 대비)
  printf "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='%s') THEN CREATE ROLE %s NOLOGIN; END IF; END \$\$;\n" "$ROLE" "$ROLE" >> "$TMP"
  printf "ALTER ROLE %s LOGIN PASSWORD '%s';\n" "$ROLE" "$PW" >> "$TMP"
done
chmod 600 .env

sudo -n docker compose cp "$TMP" postgres:/tmp/roles.sql >/dev/null
rm -f "$TMP"
sudo -n docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -q -v ON_ERROR_STOP=1 -f /tmp/roles.sql

sudo -n docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -c \
  "SELECT rolname, rolcanlogin AS login, rolsuper AS superuser FROM pg_roles WHERE rolname IN ('trade_analyst','pipeline_runner') ORDER BY rolname"
echo "완료 — n8n 크레덴셜의 비밀번호와 일치해야 한다. 어긋나면 크레덴셜을 다시 import할 것."
