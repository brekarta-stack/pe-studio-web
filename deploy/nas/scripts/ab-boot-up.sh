#!/bin/sh
# ab-boot-up.sh — @reboot 방어선: docker+Tailscale IP 준비를 기다렸다가 백본 전체 기동.
# 배경(2026-07-24 재부팅 테스트 실측): TS IP(100.x)에 포트 바인딩하는 컨테이너는 부팅 시
#   tailscale 컨테이너보다 먼저 재기동이 시도되어 "cannot assign requested address"로 죽고,
#   dockerd는 재시도하지 않음. 1차 방어=sysctl ip_nonlocal_bind=1, 2차 방어=이 스크립트.
# 주의: 로그는 /var/log에 쓴다(/volume2는 부팅 초기에 미마운트 — cron 리다이렉트가 죽는 원인이었음).
COMPOSE_DIR="${1:?usage: ab-boot-up.sh <COMPOSE_DIR>}"
case "$COMPOSE_DIR" in /*) ;; *) echo "FATAL: absolute path required"; exit 1;; esac

log() { echo "[$(date '+%F %T')] $*"; }

# 1) docker 데몬 대기 (최대 300s)
i=0
until docker info >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -gt 60 ] && log "FATAL: docker not ready after 300s" && exit 1
  sleep 5
done
log "docker ready"

# 2) Tailscale IP 대기 (최대 120s — 못 기다려도 진행: nonlocal_bind가 커버)
TS_IP=$(grep "^NAS_TS_IP=" "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d " \r")
if [ -n "$TS_IP" ]; then
  j=0
  until ip -4 addr show 2>/dev/null | grep -q "$TS_IP"; do
    j=$((j+1)); [ "$j" -gt 24 ] && log "WARN: TS IP $TS_IP not up after 120s — proceeding (nonlocal_bind fallback)" && break
    sleep 5
  done
  [ "$j" -le 24 ] && log "TS IP $TS_IP present"
fi

# 3) compose up (3회 재시도)
#    ★ --profile trading 필수: 매매 엔진(trading-loop)이 profile에 속해 있어, 이걸 빼면
#      재부팅 후 되살아나지 않는다(감사에서 dry-run으로 적발 — 복구 계획에 아예 없었다).
cd "$COMPOSE_DIR" || exit 1
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
k=1
while [ "$k" -le 3 ]; do
  if $DC --profile trading up -d; then log "compose up OK (attempt $k, profile=trading 포함)"; exit 0; fi
  log "WARN: compose up failed (attempt $k)"; k=$((k+1)); sleep 10
done
log "FATAL: compose up failed after 3 attempts"
exit 1
