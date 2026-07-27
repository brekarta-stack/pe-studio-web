#!/bin/sh
# backup-daily.sh — 백본 일일 백업 (HANDOFF #4, 3-2-1의 로컬 파트)
#   pg_dump(DB+글로벌) + n8n 워크플로/크리덴셜(암호화 상태)+런타임설정 + Kuma 데이터 + .env/N8N_ENCRYPTION_KEY 사본
#   → $BACKUP_ROOT/daily/<timestamp>/ 저장, 무결성 검증, 14일 보존.
# 실행: root cron. 환경변수 COMPOSE_DIR, BACKUP_ROOT 필수.
# 제외(의도): n8ndata의 binaryData(파일시스템 모드 미사용 전제) — 사용 시작하면 tar 백업 추가할 것.
# 오프사이트(B2): $COMPOSE_DIR/restic.env(root:600)가 생기면 restic 훅 활성. RESTIC_PASSWORD는 NAS 밖에도 에스크로 필수.
# 종료코드: 0=성공(경고 허용), 1=치명 실패. heartbeat-backup.url 있으면 성공/실패 신호 전송.

set -u
umask 077   # 신규 파일 전부 600/700 (시크릿 포함 백업이므로)

COMPOSE_DIR="${COMPOSE_DIR:?COMPOSE_DIR required}"
BACKUP_ROOT="${BACKUP_ROOT:?BACKUP_ROOT required}"
KEEP_DAYS="${KEEP_DAYS:-14}"

case "$COMPOSE_DIR" in /*) ;; *) echo "FATAL: COMPOSE_DIR must be absolute"; exit 1;; esac
case "$BACKUP_ROOT" in /*) ;; *) echo "FATAL: BACKUP_ROOT must be absolute"; exit 1;; esac

HB_FILE="$COMPOSE_DIR/heartbeat-backup.url"
CURL_OPTS="-fsS -m 10 --retry 2 --retry-connrefused -o /dev/null"
hb_ping() { # $1 = "" | "/fail"
  [ -s "$HB_FILE" ] || return 0
  HB=$(head -n1 "$HB_FILE" | tr -d ' \r\n')
  [ -n "$HB" ] && curl $CURL_OPTS "$HB$1" 2>/dev/null
}
log() { echo "[$(date '+%F %T')] $*"; }
die() { log "FATAL: $*"; hb_ping /fail || true; exit 1; }

[ -f "$COMPOSE_DIR/docker-compose.yml" ] || die "no docker-compose.yml in $COMPOSE_DIR"
[ -f "$COMPOSE_DIR/.env" ] || die "no .env in $COMPOSE_DIR"
# 볼륨 언마운트 방어: daily/는 install-cron이 만들어 둠. 없으면 볼륨이 안 붙은 것 — rootfs에 쓰지 말고 중단.
[ -d "$BACKUP_ROOT/daily" ] || die "$BACKUP_ROOT/daily missing (backup volume unmounted?)"

TS=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_ROOT/daily/$TS"
mkdir "$DEST" || die "cannot create $DEST"

cd "$COMPOSE_DIR" || die "cd failed"
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
  log "WARN: docker compose v2 없음 — v1 폴백(가능하면 v2 설치 권장)"
else
  die "docker compose not found"
fi

# .env 파싱(소스 금지 — 임의 코드 실행 방지). 중복 키는 compose와 동일하게 마지막 값, CRLF 제거.
envval() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '\r'; }
PG_USER=$(envval PG_USER)
PG_DB=$(envval PG_DB)
[ -n "$PG_USER" ] && [ -n "$PG_DB" ] || die "PG_USER/PG_DB not in .env"

FAIL=0
WARN=0

# ── 1. Postgres 덤프 (2단계 — 파이프라인이 pg_dump 실패를 숨기는 것 방지) ──
#    --create: 덤프에 CREATE DATABASE 포함 → 복원이 "psql -U postgres < dump" 한 방(DB 사전 생성 불필요)
if $DC exec -T postgres pg_dump --create -U "$PG_USER" -d "$PG_DB" > "$DEST/pg_${PG_DB}.sql" \
   && gzip "$DEST/pg_${PG_DB}.sql"; then
  log "pg_dump OK"
else
  log "FATAL: pg_dump failed"; FAIL=1; rm -f "$DEST/pg_${PG_DB}.sql"
fi

if $DC exec -T postgres pg_dumpall --globals-only -U "$PG_USER" > "$DEST/pg_globals.sql" \
   && gzip "$DEST/pg_globals.sql"; then
  log "pg_dumpall globals OK"
else
  log "WARN: pg_dumpall globals failed"; WARN=1; rm -f "$DEST/pg_globals.sql"
fi

# ── 2. 덤프 무결성 검증 (완료 마커까지 확인 — 잘린 덤프 방지) ──
if [ "$FAIL" -eq 0 ]; then
  if gzip -t "$DEST/pg_${PG_DB}.sql.gz" \
     && gzip -dc "$DEST/pg_${PG_DB}.sql.gz" | tail -n 20 | grep -q "PostgreSQL database dump complete"; then
    log "pg dump integrity OK"
  else
    log "FATAL: pg dump integrity check failed"; FAIL=1
  fi
fi

# ── 3. n8n export — compose cp 미사용(v1 비호환) → exec cat 스트리밍 ──
#    빈 인스턴스면 export 실패 가능 → 경고(치명 아님).
CRED_OK=0; RUNTIME_OK=0
$DC exec -T n8n mkdir -p /tmp/n8n-backup 2>/dev/null
if $DC exec -T n8n n8n export:workflow --all --output=/tmp/n8n-backup/workflows.json >/dev/null 2>&1 \
   && $DC exec -T n8n cat /tmp/n8n-backup/workflows.json > "$DEST/n8n_workflows.json" 2>/dev/null \
   && [ -s "$DEST/n8n_workflows.json" ]; then
  log "n8n workflows export OK"
else
  rm -f "$DEST/n8n_workflows.json"
  log "WARN: n8n workflow export failed (빈 인스턴스면 정상)"; WARN=1
fi
if $DC exec -T n8n n8n export:credentials --all --output=/tmp/n8n-backup/credentials.json >/dev/null 2>&1 \
   && $DC exec -T n8n cat /tmp/n8n-backup/credentials.json > "$DEST/n8n_credentials.enc.json" 2>/dev/null \
   && [ -s "$DEST/n8n_credentials.enc.json" ]; then
  log "n8n credentials export OK (encrypted)"; CRED_OK=1
else
  rm -f "$DEST/n8n_credentials.enc.json"
  log "WARN: n8n credentials export failed (빈 인스턴스면 정상)"; WARN=1
fi
# 런타임 설정 스냅샷(.env 키 누락 시에도 실제 사용 중 encryptionKey가 여기 있음)
if $DC exec -T n8n cat /home/node/.n8n/config > "$DEST/n8n_runtime_config.json" 2>/dev/null \
   && [ -s "$DEST/n8n_runtime_config.json" ]; then
  log "n8n runtime config snapshot OK"; RUNTIME_OK=1
else
  rm -f "$DEST/n8n_runtime_config.json"
  log "WARN: n8n runtime config snapshot failed"; WARN=1
fi
$DC exec -T n8n rm -rf /tmp/n8n-backup 2>/dev/null

# ── 3-b. 배포 설정 일체(레포 대응물 + NAS에만 있는 SSOT) ──
#    pg 덤프에는 part_definitions의 "값"만 들어간다. 사람이 편집하는 YAML(주석·미정표시·defaults 구분)과
#    compose·litellm 설정·워크플로 JSON·매매 코드는 여기서만 백업된다.
if tar czf "$DEST/compose_config.tar.gz" -C "$COMPOSE_DIR" \
     --exclude='.env' --exclude='*.tmp' --exclude='._*' --exclude='__pycache__' \
     pipelines n8n-workflows trading docker-compose.yml litellm-config.yaml init-db.sql 2>/dev/null \
   && [ -s "$DEST/compose_config.tar.gz" ]; then
  log "compose/config archive OK"
else
  rm -f "$DEST/compose_config.tar.gz"
  log "WARN: compose/config archive failed"; WARN=1
fi

# ── 4. Kuma 데이터(모니터·알림 설정 SQLite) ──
if $DC exec -T uptime-kuma tar czf - -C /app data > "$DEST/kuma_data.tar.gz" 2>/dev/null \
   && [ -s "$DEST/kuma_data.tar.gz" ] && gzip -t "$DEST/kuma_data.tar.gz" 2>/dev/null; then
  log "kuma data backup OK"
else
  rm -f "$DEST/kuma_data.tar.gz"
  log "WARN: kuma data backup failed"; WARN=1
fi

# ── 5. .env 사본 + N8N_ENCRYPTION_KEY 사본 (키 없으면 크리덴셜 복호화 불가 = 복원 불가) ──
if cp .env "$DEST/env.backup"; then
  log "env backup OK"
else
  log "FATAL: env backup failed"; FAIL=1
fi
NK=$(envval N8N_ENCRYPTION_KEY)
if [ -n "$NK" ]; then
  printf '%s\n' "$NK" > "$DEST/n8n_encryption_key.txt"
  log "encryption key copy OK"
elif [ "$CRED_OK" -eq 1 ] && [ "$RUNTIME_OK" -eq 0 ]; then
  # 크리덴셜은 백업됐는데 해독 키가 어디에도 없음 → 이 백업은 복원 불가. 성공으로 위장 금지.
  log "FATAL: credentials exported but N8N_ENCRYPTION_KEY unavailable (.env에도 runtime config에도 없음)"; FAIL=1
else
  log "WARN: N8N_ENCRYPTION_KEY not in .env (runtime config 스냅샷에 의존)"; WARN=1
fi

# ── 6. 매니페스트 ──
( cd "$DEST" && sha256sum * > SHA256SUMS 2>/dev/null )
du -sh "$DEST" | while read -r sz _; do log "backup size: $sz"; done

# ── 7. 보존정책 — 실패한 날엔 삭제 금지(연속 실패가 정상 백업을 전멸시키는 것 방지) ──
if [ "$FAIL" -eq 0 ]; then
  find "$BACKUP_ROOT/daily" -maxdepth 1 -type d \
    -name '20[0-9][0-9][01][0-9][0-3][0-9]_*' -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null
  log "retention pruned (>${KEEP_DAYS}d)"
else
  log "retention skipped (backup failed)"
fi

# ── 8. 오프사이트(B2) 훅 — restic.env는 root 소유·600일 때만 신뢰(권한상승 방지) ──
RESTIC_ENV="$COMPOSE_DIR/restic.env"
if [ -f "$RESTIC_ENV" ] && command -v restic >/dev/null 2>&1; then
  if [ "$(stat -c %u "$RESTIC_ENV" 2>/dev/null)" = "0" ] && [ "$(stat -c %a "$RESTIC_ENV" 2>/dev/null)" = "600" ]; then
    if ( set -a; . "$RESTIC_ENV"; set +a; restic backup "$DEST" --tag daily >/dev/null 2>&1 ); then
      log "restic offsite OK"
    else
      log "WARN: restic offsite failed"; WARN=1
    fi
  else
    log "WARN: restic.env는 root 소유 + chmod 600이어야 함 — 건너뜀"; WARN=1
  fi
fi

# ── 9. 하트비트 ──
if [ "$FAIL" -ne 0 ]; then
  hb_ping /fail || true
  log "RESULT: FAILED"; exit 1
fi
hb_ping "" || log "WARN: heartbeat ping failed"
if [ "$WARN" -ne 0 ]; then log "RESULT: OK (with warnings)"; else log "RESULT: OK"; fi
exit 0
