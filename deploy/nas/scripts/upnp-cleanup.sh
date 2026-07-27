#!/bin/sh
# upnp-cleanup.sh — NAS가 공유기에 자동 등록한 관리 포트 매핑을 지운다(임시 방편).
#
# 배경(2026-07-27 실측): UGOS 제어판 서비스(root)가 공유기 UPnP로 SSH(22)·웹UI(9999/9443)를
# 자동 등록해 NAS 관리 화면이 공인망에 노출된다. 외부에서 실제 도달 확인:
#   삭제 전 9999→307 / 삭제 직후 →000 / 2.5분 후 →307 (재등록)
# 라우터 설정이 아니고(포트포워딩 목록에 없음), upnpd 서비스도 아니다(죽여도 재등록).
#
# ⚠️ 이건 **근본 해결이 아니다.** 근본은 UGOS 제어판에서 해당 기능을 끄는 것.
#    그때까지 노출 창을 실행 주기(기본 1분) 이내로 줄이는 완화책일 뿐이다.
#    설정을 찾아 끈 뒤에는 이 cron을 제거할 것.
#
# 설치(NAS에서): sudo sh upnp-cleanup.sh --install
# 제거:          sudo sh upnp-cleanup.sh --uninstall
set -u

ROUTER="${ROUTER:-172.30.1.254}"
UPNP_PORT="${UPNP_PORT:-52869}"
CRON=/etc/cron.d/agent-upnp-cleanup
SELF=/usr/local/sbin/ab-upnp-cleanup.sh

case "${1:-run}" in
  --install)
    [ "$(id -u)" -eq 0 ] || { echo "FATAL: sudo 필요"; exit 1; }
    cp "$0" "$SELF"; chown root:root "$SELF"; chmod 755 "$SELF"
    cat > "$CRON" <<EOF
# NAS가 자동 등록하는 관리 포트 매핑 제거(임시 완화). 근본 해결은 UGOS 설정.
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
* * * * * root sh $SELF >/dev/null 2>&1
EOF
    chmod 644 "$CRON"
    echo "설치됨: $CRON (매분 실행)"
    exit 0
    ;;
  --uninstall)
    [ "$(id -u)" -eq 0 ] || { echo "FATAL: sudo 필요"; exit 1; }
    rm -f "$CRON" "$SELF"
    echo "제거됨"
    exit 0
    ;;
esac

python3 - "$ROUTER" "$UPNP_PORT" <<'PYEOF'
import re, sys, urllib.request
router, port = sys.argv[1], sys.argv[2]
CTRL = f"http://{router}:{port}/upnp/control/WANIPConnection"
NS = "urn:schemas-upnp-org:service:WANIPConnection:1"
TARGETS = {"22", "9999", "9443"}      # NAS 관리 포트만. 다른 매핑은 절대 건드리지 않는다.

def soap(action, body):
    env = (f'<?xml version="1.0"?><s:Envelope '
           f'xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
           f's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
           f'<s:Body><u:{action} xmlns:u="{NS}">{body}</u:{action}></s:Body></s:Envelope>')
    req = urllib.request.Request(CTRL, data=env.encode(), headers={
        "Content-Type": 'text/xml; charset="utf-8"', "SOAPAction": f'"{NS}#{action}"'})
    return urllib.request.urlopen(req, timeout=8).read().decode(errors="replace")

hits = []
for i in range(80):
    try:
        r = soap("GetGenericPortMappingEntry", f"<NewPortMappingIndex>{i}</NewPortMappingIndex>")
    except Exception:
        break
    g = lambda t: (re.search(rf"<{t}>([^<]*)", r) or [None, ""])[1]
    # 대상: 관리 포트 + 내부 호스트가 NAS 자신 + 자동생성 설명이 아닌 것
    if g("NewExternalPort") in TARGETS and g("NewProtocol").upper() == "TCP" \
       and "miniupnpd" not in g("NewPortMappingDescription") \
       and "tailscale" not in g("NewPortMappingDescription"):
        hits.append((g("NewExternalPort"), g("NewProtocol")))

for ext, proto in hits:
    try:
        soap("DeletePortMapping",
             f"<NewRemoteHost></NewRemoteHost><NewExternalPort>{ext}</NewExternalPort>"
             f"<NewProtocol>{proto}</NewProtocol>")
        print(f"removed {proto} {ext}")
    except Exception as e:
        print(f"failed {proto} {ext}: {e}")
PYEOF
