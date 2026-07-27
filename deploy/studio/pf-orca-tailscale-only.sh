#!/bin/sh
# Orca(6768)를 Tailscale에서만 접근 가능하게 한다 — LAN 노출 차단.
#
# 왜 필요한가: macOS 응용 프로그램 방화벽을 켜도 "서명된 앱 자동 허용" 때문에 Orca는 그대로 열린다
# (실측: 방화벽 ON 상태에서 NAS→172.30.1.82:6768 이 200). Orca는 페어링 코드로만 보호되는데
# LAN에는 토렌트 클라이언트 등 신뢰할 수 없는 기기가 있고, Studio에는 NAS·미니로 가는
# 무비밀번호 SSH 키가 있다 — LAN에서 Orca를 잡으면 그 키들이 따라온다.
#
# 방식: pf(패킷 필터) 앵커 하나로 6768을 Tailscale CGNAT 대역(100.64.0.0/10)과 로컬호스트에만 개방.
# 되돌리기: sudo sh pf-orca-tailscale-only.sh --revert
set -eu

ANCHOR=/etc/pf.anchors/com.agent.orca
CONF=/etc/pf.conf
TAG="# agent-backbone: orca tailscale-only"

[ "$(id -u)" -eq 0 ] || { echo "FATAL: sudo로 실행할 것 — sudo sh $0"; exit 1; }

if [ "${1:-}" = "--revert" ]; then
  echo "== 되돌리는 중 =="
  sed -i '' "\|$TAG|d" "$CONF" 2>/dev/null || true
  sed -i '' '/anchor "com.agent.orca"/d;/load anchor "com.agent.orca"/d' "$CONF" 2>/dev/null || true
  rm -f "$ANCHOR"
  pfctl -f "$CONF" 2>/dev/null || true
  echo "  앵커 제거 완료. pf 자체는 켜진 상태로 둔다(다른 규칙에 영향 없음)."
  pfctl -s info 2>/dev/null | head -1
  exit 0
fi

echo "== 1. 앵커 규칙 작성 =="
cat > "$ANCHOR" <<'EOF'
# Orca 원격 개발 서버(6768) 접근 제한.
# quick = 첫 매치에서 결정. 허용을 먼저 두고 나머지를 막는다.
pass in quick proto tcp from 127.0.0.0/8 to any port 6768
pass in quick proto tcp from 100.64.0.0/10 to any port 6768   # Tailscale CGNAT
block drop in quick proto tcp from any to any port 6768
EOF
chmod 644 "$ANCHOR"
echo "  $ANCHOR"

echo "== 2. pf.conf에 앵커 등록(중복 안 함) =="
if ! grep -q 'com.agent.orca' "$CONF"; then
  cp "$CONF" "$CONF.bak-$(date +%s)"
  printf '\n%s\nanchor "com.agent.orca"\nload anchor "com.agent.orca" from "%s"\n' "$TAG" "$ANCHOR" >> "$CONF"
  echo "  등록됨 (원본은 $CONF.bak-*)"
else
  echo "  이미 등록돼 있음"
fi

echo "== 3. 문법 검사(적용 전) =="
if ! pfctl -n -f "$CONF"; then
  echo "  ✗ 문법 오류 — 적용하지 않는다. pf.conf.bak-* 로 복원할 것"
  exit 1
fi
echo "  통과"

echo "== 4. 적용 =="
pfctl -f "$CONF" 2>&1 | grep -v "^No ALTQ" || true
pfctl -e 2>&1 | grep -viE "already enabled|^$" || true
pfctl -s info 2>/dev/null | head -1 | sed 's/^/  /'

echo "== 5. 적용된 규칙 =="
pfctl -a com.agent.orca -s rules 2>/dev/null | sed 's/^/  /'

echo
echo ">>> 완료. 검증은 Claude가 NAS에서 6768 접근을 시도해 확인한다."
echo ">>> 되돌리려면: sudo sh $0 --revert"
