# 미니 잡 → 신 시스템 이관 지도 (2026-07-25 실측)

> 원칙: **"켜기 전에 끈다"** — 신 플로우가 검증된 뒤에야 대응 미니 잡을 OFF한다.
> 실측 근거: `launchctl list`(상주 6 + 스케줄 28), 미니 `~/agents/config/*`, 신 시스템 배포 상태.
> 상태: ✅대체 준비됨(검증 후 OFF 가능) · 🔶부분(placeholder 교체 필요) · ⬜미착수 · 🗑️폐기 · ⚠️유지

## 상주 프로세스 (PID 있음)

| 미니 잡 | 역할 | 신 시스템 대응 | 상태 |
|---|---|---|---|
| `com.voicebridge` | 음성 비서 | Studio `~/voicebridge`(이식 완료, 마이크 대기) | 🔶 마이크 이동 후 OFF |
| `com.papercraft.studio-upload-worker` | papercraft 전개도 엔진 | **대응물 없음** — biz-a 실서비스 | ⚠️ 유지(이관 대상 아님) |
| `com.papercraft.queue-worker` | 작업 큐 | n8n 워크플로 실행기 | ⬜ 잡별 이관 후 |
| `com.papercraft.slack-bridge` | Slack 연결 | n8n Slack 노드(크레덴셜 대기) | ⬜ |
| `com.papercraft.dashboard` | 자체 대시보드 | **Kuma + n8n UI**(C-4: 자체 대시보드 재제작 금지) | ✅ 폐기 대상 |
| `com.agents.ollama` / `com.papercraft.caffeinate` / `com.papercraft.tailscaled` | 인프라 | Studio에 동일 구성 존재 | ✅ 미니 제거 시 소멸 |

## 스케줄 잡

| 미니 잡 | 신 시스템 대응 | 상태 |
|---|---|---|
| `morning-brief` | n8n `업무·일정: 아침 브리핑`(E2E 성공) | 🔶 Google Calendar+Slack 연결 후 |
| `weekly-agenda` / `proactive-nudge` / `homework-watcher` | 아침 브리핑 확장 | ⬜ |
| `sns-daily` | 공용 blog/SNS 플로우 + `sns_lines.json`→파트 테이블 | 🔶 |
| `bd-daily` | 공용 `리드 발굴`(파트 순회, 동작 확인) | 🔶 수집 노드 교체 후 |
| `invest-morning-report` | 매매 분석가 워크플로 + 잔고 조회 | 🔶 KIS 키 후 |
| `invest-poll` (15분) | 매매 엔진 폴링 루프(가동 중) + 알림 규칙 이관 | 🔶 `investment_goals.json` 규칙 이식 필요 |
| `learning-brief` / `learning-quiz` / `learning-youtube` | 학습 파이프라인(archive+pgvector 검증됨) | ⬜ 워크플로 미작성 |
| `channel-council` / `council-project-review` / `council-weekly-report` | **다중 에이전트 심의** — 신 설계에 대응물 없음 | ⬜ **판단 필요**(아래) |
| `agent-review` / `agent-audit` / `qc-eval` | 자기점검·품질 루프 | ⬜ **판단 필요**(아래) |
| `heartbeat` / `slack-health-check` / `google-token-check` / `failover` / `dashboard-exposure-guard` / `studio-worker-guard` | 관제 | **Kuma 4모니터 + NAS cron 하트비트**로 대체됨 | ✅ |
| `backup-restic` | NAS `backup-daily.sh`(복원 리허설 통과) | ✅ ⚠️ 단 restic-rest 수신측은 미니 이관 완료까지 유지 |
| `gitsync` | 개발 도구(운영 아님) | 🗑️ 미니와 함께 소멸 |
| `imgtest` | 테스트 잡 | 🗑️ |

## 판단이 필요한 2가지 (신 설계에 대응물이 없는 것)

### 1. 카운슬(심의) 3종 — `channel-council`, `council-project-review`, `council-weekly-report`
- 실측: 4·12·18시 / 일간 / 금요일 실행. `config/council.json` 존재.
- 신 설계에서 "채널별 상시 챗 에이전트"는 **폐기**됐지만(C-1), 카운슬은 채널 에이전트가 아니라
  **주기적 다중 관점 심의**다. `product-portfolio-management.md`는 `council-project-review` 재활용을
  명시적으로 언급한다(주간 다이제스트).
- 선택지: (a) n8n 워크플로로 재구현(LLM 여러 별칭에 같은 질문 → 종합) (b) 폐기 (c) 미니 은퇴 전까지 유지
- **권장**: (a) — 이미 설계 문서가 재활용을 전제한다. 단 게이트 후 우선순위 하위.

### 2. 자기점검 3종 — `agent-review`, `agent-audit`, `qc-eval`
- 실측: 이 루프가 "24채널 중 21개 전략부재"를 스스로 진단해낸 **검증된 자산**(§I 재활용 목록에 포함).
- 신 시스템엔 대응물이 없다 — Kuma는 인프라만 보고 "설계가 과확장됐는지"는 못 본다.
- **권장**: 로컬 모델로 주 1회 도는 n8n 워크플로로 축소 이식. 미니 제거 전에 만들어야 자산이 소실되지 않는다.

## 진행 기록

### ✅ 1단계 완료 (2026-07-25) — 관제 이관
- **선행**: Kuma에 `mini-alive(SSH)` 모니터 추가(미니가 아직 biz-a 실서비스를 돌리는데 신 시스템
  감시 밖이었다 — 끄기 전에 감시부터 세웠다). 현재 Kuma 5모니터 전부 그린.
- **OFF 처리**(plist를 `.disabled-20260725-kuma`로 리네임, 되돌리려면 리네임+bootstrap):
  `com.papercraft.heartbeat` · `com.papercraft.slack-health-check` ·
  `com.papercraft.dashboard-exposure-guard` · `com.agent.heartbeat`
- 근거: Kuma 5모니터가 같은 역할을 하고, 이 잡들의 Slack 알림은 7/23 slackbot 비활성화 이후
  `rc=56`으로 계속 실패 중이었다(실질 가치 0). 로드된 잡 33 → 29.

### ✅ 3단계 일부 완료 (2026-07-27) — 아침 브리핑 이관 + 죽은 잡 정리

**먼저 밝혀진 것: 이관하려던 잡이 이미 죽어 있었다.**
`morning-brief` 로그는 최소 18일간 전부 `ok=False`였다. 원인은 코드가 겨눈
`#daily-brief-아침브리핑` 채널이 **존재하지 않는다**는 것. 실제 채널은 `#daily-브리핑`
(`C0B6QEB47M1`)이고, 이름이 바뀐 뒤 아무도 알아채지 못했다.
같은 날 Kuma→Slack 알림에서도 같은 계열의 함정을 밟았다(Slack은 실패해도 HTTP 200을 준다).

> **원칙으로 승격**: Slack 대상은 **채널 ID로 지정한다.** 이름은 바뀌고, 바뀌면 조용히 죽는다.
> 그리고 "설정했다"로 완료 판정하지 않는다 — **도착을 확인**해야 완료다.

- n8n `업무·일정: 아침 브리핑 (08:30 KST)` 재작성 → 수동 실행 → `#daily-브리핑` 도착 확인 → **Active ON**.
  - 데이터원: 미니의 할 일 스토어·목표 보드는 **둘 다 비어 있었다**(today_tasks=0, goals open=0).
    빈 껍데기 대신 실제 데이터가 있는 소스(어학 복습 큐·리드·파트 정의)로 채웠다.
  - LiteLLM 노드는 `onError: continueRegularOutput` — 게이트웨이가 죽어도 숫자 브리핑은 나간다.
- 미니 `com.papercraft.morning-brief` **OFF**(`.disabled-20260727-n8n`).

**전수 건강검진 결과**(로그 최종 갱신 + err 크기):

| 상태 | 잡 |
|---|---|
| 살아서 산출 중 | `agent-review`(18h·#daily-브리핑 정상 발송) · `bd-daily` · `sns-daily` · `learning-brief` · `google-token-check` · `studio-worker-guard` · `council-project-review` · `backup-restic` |
| 돌지만 로그 소음 큼 | `channel-council`·`proactive-nudge`·`learning-youtube`(전부 `Python-dotenv` 경고 반복, 크래시 아님) · `slack-bridge`(웹소켓 재접속 루프 671KB) |
| 40일+ 미실행 → **OFF 처리함** | `weekly-agenda`(46일) · `homework-watcher`(42일) · `failover`(47일) · `dashboard`(222h·C-4 폐기) · `imgtest` |
| 확인 필요 | `agent-audit`(258h 미실행 — 자기점검 3종 중 하나라 원인 확인 후 판단) |

`agent-review`가 지금도 매일 04:00에 정상 발송 중임을 실측 확인했다 — 지도가 "검증된 자산"이라 한 판단이 맞다.
**미니 제거 전에 반드시 이식해야 하는 1순위**는 이것이다.

### ✅ 4단계 일부 완료 (2026-07-28) — `bd-daily` 선별 이관 + 18일짜리 사망 복구

**지도의 전제가 틀렸다.** `bd-daily`는 "수집 노드"가 아니라 Claude Code 에이전트를 부르는
파이프라인이다(웹 리서치 → 기관 심층분석 → 사례 매칭 → 8섹션 제안서 → 슬랙 검토 발행).
n8n으로 재구축하면 웹 리서치와 사례 매칭 능력을 잃는다 — 그게 이 자산의 실제 가치다.

**그리고 이미 죽어 있었다.** 마지막 성공 제안서가 2026-07-10, 미니의 claude CLI가
2026-07-11에 갱신됐고, 그 뒤 18일간 매일 돌면서 `WebSearch`/`Write` 권한 거부로 산출 0건이었다.
`--print`(비대화형)에서는 프로젝트 `settings.json`의 `permissions.allow`가 적용되지 않는다.
에이전트가 "추측 금지" 원칙대로 지어내는 대신 정직하게 멈춘 탓에 **실패가 정상 종료로 보였다.**

- 이관: `~/agents` 5.1GB 중 제안서 서브시스템 **약 140MB만** → Studio `~/agents-bd`.
  채널 에이전트 50종·대시보드·큐는 C-1 폐기 대상이라 안 가져왔다.
- 수정: `bin/ask`의 claude 호출에 `--permission-mode acceptEdits` + `--allowed-tools` 명시.
  `--dangerously-skip-permissions`는 Bash·삭제까지 열리므로 쓰지 않았다.
- 검증: launchd 환경에서 실제 웹 리서치 성공(고양시청 신임 시장 2026-07-01 취임 등
  학습 데이터로는 알 수 없는 사실을 찾아냄) → 유효한 8섹션 제안서 1건 산출.
- 검증 후 미니 `bd-daily` OFF. Studio `com.agent.bd-daily` 매일 09:30.
- 상세: `deploy/studio/bd/README.md`

**같은 함정에 걸린 다른 잡이 있는지 전수 확인함(2026-07-28)** — 결과: **없다.**
미니 잡 중 claude를 부르는 것은 `agent-audit`·`learning-quiz`·`queue-worker`·`slack-bridge`
넷뿐이고 전부 권한 거부 흔적이 0이다. `agent-review`는 ollama(`gemma3:27b`)를 쓴다.
피해는 `bd-daily` 단독이었다.

> 다만 **앞으로 만드는 헤드리스 에이전트 잡에는 이 플래그가 필요하다.**
> `claude --print`를 launchd/cron에서 부르면 프로젝트 `settings.json`의 허용 목록이
> 적용되지 않는다. 감사 스크립트: `deploy/mini/headless-perm-audit.sh`

**부수 발견**: `machines.json`의 `ultra.standby=true` 때문에 2026-06-11부터 모든 ultra(Studio)
작업이 미니 로컬로 강등돼 있었다(`logs/system/ask-ultra-fallback.log`). 24GB 미니가 96GB
Studio 몫을 대신 돌고 있었다. 이관으로 제자리를 찾았다.

### ✅ 2단계 완료 (2026-07-28) — voicebridge

USB 마이크를 Studio로 옮기고 마이크 권한(TCC)을 승인받아 상주 전환. 실제 캡처를 확인했다
(RMS 0.0018 / 피크 0.0083 — 무음이 아님). PID 안정, Whisper large-v3-turbo 내려받는 중.

함정 둘: plist가 미니 경로(`/Users/agent/...`)라 다시 썼고, 예전에 `launchctl disable`로
꺼둔 기록이 남아 있어 plist가 아무리 정상이어도 `bootstrap: 5: Input/output error`가 났다.
`launchctl print-disabled gui/$(id -u)`로 확인하고 `enable` 해야 한다.

### ✅ 5단계 완료 (2026-07-28) — 학습 3종

성격이 다른 둘을 갈라서 각자 제자리에 뒀다:
- **간격반복**(결정적·DB) → n8n `학습: 간격반복 퀴즈` 활성화. 미니 `config/learning.json`의
  3항목을 `learning_items`로 진행상태(rep=4, next_due 7/31)까지 동기화. 발송 경로를 실제로
  검증했다(due 항목을 오늘로 당겨 실행 → 슬랙 도착 확인 → 원복).
- **생성형 퀴즈**(에이전트+웹검색) → Studio `com.agent.learning-quiz` 평일 09:05.

여기서도 조용한 실패를 셋 잡았다:
1. `learning-quiz`가 `http://localhost:11434`를 하드코딩. Studio의 ollama는
   `OLLAMA_HOST=100.65.201.6:11434`에만 바인딩돼 있어 invest 블록 5문항이 통째로 사라진다.
   env로 뺐다(기본값은 미니와 동일).
2. `qwen3:8b-q8_0`이 Studio에 없다. `qwen2.5:7b`는 **한국어 질문에 중국어로 답해** 탈락(실측).
   `qwen3.6:35b-a3b`로 교체 — 한국어 정상, 빈 응답 없음.
3. n8n 워크플로: 중복 INSERT가 0행이어도 Postgres 노드는 항목을 내보내 재발송 차단이 무력화된다
   (아침 브리핑에서 잡았던 것과 같은 함정). 가드 노드를 넣었다. Slack 본문도 `$json`이 Postgres
   출력이라 `undefined`가 나가고 있었다 — `$('문항 정리')` 명시 참조로 교체.

미니 3종 OFF. `learning-youtube`는 **48회 실행 중 0건** — 한 번도 작동한 적이 없어 대체물 없이 폐기.

`업무·일정: 아침 브리핑`은 **비활성으로 되돌렸다.** 활성인데 내용이 placeholder(가짜 일정
"10:00 팀 미팅")이고 발송이 noOp였다. 매일 가짜 일정을 보내느니 꺼두는 게 정직하다.
Google Calendar 연결(3단계) 후 켠다.

### ✅ 6단계 완료 (2026-07-28) — 자기점검

`weekly-selfcheck.sh`(월 09:00)가 이미 미니 `agent-review`의 살릴 만한 렌즈를 담고 있었다:
§8 과확장 점검 · §9 사람이 판단할 것 · §10 로컬 모델 총평. 7/27 09:00에 실제로 돌아
리포트를 남겼고 슬랙에도 갔다. `agent-review`의 나머지 렌즈(agent_models.json·`.claude/agents`
점검)는 구 에이전트 시스템이 대상이라 미니와 함께 사라지는 게 맞다.

**빠져 있던 한 조각을 메웠다: Studio 에이전트 잡이 산출을 냈는가.**
오늘 겪은 실패는 전부 "정상 종료했는데 결과물이 0건"이었다 — 성공/실패가 아니라 **산출량**을
봐야 한다. Kuma push 모니터 2개(`bd-daily(push)`·`learning-quiz(push)`, 26시간)를 만들고,
스크립트가 **실제 산출이 있을 때만** 핑하게 했다. 산출 0 → 핑 없음 → Kuma 빨간불 → #sysops.

드릴로 전 구간을 확인했다(간격 90초로 낮춰 핑을 끊음 → DOWN 150초 → 슬랙 알림 17:59:44 도착).

여기서도 제 수정 안에 같은 함정이 두 개 있었다:
- 푸시 URL의 `msg`에 **한글을 넣으면 Kuma가 하트비트를 기록하지 않는다**(`msg=test`는 되고
  `msg=설치검증`은 안 됨). ASCII로 바꿨다.
- `curl -f … && echo` 형태라 실패해도 로그에 아무것도 안 남아 "핑 보냈겠지"가 된다. rc를 남긴다.
- SQLite로 모니터를 넣은 뒤 **Kuma가 실제로 평가하는지 확인해야 한다.** 재시작이 먹지 않아
  7·8번이 타임아웃 검사에서 빠져 있었고, 한 번 더 재시작하고서야 동작했다.

미니 `agent-review`·`agent-audit`·`qc-eval` OFF.

## 이관 순서 (권장)

1. ~~관제 잡 OFF~~ ✅ 완료(위 참조)
2. ~~마이크 이동 → `voicebridge` OFF~~ ✅ 완료 ⏸ **사용자 물리 작업 대기**(USB 마이크를 Studio로)
3. ~~Slack 연결 → `morning-brief` OFF~~ ✅ 완료 · 죽은 잡 5종 OFF ·
   남은 것: `proactive-nudge`(돌고 있음 — 대체 필요), Google Calendar OAuth 연결
4. ~~수집 노드 교체 → `bd-daily` OFF~~ ✅ 완료(아래 4단계 참조) · 남은 것: `sns-daily`
5. ~~학습 워크플로 작성 → `learning-*` OFF~~ ✅ 완료
6. ~~자기점검 축소 이식 → `agent-*`·`qc-eval` OFF~~ ✅ 완료
7. KIS 연결 → `invest-*` OFF
8. **마지막**: `backup-restic` 경로 정리 → restic-rest 컨테이너 정리 → 미니 제거

⚠️ 각 단계에서 **신 플로우가 실제로 산출물을 낸 것을 확인한 뒤** 미니 잡을 OFF한다.
OFF는 `launchctl bootout gui/$(id -u)/<label>` + plist를 `.disabled`로 리네임(7/23에 쓴 방식과 동일).
