# 배포 상태 체크포인트 (2026-07-24 저녁 — 로컬 세션 1차)

> 확정된 실측값 기록(비밀 아님). 이전 체크포인트(07-23)를 대체.

## 확정 값
```
NAS_TS_IP=100.86.100.119
STUDIO_OLLAMA_BASE=http://100.65.201.6:11434
NAS SSH: Studio에서 `ssh nas` (~/.ssh/config 별칭, ed25519 키 등록됨, 무비밀번호 sudo=/etc/sudoers.d/claude-ops)
  ※ 한글 계정명은 명령줄 인용 문제로 반드시 별칭 사용. LAN 172.30.1.10 / TS 100.86.100.119(nas-ts)
NAS 백업 목적지: /volume3/backup/agent-backbone (pool3 = RAID1 미러 [2/2][UU]. pool1·2는 단일 NVMe라 리던던시 0 — 2026-07-25 이전)
NAS 호스트 TZ=KST, Debian 12, docker compose v5.1.3, /etc/cron.d 지원(실발화 확인)
```

## 기기 상태 (Tailscale)
| 기기 | 이름 | IP | 상태 |
|---|---|---|---|
| Mac Studio M3 Ultra 96GB | macstudio | 100.65.201.6 | ✅ 로컬 티어 완성 |
| NAS DXP4800+ 32GB | nas | 100.86.100.119 | ✅ 백본+백업+cron 가동 |
| Mac mini M4 24GB | mini-dashboard | 100.67.146.83 | 이관 대상. **Tailscale SSH 활성**(로컬 계정명 확인 필요) |
| 삼성 노트북 | node | 100.104.71.7 | 접속용 |

## ✅ 완료 (2026-07-24 로컬 세션)
- **HANDOFF #4 백업 3-2-1 로컬 파트**: `/etc/cron.d/agent-backbone` 매일 03:30 KST → `/volume3/backup/agent-backbone/daily/<ts>/`
  - 내용: pg_dump(--create)+글로벌 / n8n 워크플로·크리덴셜(암호화)·런타임설정 / Kuma 데이터 / .env+N8N_ENCRYPTION_KEY 사본 / SHA256SUMS. 14일 보존, 실패 시 보존삭제 스킵.
  - **복원 리허설 통과**: 스크래치 컨테이너에 globals+본덤프 로드, ON_ERROR_STOP 무오류, 테이블 대조 일치, 키 3원(해시) 일치.
  - 스크립트는 `/usr/local/sbin/ab-*.sh`(root 소유) 사본 실행. 수정 시 `install-cron.sh` 재실행 필수.
- **HANDOFF #2 하트비트 인프라**: cron 5분 주기 실발화 확인(16:20 journal). URL 파일만 넣으면 활성:
  `echo '<ping-url>' > ~/agent-backbone/heartbeat.url` · 백업용은 `~/agent-backbone/heartbeat-backup.url`
- **HANDOFF #7**: 컨테이너 7종 전부 `restart:unless-stopped` 확인. 오늘 14:27 부팅에서 구컨테이너 3종 자동복구 실증(백본 4종은 부팅 후 배포라 다음 재부팅 때 최종 확인).
- **★ 스키마 미적용 사고 발견·수복**: 07-23 기록 "스키마 로드"는 오기. 실제로는 init.sql이 UGOS ACL(1000:uucp 770) 탓에 postgres(999)가 못 읽어 **Permission denied → 영구 스킵**된 상태였음. 수동 적용(§3-b)으로 vector 확장+idempotency_keys·expressions·leads·archive+hnsw 인덱스 생성 확인. 파일 644로 수정(재발 방지). **교훈: healthy≠스키마 있음. 복원 리허설이 잡아냄.**
- `.env` 권한 777→600. repo compose를 실배포와 동기화(n8n 호스트포트 5679).

## ✅ 추가 완료 (같은 날 저녁 2차)
- **HANDOFF #5 종결**: 구 n8n(6/10 gateway 실험, 워크플로 0, 7/2 이후 미사용) **사용자 승인 후 제거**. 볼륨 `n8n_n8n_data` 보존. 백본 n8n **5678 복귀** — TS 전용 5678 OPEN·200, 5679/LAN closed 검증. ⚠️ Kuma의 n8n 모니터 URL 5679→5678 수정 필요(GUI).
- **HANDOFF #6 종결**: 미니 하드코딩 감사 완료 → `docs/mini-hardcoding-audit.md`. 미니 접근=Tailscale SSH `ssh agent@100.67.146.83`(무비밀번호). 핵심: plist 45개 IP 제로 / machines.json의 NAS lan_ip가 오늘 또 어긋남(.25→실제 .10, DHCP 드리프트 재실증) / voicebridge는 하드코딩 없어 이식 용이 / 외부 코드루트 3곳(agent-config·papercraft-studio·voicebridge)도 깨끗.
- **변경 후 스모크**: litellm classify-fast → Studio qwen "파란색" 응답 — 오늘 모든 변경 후에도 라우팅 정상.

## ✅ 5차 (2026-07-24 — Orca 원격 개발 서버)
- **목표**: Studio를 상시 "원격 Orca 서버"로 → Windows(100.104.71.7)·폰이 Tailscale로 붙어 조종, 노트북 닫아도 세션이 Studio에서 지속. (원리는 `docs/remote-dev-guide.md`의 tmux와 동일: 세션이 Studio에 상주.)
- **설치**: `brew install --cask stablyai/orca/orca` → `/Applications/Orca.app` + CLI `/opt/homebrew/bin/orca`(v1.4.152). `orca serve`가 **macOS에서 headless 지원됨**(C-1 경로).
- **상시 가동**: LaunchAgent `com.orca.serve`(gui/$UID, KeepAlive+RunAtLoad). 실측 검증: serve PID `kill -9` → launchd ~2초 재기동(runs=2). 소스는 repo `deploy/studio/`(plist·`orca-serve-setup.sh` 멱등 재설치·`orca-mobile-pair.sh` 폰 QR). 로그 `~/Library/Logs/orca-serve.log`.
- **엔드포인트**: `ws://100.65.201.6:6768`(Tailscale, port 6768). 바인드는 0.0.0.0:6768이나 페어링 신뢰모델로 보호 — **라우터 6768 포워딩 금지**(C-6). 페어링 코드(`orca://pair?code=…`)는 **비밀**→repo 미기록. 취득: `grep 'Pairing URL:' ~/Library/Logs/orca-serve.log`.
- **핵심 실측 2건**: (1) 서버 identity 공개키(`publicKeyB64`)가 재시작 후 **불변**(userData 영속) → 한 번 페어링한 Windows·폰은 launchd 재시작 후에도 신뢰 유지. (2) 단일 인스턴스 락 → `orca serve`는 동시 1개뿐 → persistent는 **runtime scope**(Windows 데스크톱 + 브라우저 웹클라이언트 `http://100.65.201.6:6768/web-index.html#pairing=…`). 폰 네이티브 앱 mobile-scope QR은 `orca-mobile-pair.sh`가 서버를 잠깐 바꿔치기해 발급(동일 서버 identity).
- **폰 앱 설치 출처(페어링 링크 ≠ 설치 링크)**: iOS App Store `apps.apple.com/app/orca-ide/id6766130217`(또는 TestFlight `testflight.apple.com/join/YjeGMQBA`) · Android APK는 GitHub 릴리스 `stablyai/orca` 태그 `mobile-android-v*`(현재 v0.0.32). 순서=앱 설치 → 앱에서 Pair → `orca-mobile-pair.sh`의 QR 스캔. 브라우저만 쓸 거면 웹클라이언트 URL은 설치 없이 바로.
- **선점 정리**: 기동 시 quarantine된 옛 Orca.app이 **App Translocation** 경로에서 락 점유 중 → 빈 인스턴스(워크트리·레포·환경 0) 확인 후 종료. brew본이 정상본.
- **하드닝**: `pmset` 이미 sleep 0·disksleep 0·standby 0(24/7 충족). ⚠️ **자동 로그인 OFF** → 재부팅 시 GUI 로그인 전엔 LaunchAgent 미기동. 무인 재부팅 복구 원하면 시스템 설정>사용자 및 그룹>자동 로그인 ON(사용자 GUI, 보안 트레이드오프).
- **경계 준수**: Orca=개발 세션 오케스트레이터(무인 자동화 백본 아님, 그건 n8n@NAS). 매매·발행 권한 미부여.
- **⚠️ 정정(같은 날 — 모델 전환 A)**: 한 맥에서 **headless `serve`(LaunchAgent)와 데스크톱 GUI 앱은 단일 인스턴스 락 때문에 공존 불가**. 사용자가 맥 GUI를 열자 앱이 서버가 되고(모바일 페어링 포함, 폰 z-fold7 연결됨), 내 LaunchAgent는 10초마다 락 충돌로 종료→KeepAlive 재기동을 반복(runs 131)하며 **매번 Orca 창을 앞으로 소환**("자꾸 켜짐"). → `com.orca.serve` **bootout+disable+plist를 `.disabled`로 이동**(레포 `deploy/studio/` 정본 사본 유지, 재설치는 `orca-serve-setup.sh`). **현 서버 모델=데스크톱 앱(Model A)**: 앱을 열어둬야 상시, 재부팅 복구는 로그인 항목+자동로그인 필요. 순수 headless(Model B)로 되돌리려면 데스크톱 앱을 닫고 setup 스크립트로 LaunchAgent 재설치. **둘 중 하나만 가능**.
- **레포 전체 등록(같은 날)**: brekarta-stack GitHub **19개 전부** 맥 클론+Orca `repo add`. 기존 2개(`~/acw`=actioncraft-web, `~/voicebridge`)는 제자리, 나머지 **17개는 `~/repos/<name>`에 신규 클론**(gh=brekarta-stack). `orca repo list`=19 확인, worktree=레포 base 19(에이전트 실행 0). ⚠️ Orca 등록≠GitHub 자동 pull(최신화는 git pull/push 그대로). gh 클론은 **포그라운드에서만**(detached bg는 keychain 접근 불가→gh 인증 실패). 등록분: agent-avatars·agent-config·agents·axforge·claude-setup·company-data-hub·hermes-bot·impact-ledger·papercraft·papercraft-studio·papercraft-studio-app·proof-app·proof-market·region-ip-orchestrator·stage-website·yugyo-orchestrator·yugyo-trend-radar (+acw·voicebridge).

## 🔍 잔여 관찰
- **restic-rest 컨테이너**(0.0.0.0:8000, 인증 OFF): gateway 산물이지만 **현역** — 미니가 매일 03:30 스냅샷 푸시(3.6G). 미니 이관 완료 전 중단 금지. 인증 없음+LAN 노출은 이관 때 정리.
- 미니 heartbeat의 Slack 알림 7/23부터 실패(rc=56) — slackbot 비활성화 여파. 은퇴 경로라 수리 불요.
- 미니 machines.json의 "ultra 은퇴" 기록은 구시대 정보 — 이관 시 machines.json 전면 재작성 권장.

## ✅ 3차 (같은 날 — 클라우드 티어 활성화)
- **HANDOFF #3 종결**: ANTHROPIC(108ch)·MOONSHOT(51ch) 키 `.env` 반영(파일 경유, 채팅/로그 미노출) → litellm 재생성.
  - **검증**: write-ko-final→"Anthropic의 Claude"(직접 API 교차검증 포함) · kimi-cheap→"Moonshot AI의 Kimi".
  - **폴백 드릴 실증**: Studio ollama 정지 → classify-fast가 `kimi-cheap`으로 자동 강등(fallbacks:1) → ollama 복구 → 로컬 복귀(fallbacks:0). 무중단 체계 왕복 확인.
  - **예산 가드**: 가상 키 `n8n-ops`($25/30d) 발급 — `~/agent-backbone/n8n-litellm-key.txt`(600). n8n 워크플로는 master key 대신 이 키 사용.
  - ⚠️ OPENAI 키는 복사 시 앞부분(`sk-proj-` 등) 누락으로 형식 불일치 → 미설치. gpt-frontier 폴백은 그때까지 비활성(프런티어 폴백은 anthropic 상호간 아님 주의).
  - 📝 운영 주의 2건: kimi-k2.6은 추론형 — **max_tokens 작으면 content 빈 응답**(reasoning 소진). litellm 재기동 직후 첫 응답에서 1회 오식별 관찰(재현 안 됨, 웜업 추정).

## ✅ 4차 (같은 날 — 재부팅 검증 3회로 부팅 순서 결함 발견·수복)
- **재부팅 #1이 진짜 버그 적발**: TS IP(100.86.100.119)에 바인딩하는 3종(n8n·litellm·kuma)이 부팅 시
  tailscale 컨테이너보다 먼저 복원 시도 → `cannot assign requested address` → **재시도 없이 사망**.
  (postgres=포트없음·tailscale=host·restic=0.0.0.0만 생존. `restart: always`만으로는 불충분 — 재부팅 #2로 확인.)
- **수정(이중 방어)**: ① `/etc/sysctl.d/99-agent-backbone.conf` → `ip_nonlocal_bind=1`(v4/v6)
  ② cron `@reboot` → `ab-boot-up.sh`(docker·TS IP 대기 후 compose up 3회 재시도, 로그 `/var/log/agent-backbone-boot.log` — /volume2 리다이렉트는 마운트 전에 죽는 것도 실측·수정) ③ compose `restart: always`.
- **재부팅 #3 완전 통과**: 부팅 직후 6/6 자동복구 + 2차 방어선 "compose up OK" + cron 생존 + TS 포트 3종 OPEN + e2e 라우팅("GREEN").
- **OPENAI 키**: TextEdit 사고로 뒤섞인 것을 확정 재구성(`sk-proj-`+몸통)해 설치, 인증 통과 확인. 단 **계정 크레딧 0 → 쿼터 오류** — 충전 전까지 gpt-frontier 비활성.

## ⬜ 남은 것 — [사람] 필요 (2026-07-25 기준 최신)
1. **도메인 게이트 3문항** — `docs/domain-definition-DRAFT.md` 말미. 답하면 D10~14 전부 착수 가능.
2. **healthchecks.io** 가입 → 체크 2개 → NAS의 `heartbeat.url`·`heartbeat-backup.url`에 기록.
   (cron은 이미 5분마다 돌고 URL만 기다린다. **NAS 자체 다운을 알 유일한 수단**)
3. **Kuma에 Slack 웹훅** 등록 → 5모니터 연결. *지금은 빨간불이 떠도 아무도 안 부른다.*
4. **B2 계정** → `restic.env`(root:600) → 오프사이트 활성. RESTIC_PASSWORD는 NAS 밖 에스크로 필수.
   *현재 3-2-1이 아니라 로컬 사본뿐 — NAS 전손 시 전부 소실.*
5. **USB 마이크 → Studio** → `deploy/studio/voicebridge-cutover.md`(10분) → 어학 가동.
6. **KIS 모의투자 appkey** → `.env` → KISBroker 구현 착수. *자동화 세션은 증권 자격증명 비취급.*
7. (선택) **OpenAI 크레딧 충전** — 키는 유효, 잔액 0이라 429.

## ✅ 6차 (2026-07-24 밤 — Track B 무관 3종 착수·골격 완성)
- **D8 어학 (voicebridge 이식)**: 미니 `~/voicebridge` → Studio(코드+모델 350M, 시크릿 無), uv 신규 설치 + `uv sync` venv 재구축. 기동 체인이 "입력장치 탐색"까지 검증됨 — **Studio에 마이크 0개**(내장 없음)라 여기가 자동화 한계. plist 설치(bootstrap 안 함), 커트오버 절차=`deploy/studio/voicebridge-cutover.md`(USB 마이크 이동→TCC 승인→bootstrap→그후 미니 정지). 미니 인스턴스는 유지 중(대체 검증 전 중단 금지).
- **D7 매매 (결정적 엔진 스켈레톤)**: `deploy/nas/trading/` → NAS 컨테이너 빌드(GD-1 격리, 포트 0, profiles=trading 기본 미기동).
  - 구성: 상태머신(불법전이 차단)·가드레일(명목가 상한/일손실한도/시장 화이트리스트/**킬스위치** /data/KILL)·멱등성(공용 idempotency_keys check-then-act, GD-2)·토큰버킷 20/s·MockBroker.
  - 테이블 3종 적용(trade_proposals/trade_orders/trade_daily_pnl).
  - **셀프테스트 4/4 통과(NAS 실DB)**: 왕복 체결 MOCK-000001 / 멱등 재처리=duplicate(재발사 0) / 한도초과=REJECTED / 킬스위치=REJECTED.
  - KIS 연결(D10+)은 사용자 자격증명 발급 후 — 절차 `deploy/nas/trading/README.md`. 자동화 세션은 증권 자격증명 비취급.
- **D6 업무·일정 (n8n 골격)**: CLI로 크레덴셜(litellmkey000001=n8n-ops 키, NAS 안에서만 생성)+워크플로 2종 주입.
  - `tbsmoke000000001` 스모크: **실행 성공 — n8n→LiteLLM(n8n-ops 예산키)→Studio qwen "연결됨"** 응답 실증.
  - `tbbrief000000001` 아침 브리핑(08:30 KST, inactive): 일정 placeholder→LiteLLM 요약(동작)→Slack noOp. Google Calendar OAuth+Slack 연결 후 노드 교체→Active(스티키노트에 절차).
  - 운영 메모: n8n 2.x CLI `execute`는 브로커포트 충돌 → `-e N8N_RUNNERS_BROKER_PORT=5699`로 실행.

## ✅ 7차 (2026-07-24 밤 — 매매엔진 적대리뷰 반영 + LiteLLM 타임아웃 결함 수복)
- **매매엔진 v2 (리뷰 HIGH 3 + MED/LOW 반영)**: NaN/Infinity 이중 차단(DB CHECK+isfinite — NaN이 전 가드레일 관통하던 구멍) · FILLED가 trade_daily_pnl UPSERT(일손실한도 공회전 수복, KST 날짜 명시) · selftest가 운영자 킬스위치 존중(가동 중=exit 2 거부) · 킬스위치 fail-closed(상태 불명=차단) · client_key 의도-단위 멱등(제안 재시도 중복 차단) · 전이필드 화이트리스트 · 브로커 예외→FAILED(+RECONCILE 표식) · stale 스윕 · trade_analyst 최소권한 롤 · 스키마 자동적용 · 비루트 컨테이너+digest 핀. **셀프테스트 9/9 통과(NAS 실DB)**.
  - 남긴 것(KIS 단계, 코드/문서에 표식): SUBMITTED↔KIS 대사, advisory lock 단일화, Decimal 전달, 롤 LOGIN 부여.
  - 스키마 리셋이 공유 idempotency_keys의 trade 키와 충돌하는 것도 실측·수정(리셋 시 kind=trade 정리).
- **★ LiteLLM 라우터 타임아웃 결함**: `timeout: 20`이 35B 콜드로드에도, **추론형 kimi 폴백에도 부족** → write 계열이 폴백 포함 전멸(브리핑 500으로 적발). **120s로 상향** + Studio 모델 4종 재상주(폴백 드릴의 ollama 재시작이 언로드시켰던 것). write-ko-draft 재검증 통과.
- **아침 브리핑 E2E 성공**: 트리거→일정(placeholder)→LiteLLM(로컬 35B)→3줄 한국어 브리핑 생성 확인. Slack/Calendar 연결만 남음(inactive).
- **자산 회수(미니→레포)**: `deploy/pipelines/assets/`(sns_lines.json·learning.json — 파트정의 직접 재료) · `deploy/nas/trading/reference/`(kis-balance·kis-order·invest 2종 — 시크릿 無 확인). 미니 소멸 대비 확보.

## ✅ 8차 (2026-07-25 — C-5 매매 루프 E2E 완성 + Kuma 정상화)
- **★ C-5 전체 루프 실증**: n8n 분석가(LiteLLM `analyst-trading`=Claude) → 구조화 JSON → `trade_analyst` 롤로 제안 INSERT → 격리 엔진이 집기(SKIP LOCKED) → 가드레일 → MockBroker 체결.
  실측 결과: 제안 `analyst:2026-07-25:005930:buy` → 주문 FILLED(4주 @70,000, MOCK-000001), 손익 행 생성.
  **의도-단위 멱등 실증**: 같은 날 분석가 재실행 → ON CONFLICT로 제안 재삽입 0 → 주문도 1건 유지.
- **최소권한 DB 실증(네거티브 테스트)**: `trade_analyst`는 제안 INSERT/SELECT만 성공, **trade_orders·idempotency_keys·trade_daily_pnl은 전부 permission denied**. n8n이 침해돼도 주문 불가가 DB로 강제됨. 비밀번호는 NAS `.env`에서 생성·보관(채팅/로그 미노출).
- **엔진 상시 루프**(`trading-loop`, profile=trading): PG advisory lock 단일 인스턴스 · `FOR UPDATE SKIP LOCKED` 제안 집기 · 부팅 스윕 · SIGTERM 우아한 정지.
- **드릴이 잡은 결함 2건**: ① HALT를 `exit`으로 처리해 **재시작 루프** 발생 → "살아있되 주문 안 함"으로 변경(매 사이클 재확인 → 대사 끝나면 자동 재개) ② **셀프테스트 산출물(RECONCILE_NEEDED)이 엔진을 영구 HALT** → 테스트가 자기 산출물 정리 + 가동 중 셀프테스트는 advisory lock으로 거부(스키마 DROP이 실주문을 날리는 것 방지).
- **Kuma 정상화**: n8n 모니터가 죽은 포트(5679)를 보고 있던 것 수정 → **3모니터 전부 200 OK**. (수정 중 SQLite 파라미터 해석으로 URL이 잠시 비워진 것 즉시 복구, kuma.db 백업 후 작업.)
- **문서**: `docs/where-things-run.md` — "이 자동화는 어디서 도는가/어디서 보는가" 지도(n8n vs cron vs 격리 컨테이너).

## ✅ 9차 (2026-07-25 밤 — 공용 플로우 3종 완성 + 2차 리뷰 반영 + 관측 폐쇄)
- **복원 리허설 전 항목 통과**: 체크섬·덤프 무오류·테이블 188개 일치·**크레덴셜 실복호화**(백업 키로 스크래치 n8n 기동 → 워크플로 실행 성공)·Kuma 아카이브. 스크립트=`deploy/nas/scripts/restore-rehearsal.sh`.
- **도메인 게이트 사전작성**: 미니 설정에서 뽑은 증거 기반 초안(`docs/domain-definition-DRAFT.md`, `channel-reorg-DRAFT.md`). 실제 운영 라인이 4개(3사업+개인브랜드)뿐임을 확인 → 사용자 몫이 **3문항**으로 축소.
- **D5 공용 골격 + 플로우 3종**: `part_definitions` 테이블 × 워크플로 1개. lead-gen(스코어링·중복방지)·blog(로컬 초안→**프런티어 퇴고**)·quote(**금액은 워크플로가 계산, LLM은 인용만** — T1의 10배 오류 대응). 전부 E2E 성공.
  **N>1 fan-out 검증**: 파트 2개 동시 활성 → 각각 순회, 리드 귀속 정확.
- **★ 로컬 추론모델 결함(86배 낭비)**: `qwen3.6:35b-a3b`가 추론형이라 `think`를 안 끄면 max_tokens 안에서 **본문을 한 글자도 못 낸다**(3000토큰에도 빈 응답). 무제한이면 같은 출력에 7092토큰(≈85초). LiteLLM 게이트에 `think:false` → 82토큰(1초). `classify-fast`·`code-fast`는 비추론형(실측).
- **2차 적대 리뷰 반영**: [Critical] RLS가 kind만 봐서 `kind='publish'`+`key='trade:…'`로 **매매를 조용히 멈출 수 있던 경로** → `key LIKE kind||':%'` 강제(공격 차단 실증). [High] 스코어 파싱 fail-open(`"8점 만점"`이 1.0으로 통과) → 범위검증. [Med] 백업에 **SSOT YAML·워크플로·compose·매매 코드가 통째로 빠져 있던 것** → `compose_config.tar.gz` 추가. 그 외 트랜잭션 래핑·재귀 병합·prune 옵트인·dedup 키 재설계 등 15건.
- **권한 분리 실증**: 크레덴셜 감사 워크플로로 n8n이 실제 `pipeline_runner`/`trade_analyst`로 접속(superuser 아님, trade 키 0개 조회) 확인 — 장식이 아님.
- **관측 폐쇄**: Kuma **5모니터**(+trading-loop push, +mini-alive). 매매 루프는 active일 때만 핑 → 킬스위치 ON 시 `No heartbeat`(적) → OFF 시 `OK`(녹) 왕복 실증. "Up이지만 정지"를 잡는 유일한 수단.
- **미니 이관 1단계**: `docs/mini-migration-map.md`(34잡 대조·8단계 순서). Kuma에 미니 감시 세운 뒤 관제 잡 4종 OFF(가치 0 — Slack 알림이 7/23부터 실패 중이었다). 로드 잡 33→29.
- **주간 자가점검 이식**: `weekly-selfcheck.sh`(월 09:00 cron). 미니 자기점검 루프를 신 아키텍처용으로 축소 — 읽기전용·제안만. 첫 실행이 오프사이트 백업·외부 하트비트·비활성 워크플로 7개를 정확히 짚음.
- **RAG 토대 검증**: `embed`(bge-m3 1024차원) → `archive` 적재 → 코사인 검색 정확(관련 0.73 vs 무관 0.34).
- n8n 실패 실행 4건은 전부 위에서 수정한 결함의 과거 기록이며, 각 워크플로의 **최신 실행은 모두 성공**.

## ⬜ UGOS 업데이트 후 생존 확인 3종
`/etc/cron.d/agent-backbone` · `/etc/sysctl.d/99-agent-backbone.conf` · `/usr/local/sbin/ab-*.sh` (없어졌으면 install-cron.sh 재실행 + sysctl 재적용)
