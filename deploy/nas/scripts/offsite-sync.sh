#!/bin/sh
# offsite-sync.sh — 3-2-1 백업의 마지막 한 칸(다른 장소 사본)을 Google Drive로 채운다.
#
# 설계 판단 3가지와 그 이유:
#
# 1) **restic이 아니라 rclone crypt.**
#    전체 백업이 19MB뿐이라 중복제거(restic의 주 이점)의 값어치가 없다.
#    바이너리 하나로 끝나고, 복구 절차가 "rclone copy 후 그대로 사용"이라 단순하다.
#
# 2) **`copy`이지 `sync`가 아니다 — 이게 이 스크립트의 핵심이다.**
#    `sync`는 로컬에 없는 원격 파일을 지운다. 즉 NAS가 랜섬웨어로 암호화·삭제되면
#    그 삭제가 오프사이트까지 그대로 전파된다. 오프사이트를 두는 이유가 사라진다.
#    그래서 추가 전용(`copy`)으로 올리고, 오래된 것만 별도로 정리한다(아래 3).
#
# 3) **오프사이트 보존기간(60일) > 로컬(14일).**
#    "며칠 전부터 망가져 있었는지" 뒤늦게 알아채는 경우가 실제로 있다(오늘만 해도
#    아침 브리핑이 18일간 죽어 있었다). 로컬 14일로는 그 시점 이전으로 못 돌아간다.
#
# ⚠️ **암호 분실 = 오프사이트 전량 소실.** crypt 비밀번호는 `.env`에 있고 `.env`는
#    로컬 백업에만 들어 있다. NAS가 통째로 날아가면 둘 다 없다.
#    → 반드시 비밀번호 관리자 등 **NAS 밖**에 따로 보관할 것. 스크립트가 매번 경고한다.
#
# 사용: sh offsite-sync.sh            (일일 cron)
#       sh offsite-sync.sh --verify   (원격 목록·복호화 왕복 확인만)
set -u

COMPOSE_DIR="${COMPOSE_DIR:-$HOME/agent-backbone}"
SRC="${OFFSITE_SRC:-/volume3/backup/agent-backbone/daily}"
REMOTE="${OFFSITE_REMOTE:-gcrypt:daily}"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-60}"
LOG="$COMPOSE_DIR/logs/offsite-sync.log"
RCLONE_CONF="${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"

mkdir -p "$(dirname "$LOG")"
log() { printf '%s %s\n' "$(date '+%F %T')" "$1" | tee -a "$LOG"; }

command -v rclone >/dev/null 2>&1 || { log "FATAL: rclone 없음"; exit 1; }
[ -f "$RCLONE_CONF" ] || { log "FATAL: rclone 설정 없음($RCLONE_CONF) — 인증 먼저"; exit 1; }
[ -d "$SRC" ] || { log "FATAL: 백업 원본 없음($SRC)"; exit 1; }

if [ "${1:-}" = "--verify" ]; then
  log "== 검증 모드 =="
  rclone lsd "$REMOTE" 2>&1 | tail -5 | sed 's/^/  /'
  N=$(rclone size "$REMOTE" --json 2>/dev/null | sed 's/.*"count":\([0-9]*\).*/\1/')
  log "원격 파일 수: ${N:-조회실패}"
  # 복호화가 실제로 되는지: 원격에서 SHA256SUMS 하나를 받아 읽어본다.
  T=$(mktemp -d)
  LAST=$(rclone lsf "$REMOTE" --dirs-only 2>/dev/null | sort | tail -1)
  if [ -n "$LAST" ] && rclone copy "$REMOTE/${LAST}SHA256SUMS" "$T" 2>/dev/null && [ -s "$T/SHA256SUMS" ]; then
    log "복호화 왕복 OK — $LAST 의 SHA256SUMS $(wc -l < "$T/SHA256SUMS")줄 읽힘"
  else
    log "FAIL: 복호화 왕복 실패 — 암호가 틀렸거나 업로드가 비어 있다"
    rm -rf "$T"; exit 1
  fi
  rm -rf "$T"
  exit 0
fi

log "== 오프사이트 업로드 시작(추가 전용) =="
# --immutable: 이미 올라간 파일이 로컬에서 바뀌었으면 덮어쓰지 않고 에러를 낸다.
#   백업 산출물은 원래 불변이므로, 바뀌었다면 그건 사고다 — 조용히 덮어쓰면 안 된다.
if rclone copy "$SRC" "$REMOTE" \
      --immutable --transfers 4 --checkers 8 \
      --stats-one-line --stats 30s 2>&1 | sed 's/^/  /' | tee -a "$LOG"; then
  log "업로드 OK"
else
  log "FAIL: 업로드 실패"
  exit 1
fi

# 오래된 원격 파일 정리. **업로드가 성공한 경우에만** 돈다(실패 후 정리는 자해다).
log "== ${KEEP_DAYS}일 초과 원격 정리 =="
rclone delete "$REMOTE" --min-age "${KEEP_DAYS}d" 2>&1 | sed 's/^/  /' | tee -a "$LOG"
rclone rmdirs "$REMOTE" --leave-root 2>/dev/null

SZ=$(rclone size "$REMOTE" 2>/dev/null | tr '\n' ' ')
log "원격 현황: $SZ"
log "⚠️ crypt 비밀번호는 NAS 밖(비밀번호 관리자)에도 보관할 것 — 분실 시 복구 불가"
log "== 완료 =="
