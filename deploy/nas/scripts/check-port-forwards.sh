#!/bin/sh
# check-port-forwards.sh — 공유기에 NAS 관리 포트가 다시 열렸는지 감시한다.
#
# 배경(2026-07-27): 공유기(KT HomeHub)에 수동 포트포워딩 3건(22·9999·9443)이 있어
# NAS 관리 UI가 공인망에 노출돼 있었고, nginx 로그에 7/12부터 Censys·Infrawatch 등의
# 실제 스캔이 쌓여 있었다. UPnP DeletePortMapping으로 제거했으나, 첫 삭제 후 9443이
# 곧바로 되살아났다(2회차에 완전 제거) — **무언가가 재등록할 수 있다는 뜻**이라 감시가 필요하다.
#
# 실행: Studio에서. cron/launchd로 걸어도 되고 손으로 돌려도 된다.
# 종료코드 0=깨끗, 1=재노출 감지.
set -u
ROUTER="${ROUTER:-172.30.1.254}"
PORT="${UPNP_PORT:-52869}"

python3 - "$ROUTER" "$PORT" <<'PYEOF'
import re, sys, urllib.request
router, port = sys.argv[1], sys.argv[2]
CTRL = f"http://{router}:{port}/upnp/control/WANIPConnection"
NS = "urn:schemas-upnp-org:service:WANIPConnection:1"
WATCH = {"22", "9999", "9443", "5678", "4000", "3001", "8000"}   # 관리·백본 포트

def soap(action, body):
    env = (f'<?xml version="1.0"?><s:Envelope '
           f'xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
           f's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
           f'<s:Body><u:{action} xmlns:u="{NS}">{body}</u:{action}></s:Body></s:Envelope>')
    req = urllib.request.Request(CTRL, data=env.encode(), headers={
        "Content-Type": 'text/xml; charset="utf-8"', "SOAPAction": f'"{NS}#{action}"'})
    return urllib.request.urlopen(req, timeout=8).read().decode(errors="replace")

bad, total = [], 0
for i in range(80):
    try:
        r = soap("GetGenericPortMappingEntry", f"<NewPortMappingIndex>{i}</NewPortMappingIndex>")
    except Exception:
        break
    total += 1
    g = lambda t: (re.search(rf"<{t}>([^<]*)", r) or [None, ""])[1]
    ext, host, desc = g("NewExternalPort"), g("NewInternalClient"), g("NewPortMappingDescription")
    if ext in WATCH:
        bad.append(f"{g('NewProtocol')} ext:{ext} -> {host}:{g('NewInternalPort')} desc={desc}")

print(f"공유기 매핑 {total}건 검사")
if bad:
    print("🔴 재노출 감지 — 즉시 제거할 것:")
    for b in bad:
        print("   " + b)
    print("   제거: python3 deploy/nas/scripts/upnp-ports.py --delete  (또는 공유기 관리 UI)")
    sys.exit(1)
print("✅ 관리 포트 노출 없음")
PYEOF
