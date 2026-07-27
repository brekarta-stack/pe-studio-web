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

echo
if [ "$DIFF" -eq 0 ]; then echo "== 전부 일치 =="; exit 0; fi
echo "== 드리프트 $DIFF건 — 배포하려면: =="
echo "   cd deploy/nas && COPYFILE_DISABLE=1 tar -cf - <파일> | ssh nas 'tar -xf - -C ~/agent-backbone'"
exit 1
