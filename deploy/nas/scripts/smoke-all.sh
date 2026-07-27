#!/bin/sh
# smoke-all.sh — 전체 시스템 통합 스모크. 변경 후·재부팅 후·의심스러울 때 이것 하나만 돌린다.
# 읽기 전용에 가깝다(워크플로 실행은 멱등 가드가 있어 부작용이 제한적).
# 사용: COMPOSE_DIR=~/agent-backbone sh smoke-all.sh
set -u
COMPOSE_DIR="${COMPOSE_DIR:-$HOME/agent-backbone}"
cd "$COMPOSE_DIR" || exit 1
PU=$(grep '^PG_USER=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
PD=$(grep '^PG_DB=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
K=$(grep '^LITELLM_MASTER_KEY=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
TS=$(grep '^NAS_TS_IP=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
FAIL=0
ok()  { echo "  [OK ] $1"; }
bad() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
psql() { sudo -n docker compose exec -T postgres psql -U "$PU" -d "$PD" -tAc "$1" 2>/dev/null; }

echo "== 1. 컨테이너 =="
for C in postgres n8n litellm uptime-kuma; do
  S=$(sudo -n docker inspect -f '{{.State.Status}}' "agent-backbone-$C-1" 2>/dev/null)
  [ "$S" = "running" ] && ok "$C running" || bad "$C = ${S:-없음}"
done
TL=$(sudo -n docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' agent-backbone-trading-loop-1 2>/dev/null)
case "$TL" in running/healthy) ok "trading-loop $TL" ;; running/*) bad "trading-loop $TL (멈춤 상태 — status.json 확인)" ;; *) bad "trading-loop ${TL:-없음}" ;; esac

echo "== 2. 모델 라우팅 =="
R=$(curl -s -m 60 "http://$TS:4000/v1/chat/completions" -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
    -d '{"model":"classify-fast","messages":[{"role":"user","content":"한 단어로: 하늘색"}],"stream":false,"max_tokens":20}' \
    | python3 -c 'import json,sys;print((json.load(sys.stdin)["choices"][0]["message"]["content"] or "").strip()[:20])' 2>/dev/null)
[ -n "$R" ] && ok "classify-fast(로컬) → $R" || bad "classify-fast 응답 없음"
R2=$(curl -s -m 120 "http://$TS:4000/v1/chat/completions" -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
    -d '{"model":"write-ko-draft","messages":[{"role":"user","content":"세 단어로 인사"}],"stream":false,"max_tokens":100}' \
    | python3 -c 'import json,sys;print((json.load(sys.stdin)["choices"][0]["message"]["content"] or "").strip()[:20])' 2>/dev/null)
[ -n "$R2" ] && ok "write-ko-draft(추론형+think:false) → $R2" || bad "write-ko-draft 빈 응답 — think:false 확인"

echo "== 3. 스키마 =="
for T in leads trade_proposals trade_orders idempotency_keys archive part_definitions learning_items; do
  C=$(psql "SELECT to_regclass('public.$T') IS NOT NULL")
  [ "$C" = "t" ] && ok "$T" || bad "$T 없음"
done
V=$(psql "SELECT count(*) FROM pg_extension WHERE extname='vector'")
[ "$V" = "1" ] && ok "pgvector" || bad "pgvector 없음"

echo "== 4. 권한 경계 =="
PW=$(grep '^PIPELINE_RUNNER_PASSWORD=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
AW=$(grep '^TRADE_ANALYST_PASSWORD=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
deny() { # $1=롤 $2=비번 $3=SQL $4=라벨
  O=$(sudo -n docker compose exec -T -e PGPASSWORD="$2" postgres psql -h localhost -U "$1" -d "$PD" -tAc "$3" 2>&1 | head -1)
  case "$O" in *ERROR*|*denied*|*violates*) ok "$4 차단됨" ;; *) bad "$4 가 통과했다 (응답: $O)" ;; esac
}
deny pipeline_runner "$PW" "SELECT count(*) FROM trade_orders" "pipeline_runner → 매매 주문"
deny pipeline_runner "$PW" "INSERT INTO idempotency_keys (key,kind,status) VALUES ('trade:smoke-hack','publish','pending')" "pipeline_runner → trade 네임스페이스 키"
deny trade_analyst  "$AW" "SELECT count(*) FROM trade_orders" "trade_analyst → 매매 주문"

echo "== 5. 매매 건전성 =="
U=$(psql "SELECT count(*) FROM trade_orders WHERE needs_reconcile AND reconciled_at IS NULL")
[ "${U:-1}" = "0" ] && ok "대사 미완 0(엔진 정상 가동)" || bad "대사 미완 ${U}건 — 엔진이 HALT 상태다"
[ -f /data/KILL ] 2>/dev/null || true
KS=$(sudo -n docker exec agent-backbone-trading-loop-1 sh -c 'test -f /data/KILL && echo ON || echo OFF' 2>/dev/null)
[ "$KS" = "OFF" ] && ok "킬스위치 OFF" || bad "킬스위치 $KS (의도한 것인가?)"

echo "== 6. 백업 =="
LAST=$(sudo -n sh -c 'ls -1d /volume3/backup/agent-backbone/daily/*/ 2>/dev/null | tail -1')
if [ -n "$LAST" ]; then
  AGE=$(( ( $(date +%s) - $(sudo -n stat -c %Y "$LAST") ) / 3600 ))
  [ "$AGE" -le 30 ] && ok "최신 백업 ${AGE}시간 전" || bad "최신 백업이 ${AGE}시간 전 — cron 확인"
  sudo -n test -f "$LAST/compose_config.tar.gz" && ok "설정 아카이브 포함" || bad "설정 아카이브 누락"
  sudo -n test -s "$LAST/n8n_encryption_key.txt" && ok "암호화 키 사본 존재" || bad "암호화 키 사본 없음 — 크레덴셜 복구 불가"
else
  bad "백업 없음"
fi

echo "== 7. 관제 =="
MON=$(sudo -n docker exec agent-backbone-uptime-kuma-1 sqlite3 /app/data/kuma.db \
      "SELECT m.name || '=' || h.status FROM heartbeat h JOIN monitor m ON m.id=h.monitor_id WHERE h.id IN (SELECT MAX(id) FROM heartbeat GROUP BY monitor_id)" 2>/dev/null)
echo "$MON" | while IFS= read -r L; do
  case "$L" in *=1) echo "  [OK ] $L (up)" ;; *=0) echo "  [FAIL] $L (down)" ;; *) [ -n "$L" ] && echo "  [?  ] $L" ;; esac
done
echo "$MON" | grep -q '=0' && FAIL=$((FAIL+1))
[ -s "$COMPOSE_DIR/heartbeat.url" ] && ok "외부 하트비트 설정됨" || echo "  [WARN] 외부 하트비트 미설정 — NAS 자체 다운을 아무도 모른다"

# 알림 경로 — "빨간불이 떠도 아무도 안 부르는" 상태를 막는다.
# Slack은 실패해도 HTTP 200을 주고 Kuma는 그걸 성공으로 보므로, Kuma 로그만으로는 절대 못 잡는다.
NT=$(sudo -n docker exec agent-backbone-uptime-kuma-1 sqlite3 /app/data/kuma.db \
     "SELECT count(*) FROM monitor m WHERE NOT EXISTS (SELECT 1 FROM monitor_notification mn
        JOIN notification n ON n.id=mn.notification_id AND n.active=1 WHERE mn.monitor_id=m.id)" 2>/dev/null)
[ "${NT:-9}" = "0" ] && ok "모든 모니터에 알림 연결됨" || bad "알림 없는 모니터 ${NT}개 — 장애가 나도 조용하다"
sudo -n docker exec agent-backbone-uptime-kuma-1 sqlite3 /app/data/kuma.db \
  "SELECT json_extract(config,'\$.webhookAdditionalHeaders') FROM notification WHERE active=1" 2>/dev/null \
  | grep -qi 'content-type' \
  && ok "알림 Content-Type 헤더 존재" \
  || bad "알림에 Content-Type 없음 — Slack이 거부하는데 Kuma는 성공으로 보고한다(조용한 실패)"
SB=$(grep '^SLACK_BOT_TOKEN=' "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d ' \r')
if [ -n "$SB" ]; then
  curl -s -m 10 -H "Authorization: Bearer $SB" https://slack.com/api/auth.test | grep -q '"ok":true' \
    && ok "Slack 봇 토큰 유효" || bad "Slack 봇 토큰 무효/만료 — 알림이 전부 조용히 버려진다"
else
  echo "  [WARN] SLACK_BOT_TOKEN 없음 — 알림 경로 검증 불가"
fi
[ -f "$COMPOSE_DIR/restic.env" ] && ok "오프사이트 설정됨" || echo "  [WARN] 오프사이트 미설정 — 로컬 사본뿐"

echo
[ "$FAIL" -eq 0 ] && { echo "== 통합 스모크 통과 =="; exit 0; }
echo "== 통합 스모크 실패 ${FAIL}건 =="
exit 1
