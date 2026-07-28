#!/bin/zsh
# learning-quiz — 평일 아침 데일리 퀴즈(산업·투자 / 금요일엔 문화). 미니 이관본(2026-07-28).
#
# 블록 구성(config/learning.json 의 quiz.blocks):
#   industry 3문항 engine=claude   — 매일
#   invest   5문항 engine=ollama   — 매일 (요일별 중점 분야가 바뀐다)
#   culture  5문항 engine=claude   — 금요일만
#
# ⚠️ 이관하며 고친 것 두 가지 — 둘 다 없으면 조용히 0문항이 된다.
#
# 1) OLLAMA_ENDPOINT
#    bin/ollama-agent 의 기본값은 http://localhost:11434 인데, Studio의 ollama는
#    OLLAMA_HOST=100.65.201.6:11434 (Tailscale IP)에만 바인딩돼 있어 localhost로는 안 붙는다.
#    → invest 블록(5문항, 실제로 매일 나오던 유일한 블록)이 통째로 사라진다. 반드시 명시한다.
#
# 2) claude 권한 (bin/ask 쪽에서 이미 수정됨)
#    미니에서 industry 블록은 3개↔0개를 오갔다(최근 14회 중 9회가 0개).
#    bd-daily와 같은 --print 권한 함정으로 보인다. Studio의 bin/ask 에는
#    --permission-mode/--allowed-tools 를 넣어뒀으므로 여기서는 그대로 이득을 본다.
#
# LQ_DRY=1 이면 슬랙 발송 없이 생성만 한다(검증용).
set -u
ROOT="${LQ_ROOT:-$HOME/agents-bd}"
cd "$ROOT" || exit 1
mkdir -p logs/studio
LOG="logs/studio/learning-quiz.log"

export OLLAMA_ENDPOINT="${OLLAMA_ENDPOINT:-http://100.65.201.6:11434}"

# AUTOMATION_MODE 를 설정하면 안 된다 — bin/ask 가 claude→ollama 로 강등시켜
# industry·culture 블록의 웹검색이 죽는다(bin/learning-quiz 의 주석에도 명시돼 있다).
unset AUTOMATION_MODE

echo "=== learning-quiz $(date '+%F %T') (dry=${LQ_DRY:-0}) ===" >> "$LOG"
if [ "${LQ_DRY:-0}" = "1" ]; then
  "$ROOT/.venv/bin/python" bin/learning-quiz --dry-run --force >> "$LOG" 2>&1
  exit 0
fi
"$ROOT/.venv/bin/python" bin/learning-quiz >> "$LOG" 2>&1

# ★ 산출이 있을 때만 Kuma에 핑한다.
#   미니에서 industry 블록은 14회 중 9회가 0문항이었는데 잡은 매번 "성공"으로 끝났다.
#   posted=True 이면서 total 이 기대보다 적은 상태를 잡아내려면 문항 수를 봐야 한다.
#   주말은 스크립트가 즉시 종료하므로(설계), 그때는 핑을 생략해도 26시간 안에 평일 실행이 온다.
LAST=$(grep -E "^\[learning-quiz\] [0-9]{4}-" "$LOG" | tail -1)
TOTAL=$(printf '%s' "$LAST" | sed -n 's/.*total=\([0-9]*\).*/\1/p')
POSTED=$(printf '%s' "$LAST" | sed -n 's/.*posted=\([A-Za-z]*\).*/\1/p')
if [ "$POSTED" = "True" ] && [ "${TOTAL:-0}" -ge 5 ]; then
  # ⚠️ msg 는 ASCII만 쓴다. 한글을 넣으면 Kuma가 하트비트를 기록하지 않는다(실측 2026-07-28).
  #    게다가 `curl -f … && echo` 형태면 실패해도 로그에 아무것도 안 남아
  #    "핑을 보냈다고 착각"하게 된다 — 이 스크립트가 막으려던 바로 그 실패다. rc를 남긴다.
  if curl -fsS -m 10 "http://100.86.100.119:3001/api/push/lquiz28e7c2b5a9d1f4360e8c7a?status=up&msg=q${TOTAL}" >/dev/null 2>&1; then
    echo "[kuma] ${TOTAL}문항 발송 — 핑 OK" >> "$LOG"
  else
    echo "[kuma] ⚠️ 핑 전송 실패(rc=$?) — Kuma가 26시간 뒤 빨간불을 띄운다" >> "$LOG"
  fi
else
  echo "[kuma] 발송 실패 또는 문항 부족(posted=${POSTED:-?} total=${TOTAL:-0}) — 핑 생략" >> "$LOG"
fi
