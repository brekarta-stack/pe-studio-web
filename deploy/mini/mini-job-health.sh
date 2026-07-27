#!/bin/sh
# 미니 스케줄 잡들이 실제로 "성공"하고 있는지 로그로 판정한다.
# 왜: 이관 우선순위는 "무엇이 아직 가치를 내고 있는가"로 정해야 한다.
#     morning-brief처럼 18일간 죽어 있던 잡을 정성껏 이관하는 건 낭비다.
# 판정: 최근 로그의 마지막 갱신 시각 + err 파일 크기 + ok=False/Traceback 흔적.
L=~/agents/logs/mini
NOW=$(date +%s)
printf "%-30s %-10s %-8s %s\n" "잡" "최종실행" "err" "판정"
printf -- "---------------------------------------------------------------------------\n"
for p in ~/Library/LaunchAgents/com.papercraft.*.plist ~/Library/LaunchAgents/com.agent.*.plist; do
  [ -f "$p" ] || continue
  lab=$(basename "$p" .plist); job=${lab##*.}
  log="$L/$job.log"; err="$L/$job.err"
  if [ -f "$log" ]; then
    age=$(( (NOW - $(stat -f %m "$log")) / 3600 ))
    ago="${age}h전"
  else
    ago="로그없음"
  fi
  esz=0; [ -f "$err" ] && esz=$(stat -f %z "$err")
  verdict="?"
  if [ -f "$log" ]; then
    tailtxt=$(tail -3 "$log" 2>/dev/null)
    case "$tailtxt" in
      *"ok=False"*|*"Traceback"*|*"error"*|*"ERROR"*|*"failed"*) verdict="실패흔적" ;;
      *) verdict="정상보임" ;;
    esac
    [ "${age:-999}" -gt 48 ] && verdict="$verdict(48h+ 정지)"
  else
    verdict="미실행/무로그"
  fi
  [ "$esz" -gt 2000 ] && verdict="$verdict +err${esz}B"
  printf "%-30s %-10s %-8s %s\n" "$job" "$ago" "$esz" "$verdict"
done
