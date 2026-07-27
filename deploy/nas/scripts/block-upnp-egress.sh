#!/bin/sh
# block-upnp-egress.sh — NAS가 공유기 UPnP로 포트를 여는 것을 커널에서 차단한다.
#
# 왜 이 방법인가(2026-07-27 실측 근거):
#  - UGOS 제어판 서비스(root)가 SSH·웹UI 포트를 공유기에 자동 등록해 공인망에 노출시킨다.
#  - 라우터 설정이 아니다(포트포워딩 목록에 없음). upnpd 서비스도 아니다(죽여도 재등록).
#  - 매분 지우는 완화책으로는 부족했다 — 재등록이 더 빨라 4회 관찰 중 1회만 닫혀 있었다.
#  → 등록 요청 자체를 막는다. 공유기 UPnP 제어 포트로 나가는 TCP를 REJECT.
#
# 부작용(알고 적용할 것):
#  - NAS의 Tailscale도 같은 통로로 포트매핑을 시도한다. 막히면 외부에서 NAS로 붙을 때
#    직접 연결 대신 중계(DERP)를 탈 수 있다 — 연결은 되지만 느려질 수 있다.
#    LAN 내부 통신과 NAS에서 나가는 연결에는 영향이 없다.
#  - 근본 해결은 여전히 UGOS 설정을 끄는 것. 그걸 찾으면 이 규칙은 제거해도 된다.
#
# 설치: sudo sh block-upnp-egress.sh --install
# 제거: sudo sh block-upnp-egress.sh --uninstall
# 확인: sudo sh block-upnp-egress.sh --status
set -u

ROUTER="${ROUTER:-172.30.1.254}"
UPNP_PORT="${UPNP_PORT:-52869}"
RULES=/etc/iptables-agent-backbone.rules
BOOT=/usr/local/sbin/ab-apply-fw.sh
CRON=/etc/cron.d/agent-backbone-fw

add_rule() {
  iptables -C OUTPUT -d "$ROUTER" -p tcp --dport "$UPNP_PORT" -j REJECT 2>/dev/null \
    || iptables -I OUTPUT 1 -d "$ROUTER" -p tcp --dport "$UPNP_PORT" -j REJECT
}

case "${1:---status}" in
  --install)
    [ "$(id -u)" -eq 0 ] || { echo "FATAL: sudo 필요"; exit 1; }
    add_rule
    echo "규칙 적용됨"

    # 재부팅 생존: @reboot으로 다시 넣는다(UGOS는 iptables 저장을 보장하지 않는다)
    cat > "$BOOT" <<EOF
#!/bin/sh
# agent-backbone 방화벽 규칙 재적용(부팅 시). block-upnp-egress.sh가 생성.
iptables -C OUTPUT -d $ROUTER -p tcp --dport $UPNP_PORT -j REJECT 2>/dev/null \\
  || iptables -I OUTPUT 1 -d $ROUTER -p tcp --dport $UPNP_PORT -j REJECT
EOF
    chmod 755 "$BOOT"; chown root:root "$BOOT"
    cat > "$CRON" <<EOF
# 부팅 시 방화벽 규칙 재적용(UPnP 자동 포트개방 차단)
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
@reboot root sh $BOOT >/dev/null 2>&1
EOF
    chmod 644 "$CRON"
    echo "부팅 재적용 등록됨: $CRON"
    ;;
  --uninstall)
    [ "$(id -u)" -eq 0 ] || { echo "FATAL: sudo 필요"; exit 1; }
    while iptables -C OUTPUT -d "$ROUTER" -p tcp --dport "$UPNP_PORT" -j REJECT 2>/dev/null; do
      iptables -D OUTPUT -d "$ROUTER" -p tcp --dport "$UPNP_PORT" -j REJECT
    done
    rm -f "$BOOT" "$CRON"
    echo "제거됨"
    ;;
esac

echo "== 현재 규칙 =="
iptables -L OUTPUT -n --line-numbers 2>/dev/null | grep -E "REJECT|Chain|num" | head -4 | sed 's/^/  /'
