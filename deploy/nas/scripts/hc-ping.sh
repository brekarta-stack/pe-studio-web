#!/bin/sh
# hc-ping.sh — NAS 생존 하트비트 (healthchecks.io 등 외부 모니터로 ping)
# 사용: hc-ping.sh /path/to/heartbeat.url
# URL 파일이 없거나 비어 있으면 조용히 성공 종료(0) — URL 발급 전에도 cron 등록 가능.
# URL 파일에 ping URL 한 줄만 넣으면 다음 주기부터 자동 활성화된다.

URL_FILE="${1:?usage: hc-ping.sh <url-file>}"

[ -s "$URL_FILE" ] || exit 0

URL=$(head -n1 "$URL_FILE" | tr -d ' \r\n')
[ -n "$URL" ] || exit 0

# 실패해도 재시도 2회(connrefused 포함). 출력은 버리고 종료코드만 남긴다(로그 오염 방지).
curl -fsS -m 10 --retry 2 --retry-connrefused -o /dev/null "$URL"
