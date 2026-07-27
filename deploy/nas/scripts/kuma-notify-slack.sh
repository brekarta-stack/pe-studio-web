#!/bin/sh
# kuma-notify-slack.sh — Uptime Kuma의 장애 알림을 Slack #sysops-시스템관리로 보낸다.
#
# 왜 필요한가: 관제 대시보드에 빨간불이 떠도 **아무도 부르지 않으면** 관제가 아니다.
#   실제로 알림 채널이 0개인 채 6개 모니터가 돌고 있었다(운영 준비도 감사 최상위 지적).
#
# 왜 Kuma의 slack 프로바이더를 안 쓰는가: 그건 Incoming Webhook URL을 요구하는데,
#   이 워크스페이스에는 봇 토큰만 있다(같은 봇이 이미 #sysops에 있다). 그래서 generic webhook로
#   chat.postMessage를 직접 호출한다.
#
# ── 실측으로 잡은 함정 3가지(전부 "조용히" 실패했다) ────────────────────────────
# 1) 템플릿 문법: webhookCustomBody는 **LiquidJS**로 렌더된다. JS 삼항 연산자를 쓰면
#      Error: invalid value expression: "$heartbeat.status === 0 ? ..."
#    노출 변수는 {msg, monitorJSON, heartbeatJSON} 셋뿐이다.
# 2) Content-Type: Kuma는 webhookContentType="custom"일 때 **Content-Type을 설정하지 않는다**
#    (webhook.js가 config.headers={}로 시작하고 custom 분기는 헤더를 안 건드린다).
#    그러면 axios가 문자열 본문을 text/plain으로 보내고 Slack이 거부한다.
#    → 반드시 webhookAdditionalHeaders에 직접 넣는다.
# 3) Slack은 실패해도 **HTTP 200**을 준다({"ok":false,"error":"invalid_arguments"}).
#    Kuma는 200이면 성공으로 보고 로그조차 안 남긴다 → 토큰 만료 등으로 언제든 조용히 죽을 수 있다.
#    → smoke-all.sh의 "관제" 섹션이 auth.test + 헤더 존재를 주기적으로 확인한다. 거기를 지울 것.
#
# 본문 값에 큰따옴표/개행이 섞이면 JSON이 깨지므로 core Liquid 필터로 무해화한다
# (liquidjs의 `json` 필터 존재 여부에 기대지 않는다).
#
# 사용: ssh nas 'sh -' < deploy/nas/scripts/kuma-notify-slack.sh   (인자로 채널ID 지정 가능)
set -eu
KC=agent-backbone-uptime-kuma-1
CH="${1:-C0B6QEAKEAF}"     # #sysops-시스템관리
cd "$HOME/agent-backbone"

BOT=$(grep '^SLACK_BOT_TOKEN=' .env | cut -d= -f2- | tr -d ' \r')
[ -n "$BOT" ] || { echo "FATAL: SLACK_BOT_TOKEN 없음"; exit 1; }

sudo -n docker exec "$KC" sh -c 'cp /app/data/kuma.db /app/data/kuma.db.bak-notif'
echo "kuma.db 백업 완료"

python3 - "$CH" "$BOT" > /tmp/notif.sql <<'PYEOF'
import json, sys
ch, bot = sys.argv[1], sys.argv[2]

# {%- -%}로 공백을 먹여 렌더 결과가 곧바로 '{'로 시작하게 한다.
body_tpl = (
    '{%- if heartbeatJSON.status == 0 -%}'
    '{%- assign icon = ":rotating_light: *DOWN*" -%}'
    '{%- else -%}'
    '{%- assign icon = ":white_check_mark: 복구(UP)" -%}'
    '{%- endif -%}'
    '{%- assign safe = msg | default: "" | replace: chr34, "”" | strip_newlines -%}'
    '{%- assign nm = monitorJSON.name | default: "(unknown)" | replace: chr34, "”" -%}'
    '{"channel":"' + ch + '","text":"{{ icon }} — {{ nm }}\\n{{ safe }}"}'
).replace("chr34", "'\"'")   # Liquid에서 큰따옴표 리터럴은 홑따옴표로 감싼다

cfg = {
    "name": "Slack #sysops",
    "type": "webhook",
    "isDefault": True,
    "applyExisting": True,
    "webhookURL": "https://slack.com/api/chat.postMessage",
    "webhookContentType": "custom",
    "webhookCustomBody": body_tpl,
    "webhookAdditionalHeaders": json.dumps({
        "Authorization": "Bearer " + bot,
        "Content-Type": "application/json; charset=utf-8",   # ← 함정 2. 지우면 조용히 죽는다
    }),
}
esc = json.dumps(cfg, ensure_ascii=False).replace("'", "''")
print("DELETE FROM monitor_notification WHERE notification_id IN (SELECT id FROM notification WHERE name='Slack #sysops');")
print("DELETE FROM notification WHERE name='Slack #sysops';")
print("INSERT INTO notification (name, active, user_id, is_default, config) VALUES ('Slack #sysops', 1, 1, 1, '%s');" % esc)
print("INSERT INTO monitor_notification (monitor_id, notification_id) "
      "SELECT m.id, (SELECT id FROM notification WHERE name='Slack #sysops') FROM monitor m;")
print("SELECT '  모니터 연결: ' || count(*) FROM monitor_notification;")
PYEOF

# SQL 파일에 봇 토큰이 들어 있다 — 컨테이너로 넘긴 즉시 양쪽에서 지운다.
sudo -n docker cp /tmp/notif.sql "$KC":/tmp/notif.sql >/dev/null
rm -f /tmp/notif.sql
sudo -n docker exec "$KC" sh -c 'sqlite3 /app/data/kuma.db < /tmp/notif.sql; rm -f /tmp/notif.sql'

sudo -n docker compose restart uptime-kuma >/dev/null 2>&1
echo "kuma 재시작 — 알림 반영 완료"
echo
echo ">>> 검증은 설정 확인으로 끝내지 말 것. 실제 드릴로 확인한다:"
echo "    sudo docker exec agent-backbone-trading-loop-1 touch /data/KILL   # 2분 뒤 DOWN 알림"
echo "    sudo docker exec agent-backbone-trading-loop-1 rm    /data/KILL   # 곧 복구 알림"
