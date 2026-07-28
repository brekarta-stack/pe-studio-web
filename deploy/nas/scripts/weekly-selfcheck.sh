#!/bin/sh
# weekly-selfcheck.sh — 신 아키텍처용 주간 자가점검 (미니 agent-review/audit/qc-eval의 축소 이식)
#
# 왜 이식하나: 미니의 자기점검 루프가 "24채널 중 21개 전략부재"를 스스로 진단해낸 검증된 자산이다
# (설계 §I 재활용 목록). Kuma는 인프라만 보고 "시스템이 과확장됐는지·조용히 멈췄는지"는 못 본다.
# 원칙 유지: **읽기전용, 제안만, 실행 없음.** 삭제·구조변경은 사람이 한다.
#
# 실행: cron 주 1회(월 09:00). 리포트를 파일로 남기고 **Slack #sysops로 요약을 보낸다.**
# 사용: COMPOSE_DIR=... sh weekly-selfcheck.sh [--no-llm] [--dry-run]
#
# ⚠️ 2026-07-28 수정: 원래는 `selfcheck-webhook.url` 파일이 있을 때만 보냈는데,
#    그 파일이 애초에 없어서 **리포트를 아무도 안 읽고 쌓기만 했다.**
#    같은 날 morning-brief(죽은 채널로 18일 발송)·Kuma 알림(채널 0개)에서 본 것과 같은 부류다:
#    "만들었다"와 "도착한다"는 다르다. 그래서 이제 봇 토큰으로 직접 보내고,
#    Slack이 HTTP 200에 실어 보내는 `ok:false`까지 확인해 실패를 로그에 남긴다.
set -u
umask 077

COMPOSE_DIR="${COMPOSE_DIR:-$HOME/agent-backbone}"
REPORT_DIR="${REPORT_DIR:-/volume3/backup/agent-backbone/selfcheck}"
NO_LLM=""; DRY=""
for a in "$@"; do
  case "$a" in
    --no-llm) NO_LLM=1 ;;
    --dry-run) DRY=1 ;;
  esac
done
SLACK_CHANNEL="${SELFCHECK_SLACK_CHANNEL:-C0B6QEAKEAF}"   # #sysops-시스템관리. **이름이 아니라 ID** — 이름은 바뀐다

cd "$COMPOSE_DIR" || exit 1
mkdir -p "$REPORT_DIR"
TS=$(date +%Y%m%d_%H%M)
OUT="$REPORT_DIR/selfcheck_$TS.md"

PU=$(grep '^PG_USER=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
PD=$(grep '^PG_DB=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
psql() { sudo -n docker compose exec -T postgres psql -U "$PU" -d "$PD" -tAc "$1" 2>/dev/null; }

{
echo "# 주간 자가점검 — $(date '+%Y-%m-%d %H:%M %Z')"
echo
echo "> 읽기전용 진단이다. 여기서 무엇도 자동으로 고치지 않는다."

echo
echo "## 1. 컨테이너"
sudo -n docker ps -a --format '{{.Names}}|{{.Status}}' 2>/dev/null | while IFS='|' read -r n s; do
  case "$n" in agent-backbone-*|restic-rest|tailgate-*) echo "- \`$n\` — $s" ;; esac
done
RESTARTS=$(sudo -n docker ps -q 2>/dev/null | xargs -r sudo -n docker inspect -f '{{.Name}} {{.RestartCount}}' 2>/dev/null | awk '$2>0 {print "- " $1 " 재시작 " $2 "회"}')
[ -n "$RESTARTS" ] && { echo; echo "⚠️ 재시작 이력:"; echo "$RESTARTS"; }

echo
echo "## 2. 디스크 (무한 증가 감시)"
df -h /volume1 /volume2 /volume3 2>/dev/null | awk 'NR>1 {print "- " $6 " " $5 " 사용 (" $4 " 여유)"}'
echo "- docker 전체: $(sudo -n docker system df --format '{{.Type}} {{.Size}}' 2>/dev/null | tr '\n' ' ')"

echo
echo "## 3. 백업"
LAST=$(sudo -n sh -c "ls -1d $REPORT_DIR/../daily/*/ 2>/dev/null | tail -1")
if [ -n "$LAST" ]; then
  AGE_H=$(( ( $(date +%s) - $(sudo -n stat -c %Y "$LAST" 2>/dev/null || echo 0) ) / 3600 ))
  echo "- 최신: $(basename "$LAST") (${AGE_H}시간 전, $(sudo -n du -sh "$LAST" 2>/dev/null | cut -f1))"
  [ "$AGE_H" -gt 30 ] && echo "  ⚠️ **30시간 넘게 백업이 없다 — cron 확인 필요**"
  sudo -n test -f "$LAST/compose_config.tar.gz" || echo "  ⚠️ 설정 아카이브 누락"
else
  echo "- ⚠️ **백업 없음**"
fi
echo "- 보관 개수: $(sudo -n sh -c "ls -1d $REPORT_DIR/../daily/*/ 2>/dev/null | wc -l")"
OFF_N=$(sudo -n rclone size gcrypt: --json 2>/dev/null | sed 's/.*"count":\([0-9]*\).*/\1/')
if [ -n "${OFF_N:-}" ] && [ "${OFF_N:-0}" -gt 0 ] 2>/dev/null; then
  echo "- 오프사이트(Google Drive, 암호화): ${OFF_N}개 파일 · 최신 $(sudo -n rclone lsf gcrypt:daily --dirs-only 2>/dev/null | sort | tail -1)"
else
  echo "- ⚠️ **오프사이트가 비었거나 조회 실패 — 3-2-1이 아니라 로컬 사본뿐이다**"
fi

echo
echo "## 4. 데이터 규모"
for T in leads trade_proposals trade_orders idempotency_keys archive part_definitions expressions; do
  C=$(psql "SELECT count(*) FROM $T")
  echo "- $T: ${C:-?}"
done

echo
echo "## 5. 매매 건전성"
echo "- 대사 미완(엔진 정지 유발): $(psql "SELECT count(*) FROM trade_orders WHERE needs_reconcile AND reconciled_at IS NULL")"
echo "- 비종결 주문: $(psql "SELECT count(*) FROM trade_orders WHERE state IN ('VALIDATED','SUBMITTED')")"
echo "- pending 멱등키(크래시 잔재 후보): $(psql "SELECT count(*) FROM idempotency_keys WHERE kind='trade' AND status='pending'")"
echo "- 최근 7일 거절 사유 상위:"
psql "SELECT '  - ' || COALESCE(split_part(reject_reason,':',1),'?') || ' × ' || count(*) FROM trade_orders WHERE state='REJECTED' AND created_at > now() - interval '7 days' GROUP BY 1 ORDER BY count(*) DESC LIMIT 5"
echo "- 오늘 체결 명목가: $(psql "SELECT COALESCE(SUM(filled_qty*COALESCE(avg_price,0)),0)::bigint FROM trade_orders WHERE state='FILLED' AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date")원"

echo
echo "## 6. 파이프라인"
echo "- 활성 파트: $(psql "SELECT COALESCE(string_agg(part_key,', '),'(없음)') FROM part_definitions WHERE active")"
echo "- 비활성 파트: $(psql "SELECT COALESCE(string_agg(part_key,', '),'(없음)') FROM part_definitions WHERE NOT active")"
echo "- 최근 7일 신규 리드: $(psql "SELECT count(*) FROM leads WHERE created_at > now() - interval '7 days'")"
echo "- n8n 워크플로(활성/전체): $(psql "SELECT count(*) FILTER (WHERE active) || ' / ' || count(*) FROM workflow_entity")"
echo "- 최근 7일 실패 실행: $(psql "SELECT count(*) FROM execution_entity WHERE status='error' AND \"startedAt\" > now() - interval '7 days'")"

echo
echo "## 7. 모델 사용·비용 (LiteLLM)"
psql "SELECT '- ' || model || ': ' || count(*) || '회, \$' || round(sum(spend)::numeric,4) FROM \"LiteLLM_SpendLogs\" WHERE \"startTime\" > now() - interval '7 days' GROUP BY model ORDER BY sum(spend) DESC LIMIT 10" 2>/dev/null || echo "- (spend 로그 없음)"

echo
echo "## 7-1. 분기 목표 대비 실적"
# 2026-07-28 게이트 통과로 part_definitions.config->'goals'에 숫자가 들어왔다.
# 미니 자기점검은 "목표"라는 기준 자체가 없어(goals 배열이 비어 있었다) 이걸 못 봤다.
psql "SELECT '- ' || p.part_key || ' 리드: 최근 30일 ' || (SELECT count(*) FROM leads l WHERE l.business=p.part_key AND l.created_at > now() - interval '30 days') || '건 / 목표 ' || COALESCE(p.config->'goals'->>'leads_per_month', p.config->'goals'->>'notices_per_week' || '(주)', p.config->'goals'->>'inquiries_per_month', '미설정') FROM part_definitions p WHERE p.active ORDER BY p.part_key" 2>/dev/null || echo "- (목표 조회 실패)"
echo "- 판단 기준: 목표의 절반에 못 미치면 수집 소스·키워드가 틀렸을 가능성이 크다(모델 문제 아님)."

echo
echo "## 8. 과확장 점검 (미니 자기점검이 잡아냈던 종류)"
INACTIVE_WF=$(psql "SELECT count(*) FROM workflow_entity WHERE NOT active")
EMPTY_PARTS=$(psql "SELECT count(*) FROM part_definitions WHERE NOT active")
NOLEAD_PARTS=$(psql "SELECT count(*) FROM part_definitions p WHERE p.active AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.business = p.part_key AND l.created_at > now() - interval '30 days')")
echo "- 비활성 워크플로 $INACTIVE_WF개 — 만들어만 두고 안 켠 것이 쌓이고 있지 않은가?"
echo "- 비활성 파트 $EMPTY_PARTS개 — 게이트 대기인가, 방치인가?"
echo "- 활성인데 30일간 리드 0인 파트: $NOLEAD_PARTS개 — 켜둘 이유가 있는가?"

echo
echo "## 9. 사람이 판단할 것"
[ "$INACTIVE_WF" -gt 5 ] && echo "- 비활성 워크플로가 $INACTIVE_WF개다. placeholder를 실물로 바꾸거나 지울 시점."
[ -f "$COMPOSE_DIR/heartbeat.url" ] || echo "- 외부 하트비트 미설정 — NAS 자체가 죽으면 아무도 모른다."
sudo -n test -f /root/.config/rclone/rclone.conf || echo "- 오프사이트 백업 미설정 — NAS 전손 시 전부 소실."
echo "- 오프사이트 원격: $(sudo -n rclone size gcrypt: 2>/dev/null | tr '\n' ' ' || echo '조회 실패')"
echo "- ⚠️ rclone 공유 client_id는 2026년 중 폐지 예정이다. 어느 날 갑자기 업로드가 멈추면 이것부터 의심할 것(자체 client_id 발급으로 해결)."
echo "- (이 항목들은 제안일 뿐이다. 실행하지 않는다.)"
} > "$OUT" 2>&1

# ── LLM 한 줄 총평(로컬 모델, 무료). 실패해도 리포트는 이미 완성돼 있다 ──
if [ -z "$NO_LLM" ]; then
  K=$(grep '^LITELLM_MASTER_KEY=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
  TS_IP=$(grep '^NAS_TS_IP=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
  BODY=$(python3 - "$OUT" <<'PYEOF'
import json, sys
body = open(sys.argv[1], encoding="utf-8").read()[:6000]
print(json.dumps({"model": "summarize", "stream": False, "max_tokens": 400, "messages": [
    {"role": "system", "content": "너는 1인 자동화 시스템의 점검자다. 아래 지표에서 **지금 사람이 손대야 할 것 3가지**만 우선순위대로 한국어로 짚어라. 칭찬·요약 금지, 지표에 없는 추측 금지."},
    {"role": "user", "content": body}]}))
PYEOF
)
  SUM=$(curl -s -m 180 "http://$TS_IP:4000/v1/chat/completions" -H "Authorization: Bearer $K" \
        -H "Content-Type: application/json" -d "$BODY" \
        | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin)["choices"][0]["message"]["content"].strip())
except Exception as e:
    print("(총평 생성 실패: %s)" % e)' 2>/dev/null)
  { echo; echo "## 10. 총평 (로컬 모델)"; echo "$SUM"; } >> "$OUT"
fi

# ── 보존 12주 ──
find "$REPORT_DIR" -name 'selfcheck_*.md' -mtime +84 -delete 2>/dev/null

echo "리포트: $OUT"

# ── Slack 전송. 봇 토큰 직접 호출(웹훅 URL이 없는 워크스페이스라 Kuma에서도 같은 방식을 썼다) ──
[ -n "$DRY" ] && { echo "(--dry-run: 전송 생략)"; exit 0; }
BOT=$(grep '^SLACK_BOT_TOKEN=' .env | tail -n1 | cut -d= -f2- | tr -d ' \r')
if [ -z "$BOT" ]; then
  echo "WARN: SLACK_BOT_TOKEN 없음 — 리포트를 아무도 읽지 못한다"
  exit 0
fi
python3 - "$OUT" "$BOT" "$SLACK_CHANNEL" <<'PYEOF'
import json, sys, urllib.request, urllib.error, re

path, token, channel = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()

# 원문 전체를 붙이면 Slack 4000자 제한에 걸리고 읽히지도 않는다.
# "사람이 판단할 것" + "총평"만 본문으로 올리고, 나머지는 파일 경로로 안내한다.
def section(title):
    m = re.search(r"^## .*%s.*$([\s\S]*?)(?=^## |\Z)" % re.escape(title), text, re.M)
    return (m.group(1).strip() if m else "")

body = []
body.append("*🔎 주간 자가점검* — " + text.splitlines()[0].replace("# 주간 자가점검 — ", ""))
for t in ("분기 목표 대비 실적", "과확장 점검", "사람이 판단할 것", "총평"):
    s = section(t)
    if s:
        body.append("\n*" + t + "*\n" + s[:1100])
body.append("\n_전문: `%s`_" % path)
msg = "\n".join(body)[:3800]

req = urllib.request.Request(
    "https://slack.com/api/chat.postMessage",
    data=json.dumps({"channel": channel, "text": msg, "mrkdwn": True,
                     "unfurl_links": False}, ensure_ascii=False).encode(),
    headers={"Authorization": "Bearer " + token,
             "Content-Type": "application/json; charset=utf-8"},
    method="POST")
try:
    r = json.loads(urllib.request.urlopen(req, timeout=20).read())
except Exception as e:
    print("FAIL: Slack 전송 예외 —", e); sys.exit(1)

# ★ Slack은 실패해도 HTTP 200을 준다. ok를 반드시 확인해야 조용한 실패를 잡는다.
if r.get("ok"):
    print("Slack 전송 OK — 채널 %s" % r.get("channel"))
else:
    print("FAIL: Slack이 거절함 —", r.get("error"))
    sys.exit(1)
PYEOF
