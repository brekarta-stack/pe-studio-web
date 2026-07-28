#!/bin/zsh
# bd-daily — 신규 B2B 리드 발굴 → 상위 1건 제안서 작성 → 슬랙 검토 발행.
# 미니 com.papercraft.bd-daily 의 Studio 이관본(2026-07-28).
#
# 이관하며 바뀐 것:
#  - 실행 위치: 미니(24GB) → Studio(96GB). 원래 routing.json이 "리드.*발굴"을 ultra(Studio)로
#    보내게 돼 있었는데, machines.json의 ultra.standby=true 때문에 2026-06-11부터 전부
#    미니 로컬로 강등돼 있었다(logs/system/ask-ultra-fallback.log). 이제 제 자리에서 돈다.
#  - 경로: /Users/agent/agents → ~/agents-bd (제안서 서브시스템만 선별 이관, 5.1GB → 140MB)
#  - 구 에이전트 시스템(채널 에이전트·대시보드·큐)은 가져오지 않았다. C-1에서 폐기된 구조다.
#
# ⚠️ BD_DRY=1 이면 슬랙 발행 없이 발굴·작성만 한다(검증용).
#    발행은 고객 발송이 아니라 #biz 검토 카드다 — 봇 자동발송은 없다.
set -u
ROOT="${BD_ROOT:-$HOME/agents-bd}"
cd "$ROOT" || exit 1
mkdir -p logs/studio
LOG="logs/studio/bd-daily.log"
PY="$ROOT/.venv/bin/python"

PROMPT='신규 B2B 리드 5곳 발굴. 발굴 5곳을 확정하기 전에 outputs/proposals/proposed-ledger.json 을 Read 해서 최근 180일(6개월) 이내에 이미 제안한 기관은 후보에서 제외하고 다른 기관으로 대체하라. 같은 기관 재제안 금지. 각 리드마다: (1)대상 심층분석(기관 현황·페인포인트·의사결정자) (2)reference/proposals/cases.md 와 reference/proposals/winning/ 에서 비슷한 유형 매칭 (3)reference/proposals/templates/commercial-structure.md 의 상용 8섹션 구조를 정확히 따르고 winning/·example-*.md 톤을 모방해 고품질 제안서 작성. 웹 리서치(전시·마스코트·최근 동향)를 본문에 고유명사로 구체적으로 녹여라. 5곳을 스코어링한 뒤 적합도 상위 1건만 풀 제안서로 작성한다(나머지 4곳은 작성·JSON·이미지 생성 없이 요약 표에 워치리스트로만). 선정한 상위 1건만 outputs/proposals/pending/ 에 JSON 저장(스키마: org,slug,segment,score,matched_cases,contact_name,contact_email,subject,body_text). body_text 는 마크다운 ## 섹션 구조로 작성하면 슬라이드로 자동 변환된다. 또한 반드시 image_prompt(영문) 필드를 넣어라 — 그 기관의 상징물/마스코트/대표 전시주제를 조사해 그것을 피사체로만 묘사하라(예: 울산 고래박물관→a friendly gray whale character, the museum mascot). 페이퍼크래프트 3D 종이모형 스타일·배경은 자동 적용되니 스타일/배경/글자는 쓰지 마라'

echo "=== bd-daily $(date '+%F %T') (dry=${BD_DRY:-0}) ===" >> "$LOG"

if [ "${BD_DRY:-0}" = "1" ]; then
  "$PY" bin/ask "$PROMPT" --agent papercraft-bd >> "$LOG" 2>&1
  echo "[dry] 슬랙 발행 생략" >> "$LOG"
else
  "$PY" bin/ask "$PROMPT" --agent papercraft-bd --channel C0B7R48MAL8 >> "$LOG" 2>&1
  "$PY" bin/proposal-publish >> "$LOG" 2>&1
fi

echo "=== 종료 $(date '+%F %T') · pending $(ls outputs/proposals/pending/*.json 2>/dev/null | wc -l | tr -d ' ')건 ===" >> "$LOG"
