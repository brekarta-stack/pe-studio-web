# 인수인계 — 다음 세션용 (2026-07-25 밤 갱신)

> **현재 상태의 SSOT는 `deploy/STATE.md`**(세션 1~9차 로그). 이 문서는 "다음에 뭘 하나"만 다룬다.
> 설계 마스터 `docs/CLAUDE.md` · 관측 지도 `docs/where-things-run.md` · 미니 이관 `docs/mini-migration-map.md`.
>
> **첫 명령**: `ssh nas 'cd ~/agent-backbone && sh scripts/smoke-all.sh'` — 24항목이 통과하면 시스템은 정상이다.

## 접근 정보
- **NAS**: `ssh nas` (별칭 필수 — 한글 계정명). `sudo -n` 무비밀번호. 배포 폴더 `~/agent-backbone`.
- **미니**: `ssh agent@100.67.146.83` (Tailscale SSH). 은퇴 진행 중(관제 잡 4종 OFF 완료).
- **Studio**: 로컬. ollama 4모델, voicebridge 이식됨(마이크 대기).
- **git**: `brekarta-stack/actioncraft-web`, 브랜치 `claude/mac-agent-subscription-comparison-5vFfQ`.

## 지금 돌아가는 것

| 계층 | 상태 |
|---|---|
| 백본 5컨테이너 | 가동(재부팅 3회 드릴 통과, `@reboot` 이중 방어) |
| 백업 | 매일 03:30, **복원 리허설 전 항목 통과**(크레덴셜 실복호화 포함) |
| 관제 | Kuma 5모니터 그린(+매매 push, +미니) · 주간 자가점검(월 09:00) |
| 모델 | 로컬 4 + Claude/Kimi. 폴백 드릴 왕복 검증. **추론형 `think:false`(86배 절감)** |
| 매매 | 격리 엔진 상시 가동, 셀프테스트 13/13, C-5 루프 E2E(mock) |
| 파이프라인 | 파트 테이블 × 워크플로 4종(lead-gen·blog·quote·학습) 전부 E2E 성공 |
| 권한 | DB 롤 3분리, 네거티브 테스트로 실증(RLS 포함) |

⚠️ **n8n 워크플로 8종은 전부 inactive**다. placeholder(수집·Slack·발행)를 실물로 바꾸기 전엔
켜도 무의미하거나 비용만 든다 — 의도된 상태다.

## 남은 작업

### 🔴 [사람] 이 7개가 전부다
1. ~~도메인 게이트 3문항~~ ✅ **2026-07-28 통과** — 확정본 `docs/domain-definition.md`.
   (구 초안 `domain-definition-DRAFT.md`는 이력용으로만 남긴다.)
   ① biz-b는 견적 사업인가 제안서 사업인가 ② biz-b/c 우선순위 ③ 분기 목표 숫자(모르면 제안값 유지).
   → 답하면 D10~14 전부 착수 가능. *증거 기반으로 미리 채워뒀으니 확인·수정만 하면 된다.*
2. **healthchecks.io 가입** → 체크 2개 → `~/agent-backbone/heartbeat.url`·`heartbeat-backup.url`.
   *NAS 자체가 죽으면 알 유일한 수단. cron은 이미 5분마다 돌고 URL만 기다린다.*
3. **Kuma에 Slack 웹훅** → 5모니터 연결. *지금은 빨간불이 떠도 아무도 안 부른다.*
4. **B2 계정** → `restic.env`(root:600) → 오프사이트. *현재 로컬 사본뿐 — NAS 전손 시 전부 소실.*
   RESTIC_PASSWORD는 반드시 NAS 밖에 에스크로.
5. **USB 마이크 → Studio** → `deploy/studio/voicebridge-cutover.md`(10분) → 어학 가동.
6. **KIS 모의투자 appkey** → `.env` → KISBroker 구현 착수. *자동화 세션은 증권 자격증명 비취급.*
7. (선택) **OpenAI 크레딧** — 키는 유효, 잔액 0이라 429.

### 🟡 [자동] 게이트 답변 직후
- `part-definitions.yaml`에 biz-b/c 채우고 `sh pipelines/sync-parts.sh` → `active: true`
- 리드발굴의 `수집` 노드 → 네이버 검색 API/구글 뉴스 (⚠️ **노드 이름은 `수집` 그대로 두고 타입만** 교체)
- blog/quote의 placeholder(승인·발행·PDF) → Slack/WordPress/Gmail 노드
- `pricebooks/*.yaml`·`templates/*.html` 작성(견적 쓰는 파트만)

### 🟢 [자동] 게이트와 무관
- **미니 이관 2~8단계** — `docs/mini-migration-map.md`의 순서대로. 1단계(관제) 완료.
  판단 필요 2건: 카운슬 심의 3종 / 자기점검 나머지(주간 자가점검으로 일부 이식됨).
  ⚠️ `restic-rest`는 미니 백업 수신 중 — 이관 완료 전 중단 금지.
- 매매 KIS 단계: `deploy/nas/trading/README.md`의 필수 구현 목록(토큰 앵커·웹소켓·세션 캘린더·**대사**).
- 학습: 아카이브 수집(RSS/유튜브) 워크플로 — 임베딩·검색·간격반복은 이미 검증됨.

## 이 프로젝트의 습관 (지킬 것)
- **마일스톤마다 적대적 리뷰** → 발견 수정 → 다음. 실제로 이 습관이 잡아낸 것:
  스키마 미적용 · 부팅 순서 결함 · NaN 가드레일 관통 · 인젝션 dedup 우회 ·
  RLS의 매매 정지 경로 · 스코어 fail-open · 백업의 설정 파일 누락 · 추론형 모델 빈 응답.
- **문서의 "완료" 주장을 의심하라.** 07-23의 "스키마 로드됨"이 거짓이었다. 실행해서 확인할 것.
- 사용자에게 터미널 작업을 부탁할 땐 **스크립트 파일 + 한 줄 실행**(긴 원라이너는 복사 과정에서 깨진다).
- NAS 파일 전송은 `tar -cf - x | ssh nas 'tar -xf - -C ...'` (scp는 한글 경로에서 실패).
  `COPYFILE_DISABLE=1`을 주지 않으면 macOS `._` 잔재가 섞인다.
- psql에 복잡한 SQL을 보낼 땐 **파일로 만들어 `docker compose cp` 후 `-f`** (셸 인용이 계속 깨진다).
- n8n CLI 실행은 `-e N8N_RUNNERS_BROKER_PORT=5699`(서버가 쓰는 포트와 충돌 회피).

## 불변 원칙 (docs/CLAUDE.md)
멀티모델(탈클로드) · 운영은 API/로컬 무중단 · **LLM 직접 주문권한 금지** · 2주·초보 제약 ·
과잉설계 금지 · **대체 검증 전 삭제 금지** · 대외 산출물=프런티어 고정 · MagicDNS(IP 하드코딩 금지).

## 세션 종료 시
`deploy/STATE.md` 갱신 + 커밋·푸시. 설계 변경은 `docs/CLAUDE.md`에도 반영.
