#!/bin/sh
# ollama-warmup.sh — 재부팅·재시작 후 로컬 티어 4종을 메모리에 올려둔다(C-3 "로컬 티어 상주").
#
# 왜: KEEP_ALIVE=-1은 "한 번 올라오면 안 내린다"일 뿐, **처음 올리는 건 첫 요청**이다.
# 그래서 재부팅 직후 첫 워크플로가 35B 콜드로드(수십 초)를 뒤집어쓰고 타임아웃이 났다(7차 사고).
# 이 스크립트가 그 첫 요청을 대신 맞는다.
#
# 설치: com.agent.ollama-warmup.plist (ollama LaunchAgent와 함께 RunAtLoad)
set -u
HOST="${OLLAMA_HOST:-100.65.201.6:11434}"
LOG="$HOME/Library/Logs/ollama-warmup.log"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

# ollama가 응답할 때까지 대기(최대 5분)
i=0
until curl -s -m 5 "http://$HOST/api/version" >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -gt 60 ] && { log "FATAL: ollama가 5분 내 응답 없음"; exit 1; }
  sleep 5
done
log "ollama 준비됨"

# 챗 모델: 1토큰만 생성시켜 로드. 임베딩 모델은 embed 엔드포인트.
for M in qwen2.5:7b qwen3.6:35b-a3b qwen3-coder:30b; do
  T0=$(date +%s)
  if curl -s -m 600 "http://$HOST/api/generate" \
       -d "{\"model\":\"$M\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":1}}" \
       -o /dev/null 2>/dev/null; then
    log "warm $M ($(( $(date +%s) - T0 ))s)"
  else
    log "WARN warm 실패: $M"
  fi
done
if curl -s -m 300 "http://$HOST/api/embed" -d '{"model":"bge-m3","input":"warm"}' -o /dev/null 2>/dev/null; then
  log "warm bge-m3"
else
  log "WARN warm 실패: bge-m3"
fi

log "상주: $(curl -s -m 10 "http://$HOST/api/ps" 2>/dev/null | python3 -c 'import json,sys;print(",".join(m["name"] for m in json.load(sys.stdin).get("models",[])))' 2>/dev/null)"
