# 토큰·비용 실측 감사 (2026-07-28)

> 질문: **"돈이 실제로 어디서 나가고 있는가."**
> 답: 예산 가드를 걸어둔 LiteLLM 게이트웨이가 아니라, **게이트웨이 밖 미니의 잡 하나**에서 나간다.
> 5일간 게이트웨이 총지출 **$0.0366**, 같은 기간 미니 `proactive-nudge`의 Gemini 직접호출 추정 **$4.1**
> — **112배**. 그리고 이 지출은 어떤 예산캡·대시보드에도 잡히지 않는다.

측정 시각 2026-07-28 23:00~24:00 KST. 근거는 전부 실측(LiteLLM DB 쿼리 · 실제 API 응답의 usage 필드 ·
launchd plist · 잡 로그). 추정치는 산출식을 함께 적었다.

---

## 0. 한 장 요약

| 지출 경로 | 관측 가능? | 예산캡? | 5일 실측/추정 | 월 환산 |
|---|---|---|---|---|
| LiteLLM 게이트웨이 (NAS) | ✅ Admin UI + DB | ✅ 가상키 $25/30d | **$0.0366** | ~$0.22 |
| 미니 `proactive-nudge` → Gemini 직접 | ❌ 아무 데도 없음 | ❌ 없음 | **~$4.1**(추정) | **~$25** |
| 미니 `sns-daily` → OpenAI 이미지 | ❌ | OpenAI 계정 하드리밋 | $0 (7/16부터 전량 거부) | $0 |
| 미니/스튜디오 `claude --print` | ❌ | Claude Max 구독 한도 | $0 (구독) | $0 |
| 미니/스튜디오 ollama | — | — | $0 (전기만) | $0 |

**핵심 3가지**

1. **게이트웨이는 사실상 공짜다.** 106콜 중 83콜이 로컬 티어로 흘러 $0. 프런티어로 나간 15콜만 과금됐다.
   설계 의도(로컬 우선)가 실측으로 확인됐다.
2. **진짜 지출은 게이트웨이를 안 거친다.** `proactive-nudge`가 `litellm` 파이썬 라이브러리로
   Gemini를 **직접** 부른다. NAS의 LiteLLM 프록시를 경유하지 않으므로 `LiteLLM_SpendLogs`에 한 줄도 안 남는다.
3. **그 잡이 비싼 이유는 호출 수가 아니라 추론 토큰이다.** `gemini-3.5-flash`는 추론형이고,
   1콜의 출력 2,890토큰 중 **2,708토큰이 reasoning**이다(실측). 출력 단가가 입력의 6배라
   **비용의 89%가 사고 과정**에서 나온다.

---

## 1. LiteLLM 게이트웨이 — 별칭별·키별 실측

데이터 범위는 **2026-07-24 05:53 ~ 07-28 09:03 (5일)**. 게이트웨이 배포일이 7/24라 그 이전 기록은 존재하지 않는다.

```sql
-- NAS: docker exec agent-backbone-postgres-1 psql -U agent -d agent
SELECT model_group, model, count(*), sum(prompt_tokens), sum(completion_tokens), sum(spend)
FROM "LiteLLM_SpendLogs" GROUP BY 1,2;
```

### 1-1. 별칭별

| 별칭 | 실모델 | 콜 | 입력토큰 | 출력토큰 | 지출(USD) |
|---|---|---:|---:|---:|---:|
| write-ko-final | anthropic/claude-sonnet-5 | 7 | 1,553 | 2,045 | **0.023556** |
| quote-legal | anthropic/claude-sonnet-5 | 1 | 259 | 496 | 0.005478 |
| analyst-trading | anthropic/claude-sonnet-5 | 4 | 872 | 302 | 0.004764 |
| kimi-cheap | moonshot/kimi-k2.6 | 3 | 71 | 489 | 0.002008 |
| bulk-quality | moonshot/kimi-k2.6 | 2 | 32 | 184 | 0.000754 |
| classify-fast | ollama qwen2.5:7b | 34 | 2,409 | 139 | 0 |
| write-ko-draft | ollama qwen3.6:35b-a3b | 32 | 1,227 | 23,272 | 0 |
| summarize | ollama qwen3.6:35b-a3b | 9 | 3,579 | 799 | 0 |
| embed | ollama bge-m3 | 5 | 78 | 0 | 0 |
| code-fast | ollama qwen3-coder:30b | 2 | 34 | 18 | 0 |
| code-heavy | ollama qwen3-coder:30b | 1 | 17 | 2 | 0 |
| kimi-cheap(실패) | — | 3 | 0 | 0 | 0 |
| gpt-frontier(실패) | openai/gpt-5.6-sol | 1 | 0 | 0 | 0 |
| (별칭 없음, 실패) | — | 2 | 0 | 0 | 0 |
| **합계** | | **106** | **10,131** | **27,746** | **0.036560** |

- **로컬 티어가 83콜 / 31,574토큰을 흡수했고 지출은 0**이다.
  같은 트래픽을 sonnet-5로 보냈다면 **$0.257**(입력 7,344×$2/M + 출력 24,230×$10/M).
  액수는 작지만 비율로는 로컬이 전체 토큰의 83%를 처리했다.
- `write-ko-draft`가 출력 23,272토큰으로 압도적이다 — 35B 추론형을 `think:false`로 눌러둔 게
  주효했다(config 주석의 86배 차이 근거). 이 별칭이 클라우드였다면 여기가 최대 비용원이 됐다.
- **단가 역산**: 위 실측 지출에서 연립방정식으로 풀면 `claude-sonnet-5` = **입력 $2/M · 출력 $10/M**.
  (검산: analyst-trading 872×2e-6 + 302×1e-5 = 0.004764 — DB값과 정확히 일치.)

### 1-2. 키별

| 키 | 콜 | 지출 | 토큰 | 예산 | 소진율 |
|---|---:|---:|---:|---|---:|
| `n8n-ops` (가상키) | 38 | $0.032426 | 11,883 | $25 / 30d (리셋 8/1) | **0.13%** |
| master key | 68 | $0.004134 | 25,994 | 없음 | — |

- 과금된 프런티어 콜은 **전부 `n8n-ops` 키**로 나갔다. 예산캡이 실제로 돈이 나가는 경로를 덮고 있다 — 설계대로다.
- master key 68콜은 수동 스모크·검증(요청 IP 100.86.100.119 = Tailscale 경유 사람 호출)이다.
  **캡이 없다.** 지금은 액수가 0에 가깝지만, 캡 없는 키가 상시 존재하는 것 자체가 구멍이다.

### 1-3. 날짜별

| 날짜 | 콜 | 토큰 | 지출 | 성격 |
|---|---:|---:|---:|---|
| 07-24 | 22 | 5,788 | $0.003380 | 클라우드 티어 활성화·폴백 드릴 |
| 07-25 | 56 | 28,078 | $0.033180 | 워크플로 7종 E2E 검증(전체 지출의 91%) |
| 07-26 | **0** | 0 | $0 | 아무것도 안 돌았다 |
| 07-27 | 15 | 1,756 | $0 | 전량 로컬 |
| 07-28 | 13 | 2,255 | $0 | 전량 로컬 |

- 7/25 이후 **과금 콜이 한 건도 없다.** 지출의 91%는 하루치 검증 작업이었고, 정상 운영 상태의
  게이트웨이 런레이트는 **사실상 $0**이다.
- 7/26의 0콜은 n8n 워크플로가 전부 비활성이던 기간과 일치한다.

### 1-4. 실패 6건

| 시각 | 별칭 | 원인 추정 |
|---|---|---|
| 07-24 06:32 | (없음) | 라우팅 이전 단계 실패 |
| 07-24 08:07 | gpt-frontier | OpenAI 계정 크레딧 0 (STATE.md 기록과 일치) |
| 07-24 09:08·09:17·09:19 | kimi-cheap | max_tokens 부족 → 추론형 빈 응답(config 주석의 함정) |
| 07-28 03:42 | (없음) | 별칭 미지정 요청 |

`LiteLLM_ErrorLogs` 테이블은 **0행**이다 — 실패는 `SpendLogs.status='failure'`로만 남는다.
에러 전용 테이블을 보고 "에러 없음"이라 판정하면 틀린다.

---

## 2. 미니에서 아직 LLM을 부르는 잡 — 전수

방식: 활성 plist 20종의 `ProgramArguments` → 스크립트 → **간접 참조까지 최대 4단계 추적**해
`claude` CLI / `litellm.completion` / 프로바이더 직접호출을 찾았다.

> ⚠️ 레포의 `deploy/mini/headless-perm-audit.sh`는 **1단계만** 본다.
> 그래서 `sns-daily`(zsh → `sns-run-all` → `bin/ask`)와 council 2종(`import council_week` → `bin/ask`)을
> **놓친다**. 실제로 이 감사에서 그 스크립트를 돌리면 `queue-worker`·`slack-bridge` 둘만 나온다.
> 7/28 커밋의 "claude를 부르는 잡은 넷뿐" 결론은 이 한계 때문에 생긴 **오탐(false negative)** 이다.

### 2-1. LLM을 부르는 잡 (7종)

| 잡 | 스케줄 | 엔진·모델 | 실제 호출/일 | 과금 | 산출 상태 |
|---|---|---|---:|---|---|
| **`proactive-nudge`** | 09·12·15·18시 | **`gemini/gemini-3.5-flash` 직접** | **28** | **유료 (~$0.82/일)** | ✅ 정상(슬랙 발송 확인) |
| `channel-council` | 04·12·18시 | ollama `qwen3:30b-a3b` (미니 로컬) | **0** | $0 | ⚠️ 3주+ 전 채널 `no_project` |
| `council-project-review` | 일 12:00 | `claude --print` (Max) | 주 1 | $0 | ✅ 7/26 게시 |
| `council-weekly-report` | 금 12:00 | `claude --print` (Max) | 주 1 | $0 | ✅ 7/24 게시 |
| **`sns-daily`** | 매일 08:30 | `claude --print` + OpenAI 이미지 | 주 7 | $0(하드리밋) | ❌ **7/10부터 산출 0** |
| `queue-worker` | 상주 | `claude --print` | **0** | $0 | ⚠️ 6/25 이후 잡 유입 0 |
| `slack-bridge` | 상주 | claude/ollama/gemini/openai | **0** | $0 | ⚠️ 7/15 이후 사용자 요청 0 |

### 2-2. LLM을 안 부르는 활성 잡 (13종)

`invest-poll`(15분, KIS만) · `invest-morning-report`(09:30) · `google-token-check`(07:30) ·
`studio-worker-guard`(30분) · `backup-restic`(03:30) · `gitsync`(5분) · `caffeinate` ·
`tailscaled` · `agent-sshd` · `claude-tmux` · `ollama`(상주) · `studio-upload-worker`(biz-a 실서비스) ·
`voicebridge`.

`invest-poll`은 **하루 96회**로 미니에서 가장 자주 도는 잡이지만 KIS REST 조회뿐이라 토큰 비용은 0이다.

---

## 3. `proactive-nudge` — 유일한 실지출, 그리고 그 정체

### 3-1. 실측 (실제 API 1콜)

가장 작은 채널(`travel-여행`)로 **실제 Gemini 호출 1건**을 날려 usage를 받았다(이 측정 자체가 $0.0275 소모).

```
model: gemini-3.5-flash
prompt_tokens:      982
completion_tokens: 2,890   ← 그중 reasoning_tokens: 2,708 / text_tokens: 182
cost:            $0.027483   (= 982×$1.5/M + 2,890×$9/M)
```

**출력 토큰의 94%가 사고 과정이다.** 실제로 쓰이는 JSON 본문은 182토큰뿐인데,
그 앞에 2,708토큰을 태우고 그걸 출력 단가로 낸다. 콜당 비용의 **89%가 reasoning**이다.

### 3-2. 하루·한 달 환산

- 대상 채널 **7개**(`proactive.json`의 아젠다 9개 중 `default_agent`가 붙은 것만) × **4회/일** = **28콜/일**
- 입력: 프롬프트 합계 24,335자 ÷ 1.68자/토큰(위 실측 비율) ≈ **14,500토큰/회**
- 출력: 7콜 × 2,890 ≈ **20,230토큰/회**

| 단위 | 입력 | 출력 | 비용 |
|---|---:|---:|---:|
| 1회(4시간마다) | 14,500 | 20,230 | **$0.204** |
| 하루(4회) | 58,000 | 80,920 | **$0.82** |
| 30일 | 1.74M | 2.43M | **~$25** |

> 단가는 미니에 설치된 litellm 가격표(`gemini-3.5-flash` = 입력 $1.5/M · 출력 $9/M) 기준이며,
> 위 1콜 실측 비용과 정확히 일치한다. 다만 **실제 청구는 Google 콘솔에서 대조해야 확정**이다.
> 또 측정에 쓴 채널이 7개 중 가장 작아 reasoning 토큰이 채널마다 더 클 수 있으므로,
> $25/월은 **하한에 가깝다**.

### 3-3. 이 비용이 왜 안 보였나

세 겹이 겹쳤다.

1. **게이트웨이 우회** — NAS LiteLLM 프록시가 아니라 `litellm` 파이썬 라이브러리로 직접 호출한다.
   같은 이름 때문에 "LiteLLM을 쓰니 대시보드에 잡히겠지"로 읽히지만, 라이브러리 직접호출은
   프록시 DB에 아무것도 안 남긴다.
2. **비용 가드가 이 경로를 명시적으로 통과시킨다** — `bin/ask`의 automation guard는
   `claude/openai/codex`만 ollama로 강등하고 주석에 *"gemini-flash는 저가라 허용"* 이라 적혀 있다.
   그 판단은 **비추론형 flash 기준**이었고, 추론형으로 바뀐 지금은 성립하지 않는다.
3. **추론형 함정** — 레포는 이미 같은 함정을 두 번 문서화했다(`qwen3.6:35b-a3b`의 `think:false`,
   `kimi-k2.6`의 `max_tokens≥500`). `proactive-nudge`의 Gemini 호출에는 **어떤 추론 억제 옵션도 없다.**

### 3-4. 값어치 대비

7일간 발송 실적: 하루 0~4건, 평균 **약 1건**. 즉 **28콜을 태워 알림 1건**을 만든다.
콜당 $0.0275이므로 **알림 1건의 원가 ≈ $0.8(약 1,100원)**.

또 프롬프트에 채널 최근 대화 25건을 넣는데 **거기에 자기가 보낸 알림도 포함**된다 —
알림을 보낼수록 다음 프롬프트가 길어지는 자기증식 구조다.

---

## 4. `sns-daily` — 18일째 산출 0 (bd-daily와 같은 함정, 두 번째 피해자)

### 4-1. 실측

- 마지막 산출물: `outputs/sns/personal/2026-07-10.md`. 이후 **모든 실행이 `[sns-publish] 파일 없음`**.
- 미니의 claude CLI가 **2026-07-11 00:01에 2.1.206으로 갱신**됐다(`~/.local/bin/claude` 심볼릭 링크 mtime).
  bd-daily가 죽은 것과 **같은 날짜, 같은 원인**이다.

### 4-2. 원인 확정 (미니에서 직접 재현)

```
$ cd ~/agents && claude --print "outputs/_permcheck.md 파일에 OK 한 줄을 저장하라"
Ignoring 82 permissions.allow entries from .claude/settings.json:
  this workspace has not been trusted.
  Run Claude Code interactively here once and accept the trust dialog,
  or set projects["/Users/agent/agents"].hasTrustDialogAccepted: true in /Users/agent/.claude.json.
OK
$ ls outputs/_permcheck.md
ls: No such file or directory      ← 파일은 안 생겼는데 "OK"라고 출력했다
```

**원인은 `--print`가 아니라 "워크스페이스 미신뢰"다.** 신뢰가 없으면 `settings.json`의
`permissions.allow` 82개가 **통째로 무시**되고 `Write`가 막힌다. 그런데 CLI는 본문에 "OK"를 찍고
종료하므로, 호출한 쪽에서 보면 **정상 응답**으로 보인다.

`sns-run-all`은 `bin/ask`의 출력을 `capture_output=True`로 받아 **버린다.** 그래서 이 거부 메시지가
로그에 단 한 줄도 안 남았고, 로그의 거부 문구를 찾는 감사 스크립트는 영원히 "흔적 없음"을 답한다.

### 4-3. 이미지 쪽은 다른 이유로 따로 죽었다

`sns-image`(OpenAI)는 **2026-07-15까지 정상**이었고 **7/16부터 전량 실패**한다:

```
OpenAI HTTP 400: {"message": "Billing hard limit has been reached.",
                  "code": "billing_hard_limit_reached"}
```

로그에 13회 기록. 하드리밋 덕분에 **추가 지출은 0**이지만, 같은 계정을 쓰는
`gpt-frontier` 폴백도 같은 이유로 죽어 있다(STATE.md의 "크레딧 0" 기록과 동일 원인).

> **텍스트는 7/10, 이미지는 7/16 — 원인도 날짜도 다른 두 개의 조용한 죽음이 한 잡에 겹쳐 있었다.**

---

## 5. 신 시스템과의 중복

| 미니 잡 | 신 시스템 대응 | 판정 |
|---|---|---|
| `voicebridge` | Studio `com.voicebridge` (PID 67390 가동) | 🔴 **양쪽 동시 가동 중** — 미니 PID 79676도 살아 있다 |
| `sns-daily` | n8n `공용: 블로그 초안→퇴고→승인` (**비활성**) | 🟡 미니는 죽어 있고 신 시스템은 안 켜져 있다 → **기능 공백** |
| `queue-worker` | n8n 워크플로 실행기 | 🟢 실질 중복 없음(6/25 이후 잡 0) |
| `slack-bridge` | n8n Slack 노드(크레덴셜 대기) | 🟡 미니는 7/15 이후 무사용 + 웹소켓 재접속 루프(err 671KB) |
| `channel-council` 3종 | NAS `weekly-selfcheck.sh`(월 09:00)가 일부 렌즈만 | 🟡 부분 — 단 미니 쪽이 3주+ 산출 0 |
| `proactive-nudge` | **없음** | 🔴 대응물 없는데 **유일한 실지출** |
| `invest-poll`/`invest-morning-report` | trading-loop(주문) — 성격 다름 | 🟢 중복 아님 |
| `gitsync` | Studio `com.agent.gitsync` (동일 스크립트, 5분) | 🟡 양쪽 가동(개발 도구라 무해) |

### 신 시스템 쪽 실측 (n8n, 7일)

```sql
SELECT w.name, w.active, count(e.*) FROM execution_entity e JOIN workflow_entity w ...
```

| 워크플로 | active | 7일 실행 | 최근 |
|---|---|---:|---|
| `학습: 간격반복 퀴즈` | **t** | 7 | 07-28 17:40 |
| `업무·일정: 아침 브리핑 (08:30 KST)` | **t** | 4(+에러 2) | 07-28 08:30 (schedule trigger) |
| `공용: 리드 발굴` | f | 6 | 07-28 12:24 (수동) |
| 나머지 4종 | f | 0~5 | 07-25 (검증 시점) |

> ⚠️ **문서와 실제가 어긋난다.** `docs/mini-migration-map.md` 5단계는
> *"`업무·일정: 아침 브리핑`은 비활성으로 되돌렸다"* 라고 적혀 있지만,
> DB는 `active = t`(updatedAt 2026-07-28 18:02)이고 **오늘 08:30 스케줄 트리거로 실제 실행**됐다.
> 노드 구성에 실제 Slack 노드가 들어 있으므로 **내일 08:30에도 발송된다.**
> 비활성화 의도가 반영되지 않았거나 되돌려진 것으로 보인다 — 켤지 끌지 재확인 필요.

n8n을 통한 LiteLLM 호출은 하루 **3~6콜**(전량 로컬 티어, $0)이다.
즉 **신 시스템 전체의 토큰 비용은 현재 0**이고, 돈은 아직 옮겨오지 않은 미니 잡 하나에서만 나간다.

---

## 6. 권고 (비용 절감 효과 순)

1. **`proactive-nudge`의 추론 토큰을 막는다** — 월 ~$25 → ~$3 (약 88% 절감)
   `litellm.completion(...)`에 `reasoning_effort="none"`(또는 `thinking={"type":"disabled"}`)을 주거나,
   모델을 비추론형으로 내린다. 판단 자체가 "알림 보낼까 말까"의 이진 결정이라 2,700토큰짜리 사고가 필요 없다.
   → 다만 이 잡은 **신 시스템에 대응물이 없다.** 끄면 기능이 사라지므로 이관 계획이 먼저다.
2. **게이트웨이 밖 직접호출을 금지선으로 세운다.**
   `bin/ask`의 automation guard 주석 *"gemini-flash는 저가라 허용"* 은 추론형 전환으로 무효가 됐다.
   비용 판단을 모델 이름에 걸지 말고 **게이트웨이 경유 여부**에 걸어야 관측·캡이 자동으로 따라온다.
3. **`sns-daily`를 살리든 접든 결정한다.** 18일째 0건이고 신 시스템 대응 워크플로도 비활성이라
   **현재 SNS 파이프라인은 통째로 공백**이다. 살린다면 미니 `~/.claude.json`에
   `projects["/Users/agent/agents"].hasTrustDialogAccepted: true`를 넣으면 텍스트는 즉시 복구된다.
4. **`voicebridge` 미니 인스턴스를 끈다.** Studio 이관이 끝났는데 양쪽에서 돌고 있다.
5. **`headless-perm-audit.sh`를 간접 참조까지 추적하도록 고친다.**
   현재는 1단계만 봐서 이번에 잡은 `sns-daily`·council 2종을 놓친다.
   더 근본적으로는 **"권한거부 로그 문구"가 아니라 "산출물이 있었는가"로 판정**해야 한다 —
   `sns-daily`는 거부 메시지를 버려서 로그 기반 탐지가 원리적으로 불가능했다.
6. **master key에도 예산캡을 건다.** 지금은 캡 없는 키로 68콜이 나갔다(액수는 0에 가깝지만 구멍이다).
7. **죽은 잡을 정리한다** — `channel-council`(3주+ 0세션인데 하루 18건 슬랙 소음),
   `queue-worker`(6/25 이후 0), `slack-bridge`(7/15 이후 0 + 재접속 루프).

---

## 7. 부수 발견 (이번 감사 중 확인, 비용과 무관)

- **NAS SSH가 Studio에서 안 붙는다.** `ssh nas`(172.30.1.10:22) → `No route to host`,
  `nas-ts`(100.86.100.119:22) → timeout. 미니에서는 LAN 22가 정상으로 열린다.
  Studio가 en0(172.30.1.9)·en1(172.30.1.82) **동일 서브넷 이중 연결** 상태라 라우팅이 깨진 것으로 보이고,
  NAS sshd는 Tailscale 인터페이스에 바인딩돼 있지 않다.
  → 이번 감사는 **`ssh -J mini nas`(미니 경유)** 로 우회했다. `~/.ssh/config`의 `nas` 항목에
  `ProxyJump mini`를 넣어두면 재발 시 자동 우회된다.
- **미니 `backup-restic`이 종료코드 1로 끝난다.** 스냅샷(3.918 GiB, 2371파일)은 저장되지만
  `bin/kis-order.disabled-20260727-security`가 **permission denied**로 못 읽혀 경고 → `FATAL: backup 2회 실패`.
  7/27 보안 하드닝에서 이 파일 권한을 죽인 것이 원인으로 보인다. 백업 대상에서 제외하면 해결.
  또 백업 목적지가 `rest:http://192.168.0.208:8000/`으로 **구 LAN IP**다(현 NAS는 172.30.1.10).
- **미니 `invest-morning-report`도 종료코드 1** — KIS API가 HTTP 500을 뱉는 구간이 있으나
  슬랙 게시 자체는 성공한다(부분 실패).
- `LiteLLM_ErrorLogs`는 0행 — 실패는 `SpendLogs.status`로만 남는다(§1-4).

---

## 부록 — 재현 명령

```bash
# LiteLLM 지출 (NAS SSH가 막혀 있으면 -J mini 로 우회)
ssh -J mini nas 'sudo docker exec agent-backbone-postgres-1 psql -U agent -d agent -c \
  "SELECT model_group, count(*), sum(total_tokens), round(sum(spend)::numeric,6) \
   FROM \"LiteLLM_SpendLogs\" GROUP BY 1 ORDER BY 4 DESC;"'

# 키별 + 예산 소진
ssh -J mini nas 'sudo docker exec agent-backbone-postgres-1 psql -U agent -d agent -c \
  "SELECT key_alias, spend, max_budget, budget_reset_at FROM \"LiteLLM_VerificationToken\";"'

# n8n 활성 워크플로 (문서 말고 DB를 믿을 것)
ssh -J mini nas 'sudo docker exec agent-backbone-postgres-1 psql -U agent -d agent -c \
  "SELECT active, name, \"updatedAt\" FROM workflow_entity ORDER BY active DESC;"'

# 미니 헤드리스 권한 함정 재현
ssh mini 'cd ~/agents && /opt/homebrew/bin/claude --print "outputs/_x.md 에 OK 저장" ; ls outputs/_x.md'

# 미니 council 실제 LLM 세션 수(no_project 제외)
ssh mini 'cd ~/agents/memory/council/threads && grep -ho "\"status\": \"[a-z_]*\"" *2026-07-2*.json | sort | uniq -c'
```
