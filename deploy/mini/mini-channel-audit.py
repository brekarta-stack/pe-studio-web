#!/usr/bin/env python3
"""미니 잡들이 하드코딩한 Slack 채널이 실제로 존재하는지 전수 대조한다.

왜: morning-brief가 최소 18일간 매일 실패했는데 아무도 몰랐다.
    원인은 채널 이름 변경(#daily-brief-아침브리핑 → 없음). 같은 함정이 다른 잡에도 있을 것이다.
채널 이름은 바뀌지만 ID는 안 바뀐다 — 이 감사의 결론은 "이름 쓰지 말고 ID 써라"다.
"""
import json
import os
import pathlib
import re
import urllib.request

ROOT = pathlib.Path.home() / "agents"
env = {}
for line in (ROOT / ".env").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("\"'")
TOKEN = env.get("SLACK_BOT_TOKEN") or os.environ.get("SLACK_BOT_TOKEN", "")


def api(method, params=""):
    req = urllib.request.Request(
        f"https://slack.com/api/{method}?{params}",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read())


chans, cursor = {}, ""
while True:
    d = api("conversations.list", f"limit=200&types=public_channel,private_channel&cursor={cursor}")
    if not d.get("ok"):
        print("채널 조회 실패:", d.get("error"))
        raise SystemExit(1)
    for c in d["channels"]:
        chans[c["name"]] = (c["id"], c.get("is_member"), c.get("is_archived"))
    cursor = d.get("response_metadata", {}).get("next_cursor") or ""
    if not cursor:
        break
print(f"워크스페이스 채널 {len(chans)}개 로드\n")

# bin/ 안의 모든 실행 파일에서 "#채널명" 리터럴을 뽑는다.
pat = re.compile(r'["\']#([\w가-힣.\-]+)["\']')
findings, ok_n, bad_n = {}, 0, 0
for f in sorted((ROOT / "bin").iterdir()):
    if not f.is_file() or f.suffix in (".pyc",):
        continue
    try:
        txt = f.read_text(errors="ignore")
    except Exception:
        continue
    for name in sorted(set(pat.findall(txt))):
        findings.setdefault(f.name, set()).add(name)

for job, names in sorted(findings.items()):
    rows = []
    for n in sorted(names):
        if n in chans:
            cid, mem, arch = chans[n]
            if arch:
                rows.append(("ARCHIVED", n, f"{cid} — 보관된 채널이라 발송 실패")); bad_n += 1
            elif not mem:
                rows.append(("NOT-MEMBER", n, f"{cid} — 봇 미참여, not_in_channel")); bad_n += 1
            else:
                rows.append(("OK", n, cid)); ok_n += 1
        else:
            rows.append(("MISSING", n, "그런 채널 없음 → channel_not_found")); bad_n += 1
    if any(r[0] != "OK" for r in rows):
        print(f"■ {job}")
        for st, n, note in rows:
            mark = "  ✅" if st == "OK" else "  ❌"
            print(f"{mark} {st:<11} #{n:<26} {note}")
        print()

print(f"요약: 정상 {ok_n} · 깨짐 {bad_n}")
