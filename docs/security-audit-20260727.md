# 보안·운영 감사 결과와 조치 (2026-07-27)

> 두 개의 독립 감사(보안 태세 / 무인 운영 준비도)가 실측 기반으로 수행됐다.
> 이 문서는 **무엇이 발견됐고, 무엇이 고쳐졌고, 무엇이 남았는지**만 남긴다. 상세 근거는 각 항목의 실측 인용.

## 🔴 사용자만 할 수 있는 것 — 아직 열려 있음

### ✅ 1. NAS 관리 UI 공인망 노출 — **해결됨** (2026-07-27 19:25)

> **처음 진단이 틀렸다.** 라우터의 수동 설정이라고 봤으나, 사용자가 공유기 관리 화면을 열어보니
> 포트포워딩 목록에 **7010/7011/8899 3건뿐**이었다. 추적 결과 원인은 라우터가 아니라 **NAS 자신**이었다.

**추적 경로**:
1. UPnP 매핑을 지우면 외부에서 즉시 `000`(차단)이 되지만 2~3분 뒤 되살아남 — 실측
2. NAS(172.30.1.10) → 공유기 UPnP(52869) 연결을 현장 포착
3. `iptables ... -j LOG --log-uid`로 **UID=0**(root 프로세스) 확정
4. UGOS 로그에서 모듈 특정: `ctl_serv/internal/server/service/filesrv/advanced/upnp.go`
5. `upnpd` 서비스는 범인이 아님 — mask·kill 후에도 재등록(원상복구함)

**적용한 해결**: `block-upnp-egress.sh` — 공유기 UPnP 제어 포트로 나가는 TCP를 REJECT.
등록 요청 자체를 막으므로 어느 프로세스가 시도하든 무효. `@reboot` cron으로 재부팅 생존.

**검증**: 4분 연속 관찰에서 22·9999·9443 전부 외부 `000`.
Tailscale은 **직접 연결 유지**(`active; direct 172.30.1.10:52236`) — 우려했던 중계 강등 없음.
NAS 서비스 전부 정상(n8n 200 · litellm 200 · Kuma 302 · UGOS 400).

> 중간에 매분 매핑을 지우는 완화책도 걸어봤으나 **재등록이 더 빨라 4회 중 1회만 닫혀 있었다** —
> 완화책으로는 부족하다는 실측 근거. 차단 규칙 적용 후 제거함.

**남은 근본 해결(선택)**: UGOS 제어판에서 이 자동 포트개방 기능을 찾아 끄면 차단 규칙 없이도 된다.
찾으면 `block-upnp-egress.sh --uninstall`로 규칙을 빼도 좋다. 지금은 차단만으로 충분히 안전하다.

### ~~1-원안. 라우터 포트포워딩 3건~~ (오진 — 위 항목으로 대체)
UPnP IGD 조회로 확인된 **수동 설정** 매핑(자동 생성분과 달리 사람이 쓴 설명이 붙어 있다):
```
TCP ext:22   → 172.30.1.10:22    desc=ssh
TCP ext:9999 → 172.30.1.10:9999  desc=http     ← UGOS 관리 UI
TCP ext:9443 → 172.30.1.10:9443  desc=https    ← UGOS 관리 UI
```
**실제로 스캔당하는 중이다.** nginx access log(공인 IP 221.148.237.75)에 7/12부터 지속:
Censys(`167.94.146.61`), Infrawatch(`GET /desktop/index.html`, `POST /mcp`), 정체불명 다수(`139.162.3.141` 505건).
로그인 페이지가 200으로 서빙된다.

- tcp/22는 UGOS 방화벽 `UG_SSH_INPUT`이 RFC1918 외 소스를 drop(드롭 카운터 36패킷 = 스캔이 여기 걸린 흔적).
- **9999/9443은 막히지 않는다** — `UG_INPUT` 정책이 ACCEPT.

**조치**: 공유기 관리 페이지에서 3건 삭제. UGOS UI는 Tailscale `100.86.100.119:9999`로 접근.
**왜 최우선인가**: NAS 관리자 = 호스트 root. 이 시스템의 다른 모든 통제(매매 격리·최소권한 롤·RLS)가 이 한 지점 아래에 있다.

### 2. 미니에 실전(live) 증권 키 + 작동하는 주문 도구
`~/agents/.env`: `KIS_APP_KEY`(36) · `KIS_APP_SECRET`(180) · `KIS_ACCOUNT`(11) · `KIS_ENV`=**`live`**
`~/agents/bin/kis-order:152`가 실전 TR 코드를 쓴다 — `TTTC0802U`(매수) / `TTTC0801U`(매도).

미니에서 코드 실행 권한을 얻으면 **가드레일·킬스위치·trade_analyst 롤을 전부 우회**해 실계좌에 주문할 수 있다
(브로커 API를 직접 때리는 경로라 C-5가 개입하지 않는다).
`invest-poll` 자체는 읽기전용 확인됨(`trade_audit.log` 최근 기록 전부 `DRY...PASS`) — 문제는 키의 존재다.

**조치**: 미니 은퇴를 기다리지 말고 **KIS Developers에서 이 앱키를 지금 폐기**.
디스크를 지워도 폐기하지 않은 키는 살아 있다. NAS용은 어차피 모의투자 키를 새로 발급할 계획이다.

### 3. Studio 방화벽 OFF + Orca가 `*:6768`
`socketfilterfw --getglobalstate` → `Firewall is disabled`. NAS에서 LAN 경유 `GET http://172.30.1.82:6768/` → **200**.
보호막은 페어링 코드뿐이고 평문 HTTP/WS다. Orca 자체엔 매매·발행 권한이 없지만,
Studio에서 `ssh nas`(무비밀번호 sudo 전권)와 `ssh mini`(위 실전 KIS 키)가 열려 있어 **SSH 키가 그 경계를 무의미하게 만든다**.
- 대조군: ollama는 `100.65.201.6:11434`에만 바인딩돼 LAN에서 `000` — 이쪽은 잘 돼 있다.

**조치**: 시스템 설정 → 네트워크 → 방화벽 ON.

### 4. (여행 시) macOS 자동 업데이트 대기 + 자동 로그인
26.5.2가 07-22부터 `RecommendedUpdates`에 대기 중, `AutomaticDownload=1`.
자동 로그인이 꺼져 있으면 업데이트 재부팅 후 **로그인 화면에서 멈춰** `gui/$UID` LaunchAgent가 전부 안 뜬다
(ollama·Orca·voicebridge). `pmset autorestart 1`이라 전원 복구 시 켜지긴 하는데 로그인은 안 되는 최악 조합.
→ **사용자가 자동 로그인 ON 예정**(2026-07-27). 그러면 이 항목은 해소된다.

---

## ✅ 이번에 고친 것

| 발견 | 조치 | 검증 |
|---|---|---|
| **compose 디렉토리 777** — root cron이 그 안의 compose를 실행하므로 아무 uid나 `docker-compose.override.yml`을 새로 만들어 privileged 컨테이너를 선언하면 다음 재부팅에 호스트 root(`.env` 600은 무의미) | `755`/`644`로 축소 | `ls -ld` 확인 |
| **restic-rest가 `0.0.0.0:8000`에 무인증** — LAN 아무나 백업 3.9GiB 조회·삭제 가능, n8n 컨테이너에서도 도달(HTTP 노드 하나로 백업 전멸) | 직결링크(`10.10.10.2`) + Tailscale에만 바인딩 | LAN `000` 차단 확인 / 미니 백업 실제 1회 성공(새 스냅샷 + forget·prune 동작) |
| **trading-loop이 `@reboot` 복구 계획 밖** — `ab-boot-up.sh`가 `--profile trading`을 안 줘 dry-run에 매매 엔진이 없음 | `--profile trading` 추가 + `restart: always` | compose 유효성 + 재기동 확인 |
| **litellm `mem_limit 1g`** — 유휴 상태로 이미 60%(619MiB) 사용 | `2g` | 재기동 확인 |
| **sysctl이 레포·백업 어디에도 없음** | `sysctl-99-agent-backbone.conf` 커밋 + `install-cron.sh`가 적용 | 재설치 시 "sysctl 적용됨" |
| **C-6 'MagicDNS로만'이 NAS에서 달성 불가** | 설계 문서를 실측대로 정정(LAN IP 금지 유지, TS IP 허용, 잔여 위험은 복구 런북으로) | NAS/Studio 양쪽 해석 실측 |
| **로컬 티어 상주 미구현**(7차 타임아웃 사고의 근본원인) | `ollama-warmup.sh` + LaunchAgent | 4종 상주 확인 |

---

## ⚠️ 아는 채로 남긴 것

- **백업 디렉토리에 복호화 키가 암호문과 함께 있다**(`n8n_encryption_key.txt` + `env.backup` + `n8n_credentials.enc.json`).
  권한은 정상(700/600 root). **로컬 사본에 한해서는 옳은 설계다** — NAS root가 뚫린 시나리오면 어차피 살아있는 `.env`를 읽으면 되므로 추가 손실이 없다.
  **틀려지는 건 B2로 나가는 순간**: `restic backup "$DEST"`가 통째로 올려 방어선이 RESTIC_PASSWORD 하나가 된다.
  → **B2를 켜기 전에** `env.backup`·`n8n_encryption_key.txt`를 restic 대상에서 제외하고 별도 에스크로할 것.
- **NAS sshd `PasswordAuthentication yes`** + uid 1000 NOPASSWD sudo + `agent`가 docker 그룹.
  현재는 방화벽이 tcp/22를 사설망으로 제한해 LAN 한정이다. 라우터 3건을 지운 뒤 `PasswordAuthentication no`로.
  (키는 이미 동작 중이지만, 잠금 위험이 있어 사용자 확인 후 변경.)
- **매매 인젝션 잔여**: 종목 화이트리스트가 없다. `guardrails.py`의 TODO 그대로.
  오염된 뉴스가 `^[0-9]{6}$`를 만족하는 **임의 KR 종목**을 건당 50만·일 150만까지 사게 할 수 있다.
  오늘은 워크플로 inactive + 입력이 하드코딩 데모 + 브로커 mock이라 악용 불가.
  → **뉴스 노드를 붙이는 커밋과 같은 커밋에** `Limits.allowed_symbols`를 추가할 것.
- **부동 태그 2개**: `restic/rest-server:latest`(실제 이미지 13개월 전 빌드), `tailscale/tailscale:stable`.
  다음 pull에서 조용히 바뀐다. 나머지는 버전 핀, 매매 이미지는 digest 핀.

---

## 잘 돼 있다고 확인된 것 (반증)

- **DB 레벨 권한 분리는 실체다**: n8n이 실제로 `pipeline_runner`/`trade_analyst`로 접속(superuser 아님),
  매매 테이블 접근 `f/f/f/f`, `pg_default_acl` 0행(미래 테이블 자동 부여 없음), public 스키마 CREATE 없음.
- **리드발굴 인젝션 방어가 실제로 작동**: `<<<DATA>>>` 펜싱 + 범위검증(클램프 아님) + 파라미터 바인딩.
  최대 피해 = 쓰레기 리드 1건.
- **견적 워크플로**: 금액은 워크플로가 계산하고 LLM은 인용만 — T1의 "가격 10배 오류"에 대한 직접 방어.
- **n8n에 docker 소켓 마운트 없음**, HTTP 노드 URL이 전부 하드코딩(LLM 출력으로 URL 조립하는 노드 0개).
- **시간 의존성**: 2주 내 만료되는 토큰·인증서 **없음**(Tailscale 최단 만료 2026-11-26). 한국은 DST 없음.
- **디스크**: 무한 증가 항목 없음. n8n execution pruning 기본 ON(14일/10000건) 실측.

---

## 무인 운영의 결론 (2주 시뮬레이션)

인프라는 견고하다 — 재부팅 3회 드릴을 통과한 방어선이 실재하고, 백업은 14일치가 정확히 쌓인다.
**무너지는 건 인프라가 아니라 인프라와 사람 사이의 마지막 1미터다.**

> 이 시스템이 2주간 사용자에게 보낼 메시지는 **정확히 0건**이다.
> Kuma 알림 채널 테이블 0행, `heartbeat.url` 부재(5분 cron이 4,032번 아무것도 안 함), NAS에 MTA 없음.

그 증상은 이미 진행 중이다: 미니 `morning-brief`가 **15일 연속** `ok=False`인데 아무도 몰랐다.

**남은 통보 경로 3개** — 전부 사용자 액션:
1. Kuma에 알림 채널 등록(봇 토큰은 NAS에 이관 완료, 발송 승인 대기)
2. healthchecks.io 체크 → `heartbeat.url` (NAS 자체 다운을 알 유일한 수단)
3. `selfcheck-webhook.url` (주간 자가점검 리포트 전달)
