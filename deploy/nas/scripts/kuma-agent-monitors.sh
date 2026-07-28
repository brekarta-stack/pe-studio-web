#!/bin/sh
# Studio 에이전트 잡의 "조용한 실패"를 시끄럽게 만든다.
#
# 오늘 같은 부류를 네 번 만났다: 잡이 정상 종료하는데 산출물이 0건이고, 아무도 몰랐다.
#   - bd-daily: 18일간 제안서 0건 (claude --print 권한)
#   - learning-quiz industry 블록: 14회 중 9회 0문항 (같은 원인)
#   - Kuma 알림: 설정은 됐는데 Slack이 거부 (HTTP 200이라 성공으로 보임)
#   - morning-brief: 없어진 채널에 18일간 발송 (ok=False인데 아무도 안 봄)
#
# 공통점: **성공/실패가 아니라 "산출량"을 봐야 한다.** 그래서 push 모니터를 쓴다 —
# 잡이 실제로 결과물을 냈을 때만 핑을 보내고, 안 오면 Kuma가 빨간불 → Slack 알림.
set -eu
KC=agent-backbone-uptime-kuma-1

# 간격: 하루 1회 도는 잡이므로 26시간(하루 + 여유 2시간). 놓치면 재시도 1시간 간격.
add() {  # $1=이름  $2=토큰  $3=간격초
  sudo -n docker exec "$KC" sqlite3 /app/data/kuma.db "
    DELETE FROM monitor_notification WHERE monitor_id IN (SELECT id FROM monitor WHERE name='$1');
    DELETE FROM monitor WHERE name='$1';
    INSERT INTO monitor (name, type, push_token, interval, retry_interval, resend_interval,
                         maxretries, active, user_id, accepted_statuscodes_json)
    VALUES ('$1','push','$2',$3,3600,0,1,1,1,'[\"200-299\"]');
    INSERT INTO monitor_notification (monitor_id, notification_id)
      SELECT (SELECT id FROM monitor WHERE name='$1'),
             (SELECT id FROM notification WHERE name='Slack #sysops');
    SELECT '  등록: $1 (id=' || (SELECT id FROM monitor WHERE name='$1') || ')';
  "
}

add 'bd-daily(push)'      'bddaily28d4f1a9c7e0b3524ab6' 93600
add 'learning-quiz(push)' 'lquiz28e7c2b5a9d1f4360e8c7a' 93600

sudo -n docker compose -f "$HOME/agent-backbone/docker-compose.yml" restart uptime-kuma >/dev/null 2>&1 \
  || sudo -n docker restart "$KC" >/dev/null 2>&1
echo "kuma 재시작"
