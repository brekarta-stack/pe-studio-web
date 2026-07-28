#!/bin/sh
# 미니의 잡 중 claude를 부르는 것을 찾아 권한 함정 상태를 판정한다.
# 근거: bd-daily가 claude CLI 갱신(2026-07-11) 직후부터 18일간 산출 0건이었는데
#       실패가 "정상 종료"로 보였다. 같은 경로를 쓰는 잡은 전부 같은 상태일 수 있다.
# 탐지: 잡이 부르는 스크립트가 (직접이든 bin/ask 경유든) claude를 쓰는가.
cd "$HOME/agents" || exit 1

uses_claude() {   # $1 = bin 스크립트 이름
  f="bin/$1"
  [ -f "$f" ] || return 1
  grep -qE '"claude"|bin/ask|run_local|import ask|from ask' "$f" 2>/dev/null
}

printf "%-24s %-9s %-9s %-10s %s\n" "잡" "claude?" "권한거부" "최종로그" "판정"
printf -- "-------------------------------------------------------------------------------\n"
for p in ~/Library/LaunchAgents/com.papercraft.*.plist ~/Library/LaunchAgents/com.agent.*.plist; do
  [ -f "$p" ] || continue
  lab=$(basename "$p" .plist); job=${lab##*.}
  hit=""
  for s in $(/usr/libexec/PlistBuddy -c "Print :ProgramArguments" "$p" 2>/dev/null \
             | grep -oE "bin/[a-z0-9-]+" | sed 's|bin/||' | sort -u); do
    case "$s" in python3|python|bash|zsh|sh|caffeinate|tailscaled) continue ;; esac
    uses_claude "$s" && hit="$s"
  done
  [ -n "$hit" ] || continue

  log="logs/mini/$job.log"
  if [ ! -f "$log" ]; then
    printf "%-24s %-9s %-9s %-10s %s\n" "$job" "$hit" "-" "로그없음" "확인불가"
    continue
  fi
  deny=$(grep -c "권한이 승인되\|권한 차단\|permissions not granted\|도구 권한이\|permission denied" "$log" 2>/dev/null)
  age=$(( ( $(date +%s) - $(stat -f %m "$log") ) / 3600 ))
  total=$(wc -l < "$log" | tr -d ' ')
  lastdeny=$(grep -n "권한이 승인되\|권한 차단\|permissions not granted\|도구 권한이\|permission denied" "$log" 2>/dev/null | tail -1 | cut -d: -f1)
  verdict="권한거부 흔적 없음"
  if [ "${deny:-0}" -gt 0 ] && [ -n "$lastdeny" ] && [ "${total:-0}" -gt 0 ]; then
    pct=$(( lastdeny * 100 / total ))
    if [ "$pct" -ge 80 ]; then verdict="★현재도 거부(로그 ${pct}% 지점)"
    else verdict="과거 거부(${pct}% 지점)"; fi
  fi
  printf "%-24s %-9s %-9s %-10s %s\n" "$job" "$hit" "${deny:-0}" "${age}h전" "$verdict"
done
