#!/bin/sh
# build-bootstrap.sh — deploy/nas/의 **실제 파일들**로부터 자립형 부트스트랩을 생성한다.
#
# 왜 필요한가: 이전 `nas-bootstrap.sh`는 compose·litellm-config를 heredoc으로 **베껴 넣어** 두었다.
# 그 사본이 낡으면서, 재구축 시 이미 고친 결함(재부팅 순서·LiteLLM 20초 타임아웃·추론모델 빈 응답)이
# 통째로 되살아나는 상태였다(감사에서 Critical로 적발).
# 이제는 이 스크립트가 **매번 현재 파일에서 생성**하므로 드리프트가 구조적으로 불가능하다.
#
# 사용: sh deploy/build-bootstrap.sh   → deploy/nas-bootstrap.sh 갱신
# 규칙: nas-bootstrap.sh를 **직접 편집하지 마라.** deploy/nas/ 아래를 고치고 이 스크립트를 다시 돌린다.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SRC="$HERE/nas"
OUT="$HERE/nas-bootstrap.sh"

[ -d "$SRC" ] || { echo "FATAL: $SRC 없음"; exit 1; }

emit_file() {  # $1 = SRC 기준 상대경로
  f="$1"
  [ -f "$SRC/$f" ] || { echo "FATAL: $SRC/$f 없음" >&2; exit 1; }
  d=$(dirname "$f")
  echo "mkdir -p \"\$D/$d\""
  echo "cat > \"\$D/$f\" <<'___EOF_$(echo "$f" | tr './-' '___')___'"
  cat "$SRC/$f"
  echo "___EOF_$(echo "$f" | tr './-' '___')___"
  echo
}

{
cat <<'HEADER'
#!/bin/sh
# nas-bootstrap.sh — ⚠️ 자동 생성 파일. 직접 편집하지 말 것.
#   생성기: deploy/build-bootstrap.sh (deploy/nas/의 현재 파일들로부터 생성)
#   고칠 때: deploy/nas/ 아래를 고치고 `sh deploy/build-bootstrap.sh` 재실행.
#
# 용도: git/인증 없는 맨 NAS에 백본을 세운다. 이 파일 하나를 붙여넣고 실행하면 된다.
# ※ 이미 백업이 있다면 이것보다 **복원**이 낫다:
#    백업의 compose_config.tar.gz를 풀고 pg 덤프를 로드하면 설정+데이터가 함께 돌아온다.
#    (deploy/nas/scripts/restore-rehearsal.sh 가 그 경로를 검증한다)
set -eu
D="${1:-$HOME/agent-backbone}"
mkdir -p "$D"
echo "== agent-backbone 배포: $D =="

HEADER

for f in docker-compose.yml litellm-config.yaml init-db.sql; do emit_file "$f"; done
for f in scripts/hc-ping.sh scripts/backup-daily.sh scripts/ab-boot-up.sh scripts/install-cron.sh \
         scripts/weekly-selfcheck.sh scripts/restore-rehearsal.sh scripts/smoke-all.sh; do emit_file "$f"; done
for f in pipelines/init-parts.sql pipelines/load-parts.py pipelines/sync-parts.sh pipelines/init-learning.sql; do emit_file "$f"; done
for f in trading/Dockerfile trading/requirements.txt trading/init-trading.sql \
         trading/engine/__init__.py trading/engine/broker.py trading/engine/core.py \
         trading/engine/guardrails.py trading/engine/main.py trading/engine/ratelimit.py \
         trading/engine/selftest.py; do emit_file "$f"; done
for f in n8n-workflows/wf-litellm-smoke.json n8n-workflows/wf-morning-brief.json \
         n8n-workflows/wf-trade-analyst.json n8n-workflows/wf-leadgen-generic.json \
         n8n-workflows/wf-blog-generic.json n8n-workflows/wf-quote-generic.json \
         n8n-workflows/wf-learning-quiz.json n8n-workflows/wf-credential-audit.json; do emit_file "$f"; done

cat <<'FOOTER'
chmod +x "$D"/scripts/*.sh "$D"/pipelines/*.sh "$D"/pipelines/*.py 2>/dev/null || true
chmod 750 "$D/pipelines" 2>/dev/null || true

cat <<'NEXT'

== 파일 배치 완료. 다음 순서 ==
1) .env 작성 (deploy/README.md §3 참조 — PG_*/N8N_ENCRYPTION_KEY/LITELLM_MASTER_KEY/NAS_TS_IP/STUDIO_OLLAMA_BASE)
2) 커널 파라미터(부팅 시 TS IP 바인딩 실패 방지):
   printf 'net.ipv4.ip_nonlocal_bind=1\nnet.ipv6.ip_nonlocal_bind=1\n' | sudo tee /etc/sysctl.d/99-agent-backbone.conf
   sudo sysctl -p /etc/sysctl.d/99-agent-backbone.conf
3) sudo docker compose up -d
4) sudo sh scripts/install-cron.sh "$PWD" /volume3/backup/agent-backbone
5) sudo docker compose --profile trading run --rm trading     # 매매 스키마 적용 + 셀프테스트
6) sh pipelines/sync-parts.sh                                  # 파트 정의 동기화(YAML 별도 배치 필요)
7) sh scripts/smoke-all.sh                                     # 24항목 통합 검증
NEXT
FOOTER
} > "$OUT"

chmod +x "$OUT"
echo "생성 완료: $OUT ($(wc -l < "$OUT")줄, $(wc -c < "$OUT")바이트)"
sh -n "$OUT" && echo "구문 검사 통과"
