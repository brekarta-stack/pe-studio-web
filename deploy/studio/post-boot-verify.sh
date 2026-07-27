#!/bin/sh
# post-boot-verify.sh — 재부팅 후 무인 복구가 실제로 됐는지 자동 검증하고 결과를 남긴다.
#
# 왜 필요한가: 검증자(Claude 세션)가 검증 대상(Studio) 위에서 돌기 때문에, 재부팅하면
# 검증자도 함께 죽는다. 그래서 부팅 직후 자동 실행돼 증거를 파일로 남기는 방식이 필요하다.
# 운영 감사가 "2주 무인 시 가장 큰 단일 위험"으로 꼽은 것이 정확히 이 항목이다
# (자동 로그인이 꺼져 있으면 gui LaunchAgent가 하나도 안 뜬다 → 로컬 모델 전멸).
#
# 자동 실행: com.agent.post-boot-verify.plist (RunAtLoad)
# 결과: ~/Library/Logs/post-boot-verify.log  (최근 것이 맨 위)
set -u

LOG="$HOME/Library/Logs/post-boot-verify.log"
TMP=$(mktemp)
OLLAMA=100.65.201.6:11434

# 로그인·에이전트 기동에 시간이 걸리므로 최대 5분 기다린다
i=0
until curl -s -m 5 "http://$OLLAMA/api/version" >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -gt 60 ] && break; sleep 5
done

{
  echo "════════ 재부팅 후 검증 — $(date '+%F %H:%M:%S %Z') ════════"
  echo "부팅 후 경과: $(uptime | sed 's/.*up //; s/,.*load.*//')"
  echo

  echo "[1] 자동 로그인 (이게 실패하면 아래가 전부 실패한다)"
  AL=$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null)
  if [ -n "$AL" ] && [ -n "$(who | head -1)" ]; then
    echo "    ✅ 로그인 세션 활성 (autoLoginUser=$AL, 콘솔=$(who | head -1 | awk '{print $1}'))"
  else
    echo "    ❌ 로그인 세션 없음 — LaunchAgent가 뜨지 않는다"
  fi
  echo

  echo "[2] 로컬 모델 티어"
  V=$(curl -s -m 8 "http://$OLLAMA/api/version" 2>/dev/null)
  [ -n "$V" ] && echo "    ✅ ollama 응답 $V" || echo "    ❌ ollama 무응답 — LiteLLM의 로컬 4모델 전멸 상태"
  PS=$(curl -s -m 15 "http://$OLLAMA/api/ps" 2>/dev/null \
       | python3 -c 'import json,sys;print(",".join(m["name"] for m in json.load(sys.stdin).get("models",[])) or "(없음)")' 2>/dev/null)
  echo "    상주 모델: ${PS:-조회실패}"
  case "$PS" in *qwen*) echo "    ✅ 워밍업 동작(콜드스타트 사고 방지)" ;; *) echo "    ⚠️ 워밍업 미완 — 첫 요청이 콜드로드를 부담한다" ;; esac
  echo

  echo "[3] Orca 원격 개발 서버"
  O=$(curl -s -m 8 -o /dev/null -w '%{http_code}' http://100.65.201.6:6768/ 2>/dev/null)
  [ "$O" = "200" ] && echo "    ✅ Tailscale에서 응답 200" || echo "    ❌ 응답 $O — 폰·윈도우에서 붙을 수 없다"
  # ⚠️ Studio의 LAN IP는 DHCP로 바뀐다(실측: .26/.8 → .9/.82).
  #    고정 IP로 검사하면 "아무도 없는 주소"의 000을 "차단됨"으로 오독한다 — 실제로 그런 오탐이 있었다.
  #    그래서 매번 **현재** IP를 조회해 전부 검사한다.
  LANIPS=$(ifconfig 2>/dev/null | awk '/inet /{if($2!="127.0.0.1" && $2 !~ /^100\./) print $2}')
  if [ -z "$LANIPS" ]; then
    echo "    ⚠️ LAN IP를 못 찾음 — 검사 생략"
  else
    OPEN=""
    for IP in $LANIPS; do
      C=$(ssh -o BatchMode=yes -o ConnectTimeout=8 nas \
          "curl -s -m 6 -o /dev/null -w '%{http_code}' http://$IP:6768/ 2>/dev/null" 2>/dev/null)
      [ "$C" = "200" ] && OPEN="$OPEN $IP"
      echo "    LAN $IP → ${C:-무응답}"
    done
    if [ -n "$OPEN" ]; then
      echo "    ❌ LAN에서 열려 있다:$OPEN — pf 규칙 미적용(부팅 후 pf.conf 초기화 의심)"
      echo "       복구: sudo sh ~/acw/deploy/studio/pf-orca-tailscale-only.sh"
    else
      echo "    ✅ 모든 LAN IP에서 차단됨"
    fi
  fi
  echo

  echo "[4] 맥 방화벽"
  /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null | sed 's/^/    /'
  echo

  echo "[5] NAS 백본 (Tailscale 경유)"
  for P in 5678:n8n 4000:litellm 3001:kuma; do
    PORT=${P%%:*}; NAME=${P##*:}
    C=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "http://100.86.100.119:$PORT/" 2>/dev/null)
    case "$C" in 200|302) echo "    ✅ $NAME ($C)" ;; *) echo "    ❌ $NAME ($C)" ;; esac
  done
  echo "    NAS 관리UI 외부노출: $(curl -s -m 8 -o /dev/null -w '%{http_code}' http://221.148.237.75:9999/ 2>/dev/null) (000이어야 정상)"
  echo

  echo "[6] 통합 스모크 (NAS)"
  ssh -o BatchMode=yes -o ConnectTimeout=10 nas \
    'cd ~/agent-backbone && sh scripts/smoke-all.sh 2>&1 | tail -3' 2>/dev/null | sed 's/^/    /'
  echo
} > "$TMP" 2>&1

# 최근 결과가 위로 오도록 앞에 붙인다
if [ -f "$LOG" ]; then cat "$TMP" "$LOG" > "$LOG.new" && mv "$LOG.new" "$LOG"; else mv "$TMP" "$LOG"; fi
rm -f "$TMP"
# 20회분만 보존
tail -c 200000 "$LOG" > "$LOG.trim" 2>/dev/null && mv "$LOG.trim" "$LOG"
