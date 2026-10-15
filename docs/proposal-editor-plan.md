# 제안서 편집기 계획 — 편집 디자인 틀 + AI 초안 + 칸 안 편집

> 작성 2026-10-15. 이 문서가 구현의 정본이다. 바뀌면 여기를 먼저 고친다.
> 디자인 원본: `~/agents-bd/reference/proposals/editorial/{book.css,README.md}` (A4 가로 10쪽).
> 사용자 결정: ① 열기를 누르면 AI 가 새 원고를 쓴다 ② 틀은 고정, 칸 안에서만 편집 ③ 계획 → 구현 에이전트 → 별도 검수.

## 1. 흐름

```
제안 영업 보드 [제안서 열기] → /admin/outreach/{quoteId}/proposal
  ├ 저장된 문서가 있으면 → 편집기
  └ 없으면 → "초안 작성 중" 화면 → POST /api/admin/proposals/{quoteId}/generate
        ├ AI(anthropic/claude-sonnet-5.5, AI Gateway·OIDC) 가 원고(JSON) 작성 → 저장 → 편집기
        └ 실패(크레딧·시간초과·키 없음) → 보드에 있는 옛 본문을 섹션별로 나눠 채운 초안(fallback) → 저장 → 편집기 + 안내
편집기: 글 편집 · 서체 · 크기 · 키컬러 · 이미지 올리기/확대/위치 · 쪽 숨김/순서 · 항목 추가/삭제
        · 되돌리기/다시하기 · 자동 저장 · 빈칸 수 · 넘침 경고 · AI 로 다시 쓰기 · PDF
PDF: /admin/outreach/{quoteId}/proposal/print → 인쇄 전용 화면, 브라우저 "PDF로 저장"
```

## 2. 데이터

### `proposal_docs` (신설) — `supabase/migrations/20261015_proposal_docs.sql`

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| id | uuid pk | |
| quote_id | uuid unique, FK quotes ON DELETE CASCADE | 리드 하나에 문서 하나 |
| content | jsonb not null | 원고. 형식은 `BookContent` (agents-bd README 의 data.json 과 같은 키) |
| style | jsonb not null default '{}' | `{ keyColor, headingFont, bodyFont, overrides: { [fieldPath]: { font?, scale? } } }` |
| pages | jsonb not null default '[]' | `[{ id, hidden }]` — 순서와 숨김. 표지·뒤표지는 고정 |
| source | text not null default 'ai' | `ai` \| `fallback` \| `manual` |
| rev | integer not null default 0 | 저장마다 +1. 다른 창에서 덮어쓰기 방지(낙관적 잠금) |
| updated_by | text | 관리자 이메일 |
| created_at / updated_at | timestamptz | |

RLS on, 정책 없음(서비스 롤 전용). 마이그레이션은 기존처럼 `/admin/setup` 목록과 `migrate` 허용 목록에 등록한다.

### 이미지 값

문자열(URL) 또는 `{ url, fit: "cover" | "contain", zoom: 1~3, x: 0~100, y: 0~100 }`.
업로드는 기존 `/api/upload` (4MB 한도) — 클라이언트에서 `src/lib/image-resize.ts` 로 줄여 보낸다.

## 3. 모듈 배치

| 경로 | 역할 |
|---|---|
| `src/lib/proposal-book/schema.ts` | `BookContent`·`BookStyle`·`BookPage` 타입과 zod 스키마, 분량 한도, 기본값, 쪽 목록(id·이름·고정 여부) |
| `src/lib/proposal-book/fallback.ts` | 순수 함수: 리드(QuoteSubmission) + 옛 본문 마크다운 → `BookContent`. 확인 못 한 것은 `[확인 필요: …]` |
| `src/lib/proposal-book/markup.ts` | 순수 함수: `**굵게**`·`[^1]`·`[확인 필요: …]` 파싱, 빈칸 개수 |
| `src/lib/proposal-book/fonts.ts` | 고를 수 있는 서체 목록(제목용·본문용)과 로딩 URL |
| `src/lib/proposal-docs.ts` | DB 읽기·쓰기 (서버) |
| `src/components/proposal-book/book.css` | agents-bd `book.css` 이식. `.pb-root` 아래로 범위를 좁히고 색·서체를 CSS 변수로 |
| `src/components/proposal-book/BookPages.tsx` | 10쪽 렌더러. `editable` 이면 칸마다 편집 핸들 |
| `src/components/proposal-book/Editor.tsx` | 편집기 셸: 도구막대·쪽 목록·속성 패널·저장·되돌리기 |
| `src/app/admin/outreach/[id]/proposal/page.tsx` | 편집기 화면 (관문) |
| `src/app/admin/outreach/[id]/proposal/print/page.tsx` | 인쇄 화면 |
| `src/app/admin/outreach/[id]/proposal/actions.ts` | 저장·초기화 서버 액션 |
| `src/app/api/admin/proposals/[id]/generate/route.ts` | AI 초안 |

## 4. 편집 기능 (틀 고정 + 칸 안 편집)

- **글:** 칸을 누르면 그 자리에서 고친다. 편집 중에는 원문(`**`, `[확인 필요: …]`)이 보이고, 나가면 서식이 적용된다. 붙여넣기는 서식 없는 글자만.
- **서체:** 전체 제목 서체·본문 서체를 고른다. 선택한 칸만 따로 바꿀 수도 있다(덮어쓰기, 되돌리기 가능).
  제목용: Noto Serif KR(기본) · 나눔명조 · 고운바탕 · 함렛 · Pretendard · Noto Sans KR
  본문용: Pretendard(기본) · Noto Sans KR · IBM Plex Sans KR · 나눔고딕 · 고운돋움
- **크기:** 선택한 칸의 글자 크기 70~140%.
- **키컬러:** 브랜드 블루(기본) 외 프리셋 몇 개 + 직접 입력. 키컬러가 쓰이는 자리는 틀이 정한다.
- **이미지:** 칸을 누르면 올리기·바꾸기·지우기, 맞춤(채우기/전체 보이기), 확대 100~300%, 칸 안에서 끌어서 위치 조정.
- **쪽:** 숨기기, 순서 바꾸기(표지·뒤표지 고정).
- **항목:** 라인업·장면·사례·견적 구간·일정·다음 단계·스펙·본문 문단을 더하고 빼고 순서를 바꾼다(한도 안에서).
- **기타:** 되돌리기·다시하기(Ctrl+Z / Ctrl+Shift+Z), 자동 저장(2초) + 저장 상태 표시, 빈칸 수와 "다음 빈칸으로", 쪽마다 넘침 경고, AI 로 다시 쓰기(2단계 확인, 이미지는 유지), PDF.

## 5. AI 초안

- AI SDK 7(`ai` 패키지) `generateObject`/구조화 출력 + zod 스키마. 모델 문자열은 `AI_GATEWAY_MODEL`(기본 `anthropic/claude-sonnet-5.5`). 인증은 Vercel OIDC.
- 입력: 기관명·세그먼트·점수·담당·발굴 에이전트 산출물(`quotes.outreach`: 본문·매칭 사례·제목)·스튜디오 고정 정보.
- 규칙(시스템 프롬프트): agents-bd README 의 분량 한도, 한 문장 60자 이내, 확인 못 한 사실은 `[확인 필요: …]`, 기관 칭찬 도입부 금지, "함께·시너지·혁신·새로운 가치" 금지, 견적 금액은 `[확인 필요: 단가]`, 시안 A·B·C 는 무엇을 그릴지 30자 이내 지시.
- 실패하면 fallback 으로 채우고 화면에 이유를 알린다. 생성 결과는 스키마 검증 후 저장한다.

## 6. 구현 순서

| # | 범위 | 담당 |
|---|---|---|
| A | 마이그레이션·schema·markup·fallback·fonts·DB lib·book.css 이식·BookPages(읽기 전용 렌더)·인쇄 화면·보드 버튼·테스트 | 구현 에이전트 1 |
| B | Editor.tsx 와 편집기 화면·저장 액션 | 구현 에이전트 2 (A 뒤) |
| C | AI 초안 API·프롬프트·실패 시 fallback | 구현 에이전트 3 (A 뒤, B 와 병렬) |
| D | 검수 → 수정 → 빌드 → 배포 → 마이그레이션(사용자) → 실제 리드로 확인 | |

## 7. 위험

- AI Gateway 크레딧이 없으면 생성이 실패한다 → fallback 으로 열리고 안내가 뜬다.
- 인쇄 PDF 의 품질은 사용자의 브라우저(크롬 권장)에 달렸다. 인쇄 화면에서 서체 로딩을 기다린 뒤 인쇄한다.
- 마이그레이션은 사용자가 Supabase SQL Editor 에서 실행한다(`SUPABASE_ACCESS_TOKEN` 없음).

## 8. AI 작성을 맥 스튜디오로 옮김 (2026-10-16)

Vercel AI Gateway 는 크레딧이 없어 운영에서 실패했다. 사용자 결정: **맥 스튜디오(24시간)의 Claude Code(Max 구독)가 웹 조사까지 해서 원고를 쓴다.** Vercel 쪽 AI 호출은 기본으로 끈다(`PROPOSAL_AI_ENGINE=vercel` 일 때만 켬).

```
편집기 열기(문서 없음) → 기존 자료 초안으로 즉시 생성 + 작업 요청(gen_status=requested)
편집기 "AI로 다시 쓰기"  → 작업 요청
맥 launchd(1분) → GET /api/admin/proposals/jobs/next (작업 하나를 running 으로 잡음)
              → claude --print (웹 조사 + 원고 JSON)
              → POST /api/admin/proposals/{id}/worker-result
백오피스: 결과를 후처리(분량·견적 빈칸·출처 http(s)·수신 메일=리드 메일) 후 gen_result 에 보관
        · 문서가 요청 이후 안 바뀌었으면 자동 적용(이미지 유지), 바뀌었으면 편집기에 "적용하기/버리기"
편집기: 10초마다 상태 확인 → "맥에서 조사·작성 중" / "AI 원고 도착" / "실패: 이유 [다시 요청]"
```

### 계약

- 인증: 헤더 `x-intake-token` = Vercel env `OUTREACH_INTAKE_TOKEN` (맥은 `~/agents-bd/.intake.env`). 상수 시간 비교.
- `POST /api/admin/proposals/{quoteId}/request` (토큰 또는 관리자) body `{mode:"create"|"regenerate"}` → 문서가 없으면 기존 자료로 만들고 요청 상태로. 이미 requested/running 이면 그대로 둔다. 응답 `{ok, doc}`.
- `GET /api/admin/proposals/jobs/next` (토큰) → 없으면 204. 있으면 200 `{job:{quoteId, mode, requestedAt, lead:{org,segment,score,name,email,phone,notes,outreach}, current: BookContent}}`. 원자적으로 requested→running. running 이 20분 넘으면 재요청(시도 2회까지), 넘으면 failed.
- `POST /api/admin/proposals/{quoteId}/worker-result` (토큰) body `{ok:true, content}` 또는 `{ok:false, error}` → `{ok, applied}`.

### 표 변경 — `supabase/migrations/20261016_proposal_jobs.sql`

`proposal_docs` 에 추가: `gen_status text not null default 'idle'`(idle|requested|running|done|failed), `gen_mode text`, `gen_requested_at`, `gen_started_at`, `gen_finished_at timestamptz`, `gen_requested_rev integer`, `gen_attempts integer not null default 0`, `gen_error text`, `gen_result jsonb`, `gen_result_at timestamptz`. 인덱스 `(gen_status, gen_requested_at)`.
