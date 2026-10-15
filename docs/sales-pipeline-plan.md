# 영업 파이프라인 개편 계획 — 아웃바운드 · 완료 분리 · 월 정산

> 작성 2026-10-13. 계획은 Fable 5.1, 구현은 Opus 서브에이전트(doer) + 별도 검수(judge).
> 이 문서가 구현의 정본이다. 구현 중 설계가 바뀌면 이 파일을 먼저 고친다.

## 1. 왜 바꾸는가 — 조사 결과

| 사실 | 근거 |
|---|---|
| 백오피스는 **인바운드 전용**이다. `quotes.stage` 7단계(new→settled)가 전부 "연락 온 건"을 전제한다 | `src/lib/assignment-types.ts` QUOTE_STAGES |
| 아웃바운드(먼저 보내는 제안)는 백오피스 밖 `~/agents-bd` + 구글 드라이브에 있고 **2026-08-10 에 멈췄다** | `~/Library/LaunchAgents/com.agent.bd-daily.plist.paused-20260810` |
| 제안서 110건(md) · 드라이브 덱 40여 종이 만들어졌지만 **발송·팔로업·수주 기록이 어디에도 없다.** 덱 대부분은 열람 기록이 생성 시각과 같다(열어 본 적 없음) | Drive `viewedByMeTime` == `createdTime` |
| **같은 기관에 중복 제안**이 실제로 났다 — slug 재제안 9건, 기관 단위 16곳. 중복 방지 키가 기관이 아니라 캠페인 slug 라서(`nie-ecology-friends` ≠ `nie-ecorium-friends`, 둘 다 국립생태원). 생성물 7건은 원장에 기록도 안 됐다 | `outputs/proposals/proposed-ledger.json` 대조 |
| 제작 문의 목록에 **납품완료·정산완료 건이 활성 건과 섞여** 보인다. Drop 만 분리돼 있다 | `src/app/admin/quotes/page.tsx` 는 `dropped_at` 만 거른다 |
| 정산은 배정(assignments) 단위로 선금/잔금 **지급일**만 있다. **고객 수금일이 없고**, 월 단위로 모아 보는 화면이 없다. 대시보드 "이번 달 매출"만 존재 | `20260731_work_billing.sql`, `src/app/admin/page.tsx` |

## 2. 영업 전문가 관점의 목표 프로세스

```
                 ┌──────────── 제안 영업 보드 (/admin/outreach) ────────────┐
 아웃바운드      sourced(발굴) → drafted(제안서 준비) → sent(발송) → followup(팔로업)
                                                                      │ 답변 옴 → 전환(convert)
                                                                      ▼
 인바운드        new(접수) → consulting(상담) → quoted(견적) → contracted(계약) → producing(제작)
                 └──────────── 제작 문의 = 활성 큐 (/admin/quotes) ─────────┘
                                                                      │
                                                        delivered(납품) → settled(정산)
                                                        └── 완료 프로젝트 (/admin/completed) ──┘

 어느 단계에서든 Drop(사유 기록) → /admin/drops   (복구 가능)
 월 정산 (/admin/settlements): 월별 매출·작업비·마진·수금·지급
```

원칙
1. **원천(source)은 영원히 남는다.** 아웃바운드에서 전환된 건은 `source='outbound'` 를 유지한 채 단계만 `consulting` 으로 옮긴다. 보드 소속은 source 가 아니라 **단계 그룹**이 정한다. 그래야 "아웃바운드가 매출에 얼마나 기여했나"를 나중에 셀 수 있다.
2. **활성 큐에는 손이 필요한 건만.** 완료(delivered·settled)와 Drop 은 각자 화면으로. 활성 큐 기본 정렬은 미처리(new) 우선.
3. **중복 제안 금지는 기관 단위로.** `org_key`(정규화된 기관명)로 180일 내 제안 이력을 등록 시점에 경고한다. 캠페인 slug 가 아니다.
4. **모든 접촉은 활동 기록(append-only)에 남는다.** 발송·통화·메모·단계 변경·전환. 수정·삭제 경로를 만들지 않는다 — 감사 기록이자 CRM 타임라인이다.
5. **팔로업 예정일이 지난 건이 보드 맨 위.** 영업은 보낸 것보다 "다시 연락할 때를 놓치지 않는 것"이 수주를 만든다.
6. **되돌릴 수 있게.** 완료 → 제작중 되돌리기, Drop 복구, 전환 취소(→ followup)를 같은 화면에 둔다.

## 3. 데이터 모델 (단일 파이프라인, 결정됨)

### 3.1 `quotes` 확장 — `supabase/migrations/20261013_sales_pipeline.sql`

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| `source` | TEXT NOT NULL DEFAULT 'inbound' | `inbound` \| `outbound` |
| `org` | TEXT | 기관·회사명 (아웃바운드 필수, 인바운드 선택) |
| `org_key` | TEXT | 중복 판정용 정규화 키 (앱이 계산, 인덱스) |
| `segment` | TEXT | 공공·박물관·대학·기업·지자체 … 자유 텍스트 |
| `score` | INTEGER | 적합도 점수 (발굴 에이전트 산출) |
| `proposal_url` | TEXT | 제안서 덱(구글 슬라이드 등) 링크 |
| `proposal_sent_at` | TIMESTAMPTZ | 제안서 발송 시각 |
| `proposal_sent_to` | TEXT | 발송 수신처 |
| `next_action_at` | DATE | 다음 액션(팔로업) 예정일 |
| `converted_at` | TIMESTAMPTZ | 아웃바운드 → 상담 전환 시각 |
| `stage_changed_at` | TIMESTAMPTZ | 마지막 단계 변경 시각 |
| `closed_at` | TIMESTAMPTZ | 완료(delivered/settled) 진입 시각 — 완료 화면 정렬·월 집계 |
| `lost_reason` | TEXT | Drop 사유 |
| `outreach` | JSONB | 발굴 에이전트 산출물 원문 {subject, body_text, matched_cases, image_prompt, slug…} |

`stage` 값 4개 추가: `sourced`, `drafted`, `sent`, `followup`. DB 에 CHECK 제약은 없으므로(기존 방식) 앱 검증(`isQuoteStage`)만 넓힌다.

### 3.2 `lead_activities` (신설, append-only)

```
id UUID PK · quote_id UUID FK quotes ON DELETE CASCADE · kind TEXT
(note|call|email|meeting|proposal_sent|stage|convert|drop|restore|system)
body TEXT NOT NULL DEFAULT '' · actor TEXT NOT NULL DEFAULT '' · occurred_at TIMESTAMPTZ DEFAULT now()
created_at TIMESTAMPTZ DEFAULT now() · INDEX (quote_id, occurred_at DESC) · RLS on, 정책 없음
```
`actions.ts` 에 update/delete 를 만들지 않는다.

### 3.3 `assignments` 확장 — 수금

| 컬럼 | 뜻 |
|---|---|
| `client_paid_at` DATE | 고객 입금일. NULL 이면 미수 |

월 귀속 기준(화면에 명시): **매출·작업비 = 납기(due_date), 없으면 배정 생성일** — 대시보드 "이번 달 매출"과 같은 정의. **수금 = client_paid_at 의 달, 지급 = deposit/balance_paid_at 의 달.**

### 3.4 단계 그룹 (코드 레지스트리, `assignment-types.ts`)

```ts
OUTREACH_STAGES = ["sourced","drafted","sent","followup"]
ACTIVE_STAGES   = ["new","consulting","quoted","contracted","producing"]
DONE_STAGES     = ["delivered","settled"]
QUOTE_STAGES    = [...OUTREACH_STAGES, ...ACTIVE_STAGES, ...DONE_STAGES]
stageGroup(stage) → "outreach" | "active" | "done"
```
화면마다 열거를 손으로 적지 않는다. 셀렉트 옵션은 그룹에서 파생한다.

## 4. 화면 (날개 "운영" 그룹 순서)

| 경로 | 종류 | 무엇을 하는 자리 | 조치 |
|---|---|---|---|
| `/admin/outreach` **제안 영업** (신설) | 큐 | 내가 먼저 보내는 제안의 진행. 팔로업 지연 우선 정렬, 단계 필터 | 새 리드 등록(180일 중복 경고) · 단계 변경 · 발송 기록(수신처) · 팔로업일 지정 · **전환**(→ consulting) · Drop(사유) · 활동 메모 |
| `/admin/quotes` 제작 문의 (수정) | 큐 | 활성 단계만. 기본 정렬 new 우선 → 접수일 역순. 원천 배지(인바운드/아웃바운드 전환) | 기존 + 활동 메모 타임라인 |
| `/admin/completed` **완료 프로젝트** (신설) | 목록 | delivered·settled. 완료일·매출(배정 합)·정산 상태 | 제작중으로 되돌리기(2단계) |
| `/admin/settlements` **월 정산** (신설) | 분석+편집 | `?month=YYYY-MM`. 요약 타일(매출 공급가·부가세·작업비·마진·수금/미수·지급/미지급) + 배정 표. 날짜 셀 인라인 편집 | 수금일·선금일·잔금일 기록(기존 updateWork 확장) · CSV 내려받기 |
| `/admin/drops` Drop (수정) | 목록 | 사유 표시·편집 | 기존 복구·영구삭제 유지 |
| `/admin` 대시보드 (수정) | 타일 | 제안 영업 진행 N(팔로업 지연 N) · 완료 N · 이번 달 매출 → 월 정산 링크 | — |
| `/admin/setup` (수정) | 설정 | 새 마이그레이션 등록 (`ALLOWED_FILES` + 화면 목록) | — |
| `POST /api/admin/outreach/intake` (신설) | API | 발굴 에이전트가 리드를 넣는 입구. `x-intake-token` 헤더(`OUTREACH_INTAKE_TOKEN`) 또는 관리자 세션. org_key 가 같은 기관이 이미 있으면 **거부하지 않고 병합**한다 — 새 초안은 활동 기록으로 남기고 제안서 링크만 최신으로 갱신(`docs/outreach-intake.md`) | — |

공용 조각: `src/components/admin/ActivityTimeline.tsx`(목록 + 추가 폼). 단계 배지는 별도 컴포넌트 없이 `STAGE_COLORS`/`STAGE_LABELS` 레지스트리를 각 보드가 직접 쓴다(`StageBadge.tsx` 는 만들지 않았다). 날짜·컬럼 누락 판정 같은 공용 헬퍼는 `src/lib/outreach.ts` 한 곳에 둔다.

## 5. 구현 순서 (각 단계 = doer 1명, 끝나면 테스트 → 다음)

| # | 범위 | 산출물 | 완료 조건 |
|---|---|---|---|
| A | 스키마·타입·라이브러리 | 마이그레이션 SQL, `assignment-types.ts` 단계 그룹, `quote-types.ts` 필드·`quoteFromRow`, `lead-activity-types.ts`(`normalizeOrgKey`, `isRecentlyProposed`), `lead-activities.ts`, `settlement.ts`(순수 집계), 테스트 3종 | `npm test` 통과, 기존 241건 유지 |
| B | 제안 영업 보드 + 활동 기록 | `/admin/outreach` page·actions, `OutreachBoard.tsx`, `ActivityTimeline.tsx`, `setQuoteStage` 가 `stage_changed_at`/`closed_at`/활동을 함께 쓰도록 | 보드에서 등록→발송→팔로업→전환→Drop 전 과정 동작 |
| C | 활성 큐 분리 · 완료 · 월 정산 · Drop 사유 · 대시보드 · 날개 · setup | `/admin/quotes` 필터·정렬, `/admin/completed`, `/admin/settlements`, `drops` 사유, `AdminShell` NAV, `page.tsx` 타일, `setup`·`migrate` 등록 | 세 화면이 같은 표를 겹치지 않게 나눠 보임 |
| D | 기존 자산 이관 · 인테이크 API | `/api/admin/outreach/intake`(기관 단위 병합), `scripts/import-outreach.mjs`(payload.json 을 청크로 POST). payload 는 일회성 빌더(세션 스크래치, agents-bd md 110건 + review/published JSON + 드라이브 덱 목록 → `{leads}`)로 만든다 — 109건이 기관 52곳으로 묶이고 57건은 이전 초안 활동으로 남는 것을 로컬 dry-run 으로 확인 | 운영 dry-run 결과 표 확인 후 실제 삽입 |
| E | 검수·배포·적용 | judge(read-only, `backoffice-console/references/review-gate.md`) → 지적 수정 → lint·build → commit/push → `vercel deploy --prod` → 마이그레이션 실행 → 이관 스크립트 → 화면 확인 | 운영 URL 에서 네 화면이 뜨고 이관 데이터가 보임 |

## 6. 지키는 규칙 (backoffice-console 게이트에서 발췌)

- 화면마다 `getServerSession` 관문, 서버 액션마다 `requireAdmin()` 첫 줄.
- 되돌릴 수 없는 버튼(영구 삭제)은 2단계. `window.confirm` 은 기존 코드에 있으나 **새 화면에는 넣지 않는다**.
- 표가 없어도 콘솔이 뜬다 — 새 컬럼이 아직 없으면 `quoteFromRow` 가 기본값으로 떨어뜨리고, 화면은 "마이그레이션 필요" 안내 + setup 링크.
- 대시보드 수치는 count 쿼리. 목록을 받아 세지 않는다.
- 금액 표기 `3,800만 원`/`1,234,000원`, `₩` 금지. 부가세 별도 명시.
- 조치 후 `revalidatePath` 는 관련 화면 전부(`/admin`, `/admin/quotes`, `/admin/outreach`, `/admin/completed`, `/admin/settlements`, `/admin/drops`, `/admin/works`).

## 7. 결정·가정·남은 위험

- **발굴 자동화(bd-daily) 재가동은 이번 범위 밖.** 2026-08-10 에 의도적으로 멈춘 이유가 기록에 없다. 인테이크 API 를 열어 두고, 재가동은 사용자가 결정한다.
- 이관 스크립트는 멱등이 아니다 — 같은 payload 를 두 번 넣으면 기관 행은 늘지 않지만 활동 기록이 중복된다. 한 번만 돌린다.
- 이관 데이터는 전부 `drafted`(제안서 준비) 로 넣는다 — 발송 증거가 없기 때문. 실제로 보낸 건이 있으면 보드에서 "발송 기록"으로 고친다.
- `client_amount` 가 배정 단위인 기존 설계를 유지한다(한 리드에 아티스트 여럿). 수금일도 배정 단위.
- 마이그레이션 실행에는 `SUPABASE_ACCESS_TOKEN` 이 필요한데 Vercel 환경변수에 **없다**(2026-10-13 확인). 그래서 SQL 은 사용자가 Supabase SQL Editor 에서 실행한다. 이후 이 토큰을 Vercel 에 추가하면 `/admin/setup` 버튼으로도 된다.
- Vercel 환경변수가 전부 Sensitive 라 `vercel env pull` 로 값을 받을 수 없다 → 로컬에서 DB 에 직접 닿을 수 없고, 이관은 배포된 앱의 인테이크 API 로만 한다(`scripts/import-outreach.mjs`).
- Supabase 는 2026-09-22 사용량 초과로 전면 차단된 이력이 있다. 적용 전에 REST 응답을 확인한다.
