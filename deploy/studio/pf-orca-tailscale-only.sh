#!/bin/sh
# Orca(6768)를 Tailscale에서만 접근 가능하게 한다 — LAN 노출 차단. **재부팅 자가복구판.**
#
# 왜 필요한가: macOS 응용 프로그램 방화벽을 켜도 "서명된 앱 자동 허용" 때문에 Orca는 그대로 열린다.
# Orca는 페어링 코드로만 보호되는데 LAN에는 신뢰할 수 없는 기기가 있고, Studio에는 NAS·미니로 가는
# 무비밀번호 SSH 키가 있다 — LAN에서 Orca를 잡으면 그 키들이 따라온다.
#
# ⚠️ v1의 실패(2026-07-27 실측): `/etc/pf.conf`에 앵커를 등록하는 방식이었는데,
#    **재부팅하면 macOS가 pf.conf를 원본으로 되돌려** 등록이 사라졌다(앵커 파일만 남고 규칙 미평가).
#    게다가 pf 자체도 부팅 시 꺼진 채 시작한다.
#    → v2는 LaunchDaemon이 부팅마다 (a) pf.conf 등록을 복구하고 (b) pf를 켜고 (c) 앵커를 로드한다.
#
# ⚠️ 검증 시 주의: Studio의 LAN IP는 DHCP로 바뀐다(실측: .26/.8 → .9/.82).
#    "차단됨(000)"이 실은 "그 주소에 아무도 없음"일 수 있다 — 반드시 **현재** IP로 검증할 것.
#
# 설치: sudo sh pf-orca-tailscale-only.sh
# 제거: sudo sh pf-orca-tailscale-only.sh --revert
set -eu

ANCHOR=/etc/pf.anchors/com.agent.orca
APPLY=/usr/local/sbin/agent-pf-apply.sh
DAEMON=/Library/LaunchDaemons/com.agent.pf-orca.plist
CONF=/etc/pf.conf

[ "$(id -u)" -eq 0 ] || { echo "FATAL: sudo로 실행할 것 — sudo sh $0"; exit 1; }

if [ "${1:-}" = "--revert" ]; then
  echo "== 되돌리는 중 =="
  launchctl bootout system/com.agent.pf-orca 2>/dev/null || true
  rm -f "$DAEMON" "$APPLY" "$ANCHOR"
  sed -i '' '/com\.agent\.orca/d' "$CONF" 2>/dev/null || true
  pfctl -f "$CONF" 2>/dev/null || true
  echo "  제거 완료(pf 자체는 그대로 둔다)"
  exit 0
fi

echo "== 1. 앵커 규칙 =="
cat > "$ANCHOR" <<'EOF'
# Orca 원격 개발 서버(6768) 접근 제한. quick = 첫 매치 결정이므로 허용을 먼저.
pass in quick proto tcp from 127.0.0.0/8 to any port 6768
pass in quick proto tcp from 100.64.0.0/10 to any port 6768
block drop in quick proto tcp from any to any port 6768
EOF
chmod 644 "$ANCHOR"
echo "  $ANCHOR"

echo "== 2. 부팅 시 자가복구 스크립트 =="
# macOS에는 /usr/local/sbin 이 기본으로 없다(Homebrew가 만들기 전엔 부재) — 직접 만든다.
mkdir -p "$(dirname "$APPLY")"
cat > "$APPLY" <<'EOF'
#!/bin/sh
# 부팅마다 실행: pf.conf가 초기화됐으면 앵커 등록을 되살리고, pf를 켜고, 규칙을 로드한다.
CONF=/etc/pf.conf
ANCHOR=/etc/pf.anchors/com.agent.orca
[ -f "$ANCHOR" ] || exit 0
if ! grep -q 'com\.agent\.orca' "$CONF" 2>/dev/null; then
  printf '\nanchor "com.agent.orca"\nload anchor "com.agent.orca" from "%s"\n' "$ANCHOR" >> "$CONF"
fi
pfctl -f "$CONF" >/dev/null 2>&1
pfctl -e >/dev/null 2>&1
exit 0
EOF
chmod 755 "$APPLY"; chown root:wheel "$APPLY"
echo "  $APPLY"

echo "== 3. LaunchDaemon 등록(부팅 시 실행) =="
cat > "$DAEMON" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.agent.pf-orca</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$APPLY</string></array>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>/var/log/agent-pf-orca.log</string>
</dict>
</plist>
EOF
chmod 644 "$DAEMON"; chown root:wheel "$DAEMON"
launchctl bootout system/com.agent.pf-orca 2>/dev/null || true
launchctl bootstrap system "$DAEMON" 2>/dev/null || launchctl load "$DAEMON" 2>/dev/null || true
echo "  $DAEMON"

echo "== 4. 지금 즉시 적용 =="
sh "$APPLY"
pfctl -s info 2>/dev/null | head -1 | sed 's/^/  /'
echo "  앵커 규칙:"
pfctl -a com.agent.orca -s rules 2>/dev/null | sed 's/^/    /'

echo
echo ">>> 완료. 재부팅해도 LaunchDaemon이 다시 적용한다."
echo ">>> 검증은 Claude가 **현재 LAN IP**로 확인한다(IP가 DHCP로 바뀌므로 고정 IP로 검증하면 오탐)."
