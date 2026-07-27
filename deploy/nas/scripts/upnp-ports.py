#!/usr/bin/env python3
"""KT 공유기의 포트포워딩 매핑을 열거하고, 지정한 것만 삭제한다.

읽기(열거)는 항상 하고, 삭제는 --delete 를 줬을 때만.
삭제 대상은 **외부 포트 22/9999/9443의 TCP 매핑**으로 한정한다 —
Tailscale·miniupnpd가 만든 자동 매핑은 절대 건드리지 않는다.
"""
import re
import sys
import urllib.request

CTRL = "http://172.30.1.254:52869/upnp/control/WANIPConnection"
NS = "urn:schemas-upnp-org:service:WANIPConnection:1"
TARGETS = {"22", "9999", "9443"}


def soap(action: str, body: str) -> str:
    env = (f'<?xml version="1.0"?>'
           f'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
           f's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
           f'<s:Body><u:{action} xmlns:u="{NS}">{body}</u:{action}></s:Body></s:Envelope>')
    req = urllib.request.Request(CTRL, data=env.encode(), headers={
        "Content-Type": 'text/xml; charset="utf-8"',
        "SOAPAction": f'"{NS}#{action}"'})
    return urllib.request.urlopen(req, timeout=8).read().decode(errors="replace")


def get(i: int):
    try:
        r = soap("GetGenericPortMappingEntry", f"<NewPortMappingIndex>{i}</NewPortMappingIndex>")
    except Exception:
        return None
    f = lambda t: (re.search(rf"<{t}>([^<]*)", r) or [None, ""])[1]
    return {"ext": f("NewExternalPort"), "proto": f("NewProtocol"),
            "int": f("NewInternalPort"), "host": f("NewInternalClient"),
            "desc": f("NewPortMappingDescription"), "enabled": f("NewEnabled")}


def main():
    do_delete = "--delete" in sys.argv
    entries = []
    i = 0
    while i < 80:
        e = get(i)
        if e is None:
            break
        entries.append(e)
        i += 1

    print(f"== 매핑 {len(entries)}건 ==")
    hits = []
    for e in entries:
        mark = ""
        if e["ext"] in TARGETS and e["proto"].upper() == "TCP":
            mark = "  ← 삭제 대상"
            hits.append(e)
        print(f"  {e['proto']:4} ext:{e['ext']:>6} -> {e['host']}:{e['int']:<6} desc={e['desc'][:28]}{mark}")

    if not hits:
        print("\n삭제 대상 없음 — 이미 정리됐거나 UPnP에 안 보이는 정적 설정이다.")
        return 0

    if not do_delete:
        print(f"\n{len(hits)}건이 대상이다. 실제 삭제하려면 --delete 를 붙여 다시 실행.")
        return 0

    print()
    for e in hits:
        try:
            soap("DeletePortMapping",
                 f"<NewRemoteHost></NewRemoteHost>"
                 f"<NewExternalPort>{e['ext']}</NewExternalPort>"
                 f"<NewProtocol>{e['proto']}</NewProtocol>")
            print(f"  삭제 성공: TCP {e['ext']} ({e['desc'][:20]})")
        except Exception as ex:
            print(f"  삭제 실패: TCP {e['ext']} — {ex}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
