#!/bin/sh
# drift-check.sh — 레포와 NAS 실배포가 일치하는지 해시로 대조한다.
# 왜: 감사에서 "레포 v3인데 NAS는 v2" 같은 드리프트가 반복 적발됐다. 눈으로는 못 잡는다.
# 사용(Studio에서): sh deploy/nas/scripts/drift-check.sh
# 종료코드 0=일치, 1=드리프트 있음.
set -u
REPO_NAS=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)   # deploy/nas
REMOTE=${REMOTE:-'~/agent-backbone'}
DIFF=0

files="docker-compose.yml litellm-config.yaml init-db.sql
scripts/hc-ping.sh scripts/backup-daily.sh scripts/ab-boot-up.sh scripts/install-cron.sh
scripts/weekly-selfcheck.sh scripts/restore-rehearsal.sh scripts/smoke-all.sh
scripts/kuma-notify-slack.sh
pipelines/init-parts.sql pipelines/load-parts.py pipelines/sync-parts.sh
pipelines/sync-roles.sh pipelines/init-learning.sql
trading/Dockerfile trading/init-trading.sql trading/engine/core.py trading/engine/main.py
trading/engine/guardrails.py trading/engine/broker.py trading/engine/selftest.py
trading/engine/ratelimit.py
n8n-workflows/wf-litellm-smoke.json n8n-workflows/wf-morning-brief.json
n8n-workflows/wf-trade-analyst.json n8n-workflows/wf-leadgen-generic.json
n8n-workflows/wf-blog-generic.json n8n-workflows/wf-quote-generic.json
n8n-workflows/wf-learning-quiz.json n8n-workflows/wf-credential-audit.json"

# NAS 쪽 해시를 한 번에 받아온다(왕복 1회)
REMOTE_HASHES=$(ssh nas "cd $REMOTE 2>/dev/null && for f in $(echo $files | tr '\n' ' '); do
  if [ -f \"\$f\" ]; then printf '%s %s\n' \"\$(sha256sum < \"\$f\" | cut -c1-16)\" \"\$f\"; else printf 'MISSING %s\n' \"\$f\"; fi
done")

echo "== 레포 ↔ NAS 드리프트 검사 =="
for f in $files; do
  [ -f "$REPO_NAS/$f" ] || { echo "  [레포없음] $f"; DIFF=$((DIFF+1)); continue; }
  L=$(shasum -a 256 "$REPO_NAS/$f" | cut -c1-16)
  R=$(echo "$REMOTE_HASHES" | awk -v k="$f" '$2==k {print $1}')
  if [ -z "$R" ]; then echo "  [NAS없음]  $f"; DIFF=$((DIFF+1))
  elif [ "$R" = "MISSING" ]; then echo "  [NAS없음]  $f"; DIFF=$((DIFF+1))
  elif [ "$L" != "$R" ]; then echo "  [불일치]   $f  (repo:$L nas:$R)"; DIFF=$((DIFF+1))
  fi
done

# ── cron이 실제로 돌리는 사본까지 본다 ────────────────────────────────────────────
# 왜: cron은 ~/agent-backbone/scripts/ 가 아니라 **/usr/local/sbin/ab-*.sh 사본**을 실행한다
#     (root cron이 사용자 소유 파일을 실행하지 않게 하려는 의도적 설계).
#     그래서 ~/agent-backbone만 갱신하고 install-cron.sh를 다시 안 돌리면,
#     "고쳤는데 cron은 옛날 코드를 계속 돌리는" 상태가 된다 — 2026-07-28 실제로 밟았다.
echo
echo "== NAS ↔ cron 실행본(/usr/local/sbin) 대조 =="
pairs="hc-ping.sh:ab-hc-ping.sh backup-daily.sh:ab-backup-daily.sh ab-boot-up.sh:ab-boot-up.sh
weekly-selfcheck.sh:ab-weekly-selfcheck.sh offsite-sync.sh:ab-offsite-sync.sh"
# ⚠️ $REMOTE는 '~/agent-backbone' 문자열이다. 큰따옴표 안에 넣으면 틸드가 확장되지 않아
#    전부 "파일 없음"으로 오탐한다(처음에 그렇게 짰다가 잡았다). cd 로 넘겨서 셸이 펴게 한다.
SBIN=$(ssh nas "cd $REMOTE || exit 1; for p in $(echo $pairs | tr '\n' ' '); do
  s=\${p%%:*}; d=\${p#*:}
  a=\$(sha256sum < \"scripts/\$s\" 2>/dev/null | cut -c1-16)
  b=\$(sudo -n sha256sum < \"/usr/local/sbin/\$d\" 2>/dev/null | cut -c1-16)
  printf '%s %s %s\n' \"\$s\" \"\${a:-NONE}\" \"\${b:-NONE}\"
done")
echo "$SBIN" | while read -r n a b; do
  [ -n "$n" ] || continue
  if [ "$a" = "$b" ] && [ "$a" != "NONE" ]; then :
  else echo "  [불일치]   $n  (nas:$a sbin:$b) → sudo sh scripts/install-cron.sh 재실행 필요"
  fi
done
echo "$SBIN" | awk '$2!=$3 || $2=="NONE" {c++} END {exit c?1:0}' || DIFF=$((DIFF+1))

echo
if [ "$DIFF" -eq 0 ]; then echo "== 전부 일치 =="; exit 0; fi
echo "== 드리프트 $DIFF건 — 배포하려면: =="
echo "   cd deploy/nas && COPYFILE_DISABLE=1 tar -cf - <파일> | ssh nas 'tar -xf - -C ~/agent-backbone'"
exit 1
