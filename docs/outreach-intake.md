# 발굴 리드 인테이크 API

`POST /api/admin/outreach/intake` — 발굴 에이전트가 찾은 기관(아웃바운드 리드)을 백오피스 `quotes` 에 넣는 입구다.

## 왜 있는가

- **기존 자산 이관**: 옛 발굴 에이전트(`~/agents-bd`)가 만든 제안 초안 109건은 기관 53곳에 몰려 있다(소방청 15번). 중복 방지 키가 기관이 아니라 캠페인 slug 였기 때문이다. 이 API 는 **기관당 1행**으로 묶고, 나머지 초안은 그 행의 활동 기록으로 남긴다.
- **매일 인테이크**: 발굴 에이전트를 다시 돌리면 같은 엔드포인트로 리드를 넣는다. 이전의 slug 원장(`outputs/proposals/proposed-ledger.json`)을 대체한다.
- **로컬에 DB 자격증명이 없다**: Vercel 환경변수가 Sensitive 라 내려받을 수 없다. 그래서 이관도 배포된 앱을 거친다.

기관 동일성은 `normalizeOrgKey(org)`(`src/lib/lead-activity-types.ts`)로만 판정한다. 예: `수원특례시청` · `수원특례시` · `수원시` → `수원`, `국립생태원(NIE)` · `국립 생태원` → `국립생태원`.

## 인증

다음 중 하나.

| 방식 | 값 |
|---|---|
| `x-intake-token: <토큰>` 헤더 | Vercel 환경변수 `OUTREACH_INTAKE_TOKEN` 과 같아야 한다 |
| `Authorization: Bearer <토큰>` 헤더 | 위와 같음 |
| 관리자 로그인 세션 | 어드민 화면에서 부를 때 |

토큰 비교는 상수 시간(`timingSafeEqual`)이다. 환경변수가 비어 있으면 토큰 경로는 닫히고 관리자 세션만 통한다. 아니면 `401`.
토큰은 코드·로그·커밋에 남기지 않는다.

## 요청

```json
{
  "dryRun": false,
  "leads": [
    {
      "org": "빙그레",
      "slug": "binggrae",
      "segment": "기업",
      "score": 4,
      "contactName": "홍보팀",
      "contactEmail": "pr@example.com",
      "phone": "02-000-0000",
      "contactFormUrl": "https://…",
      "subject": "메로나 페이퍼토이 제작 제안",
      "matchedCases": ["경찰청 포돌이"],
      "proposalUrl": "https://docs.google.com/presentation/d/…",
      "createdAt": "2026-06-16",
      "stage": "drafted",
      "bodyText": "## 제안 배경\n…",
      "imagePrompt": "a friendly …",
      "sourceFile": "2026-06-16-binggrae.md"
    }
  ]
}
```

- `org` 만 필수. 나머지는 생략 가능하고, 문자열은 앞뒤 공백을 자른다.
- `score` 는 0..10 정수로 반올림. 범위 밖(예: 100점 척도의 85)이나 숫자가 아니면 `null`.
- `stage` 는 제안 영업 단계(`sourced` · `drafted` · `sent` · `followup`)만.
- `createdAt` 은 날짜로 읽혀야 한다(`2026-06-16`, ISO 시각).
- 한 번에 **200건까지**. 넘으면 `413`. `leads` 가 배열이 아니면 `400`.
- 검증에 실패한 항목은 배치를 멈추지 않고 `skip` 으로 보고한다(사유에 `#인덱스`).

## 판정 규칙 (create / merge)

리드를 `createdAt` 오름차순으로 정렬한다(날짜 없는 건 맨 뒤, 같은 값은 입력 순서). 그다음 하나씩:

| 상황 | 동작 |
|---|---|
| 정규화 키가 비어 있음 | `skip` — "기관명을 정규화할 수 없음" |
| 처음 보는 기관 | `create` — `quotes` 1행(`source=outbound`). 단계는 `stage` 가 있으면 그것, 없으면 `proposalUrl` 이 있으면 `drafted`, 없으면 `sourced`. 활동 기록 "발굴 리드 등록 · slug" |
| 이미 있는 기관 (**Drop 된 행 포함**) | `merge` — 새 행을 만들지 않는다. 활동 기록에 "제안 초안 2026-06-16 · slug · 링크" 한 줄 |
| merge 이면서 제안서 링크 갱신 조건 충족 | 위에 더해 `proposal_url`·`outreach` 를 이 초안으로 바꾸고, `segment`·`score` 는 **비어 있을 때만** 채운다 |

- 링크 갱신 조건: 이 초안에 `proposalUrl` 이 있고, 기존 행에 링크가 없거나 이 초안이 기존 것보다 같거나 새로울 때. 날짜 없는 초안은 기존 링크를 덮지 않는다.
- 같은 배치 안에서 같은 기관이 두 번 나오면 첫 건이 `create`, 다음부터 `merge` 로 방금 만든 행에 붙는다.
- 같은 기관 행이 이미 여럿이면 살아 있는 행(Drop 아님) → 최신 행 순으로 하나를 고른다.
- 활동 기록의 `actor` 는 `intake`, `occurred_at` 은 초안의 `createdAt`.

## 응답

```json
{
  "ok": true,
  "summary": { "created": 1, "merged": 2, "skipped": 0 },
  "results": [
    { "org": "소방청", "orgKey": "소방청", "action": "create", "id": "uuid" },
    { "org": "소방청", "orgKey": "소방청", "action": "merge", "id": "uuid" }
  ]
}
```

- `200`: 전부 create/merge. `207`: skip 이나 실행 오류(`action: "error"`, `reason` 에 원인)가 하나라도 있음. 오류도 `skipped` 로 센다.
- create 는 됐지만 활동 기록만 실패하면 `action: "create"` 에 `reason: "활동 기록 실패: …"`.
- `503`: 영업 파이프라인 마이그레이션(`20261013_sales_pipeline.sql`) 미적용.
- `dryRun: true` 면 저장하지 않고 계획만 돌려준다: `{ ok, dryRun: true, summary, results }`. merge 대상이 기존 행이면 `existingId`, 같은 배치의 새 행이면 `reason: "같은 배치의 새 리드에 합침"`.

## 매일 인테이크 — 리드 한 건

```bash
curl -sS -X POST https://www.papercraft.kr/api/admin/outreach/intake \
  -H "content-type: application/json" \
  -H "x-intake-token: $OUTREACH_INTAKE_TOKEN" \
  -d '{"leads":[{"org":"국립생태원","slug":"nie-ecology-friends","segment":"공공","score":4,
       "subject":"생태 캐릭터 페이퍼토이 제안","proposalUrl":"https://docs.google.com/…",
       "createdAt":"2026-10-14"}]}'
```

`papercraft.kr`(맨도메인)은 `www` 로 리다이렉트된다. 리다이렉트를 따라가면 POST 헤더가 빠질 수 있으니 `www` 주소로 바로 보낸다.

## 기존 초안 일괄 이관

```bash
# 1) 계획만 확인 (저장 안 함)
OUTREACH_INTAKE_TOKEN=… node scripts/import-outreach.mjs payload.json --dry-run

# 2) 실제 삽입
OUTREACH_INTAKE_TOKEN=… node scripts/import-outreach.mjs payload.json [--chunk 50]
```

- `payload.json` = `{ "leads": [ … ] }` (위 요청 모양).
- 기본 주소는 `INTAKE_BASE_URL` 환경변수, 없으면 `https://www.papercraft.kr`. `--base` 로 바꾼다.
- 스크립트가 먼저 `createdAt` 오름차순으로 정렬하고, 청크를 **순서대로** 보낸다. 앞 청크에서 만든 기관에 뒤 청크 초안이 merge 된다.
- dry-run 은 저장하지 않아 청크 사이에 생성 결과가 이어지지 않으므로, 200건 이하면 한 요청으로 보낸다.
- 청크별 요약과 마지막에 기관·동작·id/사유 표, 합계를 찍는다. HTTP 오류(200·207 이외)면 그 자리에서 멈추고 종료 코드 1.
- 토큰은 출력하지 않는다.
- 다시 돌려도 기관 행이 늘지는 않지만 **활동 기록은 다시 쌓인다**(append-only). 같은 payload 를 두 번 넣지 않는다.
