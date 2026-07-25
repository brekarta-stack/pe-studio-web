# 인수인계 — 다음 세션용 (2026-07-25 갱신)

> **현재 상태의 SSOT는 `deploy/STATE.md`** (세션 1~8차 로그). 이 문서는 "다음에 뭘 하나"만 다룬다.
> 설계 마스터는 `docs/CLAUDE.md`(불변원칙·C-1~C-8·안티패턴). 관측 지도는 `docs/where-things-run.md`.

## 접근 정보
- **NAS**: `ssh nas` (별칭 필수 — 한글 계정명이라 직접 `user@host` 쓰면 깨진다). `sudo -n` 무비밀번호.
  배포 폴더 `~/agent-backbone`. LAN 172.30.1.10 / Tailscale `nas-ts`(100.86.100.119).
- **미니**: `ssh agent@100.67.146.83` (Tailscale SSH, 키·비번 불요). 은퇴 예정.
- **Studio**: 로컬. ollama 4모델 상주, voicebridge 이식됨(마이크 미연결).
- **git**: `brekarta-stack/actioncraft-web`, 브랜치 `claude/mac-agent-subscription-comparison-5vFfQ`.

## 완료된 것 (요약 — 상세는 STATE.md)
- **Track A 인프라 완주**: 백본 4종 + 매매 엔진 격리 컨테이너, 재부팅 3회 드릴로 부팅 순서 결함 수복,
  백업 3-2-1 로컬 + **복원 리허설 전 항목 통과**(크레덴셜 복호화까지 실증), 클라우드 티어 + 폴백 드릴,
  Kuma 3모니터 그린.
- **Track B 무관 3종**: 업무·일정(아침 브리핑 E2E), 매매(C-5 전체 루프 E2E, 셀프테스트 13/13),
  어학(voicebridge 이식 — 마이크만 남음).
- **D5 공용 골격**: 파트 정의 테이블 × 워크플로 1개(리드발굴 실동작, 중복 0 실측).
- **게이트 사전작성**: `docs/domain-definition-DRAFT.md`, `docs/channel-reorg-DRAFT.md` —
  미니 설정에서 뽑은 증거 기반 초안. 사용자 몫이 3개 질문으로 축소됨.

## 남은 작업

### 🔴 [사람] 이것만 하면 대부분 풀린다
1. **도메인 게이트 3문항** — `docs/domain-definition-DRAFT.md` 말미:
   ① biz-b는 견적 사업인가 제안서 사업인가 ② biz-b/c 우선순위 ③ 분기 목표 숫자(모르면 제안값 유지).
   → 답하면 D10~14(리드→블로그→견적 / SNS / 학습 / 영상) 전부 착수 가능.
2. **healthchecks.io 가입** → 체크 2개 → NAS의 `heartbeat.url`·`heartbeat-backup.url`에 기록.
   (cron은 이미 5분마다 돌고 있고 URL만 기다린다.)
3. **Kuma에 Slack 웹훅** 등록(#agent-log) → 3모니터 연결. GUI 작업.
4. **USB 마이크를 Studio로 이동** → `deploy/studio/voicebridge-cutover.md` 절차(10분) → 어학 가동.
5. **B2 계정** → `restic.env`(root:600) → 오프사이트 백업 자동 활성. RESTIC_PASSWORD는 NAS 밖 에스크로 필수.
6. **KIS 모의투자 appkey** 발급 → `.env` → KISBroker 구현 착수(D10+). *자동화 세션은 증권 자격증명을 다루지 않는다.*
7. (선택) **OpenAI 크레딧 충전** — 키는 설치됐고 잔액 0이라 429. 충전 즉시 gpt-frontier 폴백 활성.

### 🟡 [자동] 게이트 후 바로 가능
- `part-definitions.yaml`에 biz-b/c 채우고 `sh pipelines/sync-parts.sh` → `active: true`
- 리드발굴 워크플로의 "수집(데모)" 노드 → 네이버 검색 API/구글 뉴스로 교체
- blog·quote 공용 워크플로 2종 추가(같은 파트 테이블 순회 패턴)
- 학습 파이프라인: `archive` 테이블 + bge-m3 임베딩 + 퀴즈 루프(간격 1·3·7·16·35·90 이관)

### 🟢 [자동] 게이트와 무관
- **미니 40잡 이관**: `docs/mini-hardcoding-audit.md`의 교체 목록대로. 순서 = 신 플로우 검증 → 구 잡 OFF → 제거.
  ⚠️ `restic-rest` 컨테이너는 미니 백업 수신 중(현역) — 이관 완료 전 중단 금지.
- **Kuma에 trading-loop 감시 추가**: `.env`의 `TRADE_HEARTBEAT_URL`에 Kuma push URL 넣기(모니터 생성은 GUI).
- 매매 KIS 단계: `deploy/nas/trading/README.md`의 필수 구현 목록(토큰 앵커·웹소켓·세션 캘린더·대사).

## 불변 원칙 (위반 금지 — docs/CLAUDE.md)
멀티모델(탈클로드) · 운영은 API/로컬 무중단 · **LLM 직접 주문권한 금지** · 2주·초보 제약 ·
과잉설계 금지 · **대체 검증 전 삭제 금지**("켜기 전에 끈다") · 대외 산출물=프런티어 고정 ·
기기 참조는 MagicDNS(IP 하드코딩 금지).

## 작업 방식 (이 프로젝트의 습관)
- 마일스톤마다 **적대적 리뷰**를 걸고 발견을 수정한 뒤 다음으로 간다. 실제로 이 습관이
  스키마 미적용·부팅 순서 결함·NaN 가드레일 관통·인젝션 dedup 우회를 잡아냈다.
- **문서의 "완료" 주장을 의심하라** — 07-23의 "스키마 로드됨"이 거짓이었던 전례가 있다. 실행해서 확인할 것.
- 사용자에게 터미널 작업을 부탁할 땐 스크립트 파일 + 한 줄 실행으로(긴 원라이너는 복사 과정에서 깨진다).

## 세션 종료 시
`deploy/STATE.md` 갱신 + 커밋·푸시. 설계 변경은 `docs/CLAUDE.md`에도 반영.
