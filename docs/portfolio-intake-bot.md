# 포트폴리오 자동 등록 봇 (Slack → 포트폴리오 초안)

Slack 채널에 완성품 사진을 올리면 파일명을 읽어 고객·제작 시기·명칭을 뽑고, Claude 가 사진을 보고
제목·요약·본문·alt 를 써서 **비공개 초안**으로 등록한다. 결과는 그 메시지의 스레드에 답글로 달린다.
공개는 어드민에서 사람이 확인한 뒤 켠다 — 대외 노출은 자동으로 하지 않는다.

```
Slack 채널에 사진 올림 (파일명 = 고객명-YYMMDD-명칭 (n).jpg)
   │  Events API (message.channels)
   ▼
POST /api/slack/events ── 서명 검증 → 3초 안에 200 → after() 로 이어서
   │  파일 내려받기(files:read)
   ▼
runPortfolioIntake()   src/lib/portfolio-intake-run.ts
   ├─ 파일명으로 묶기            src/lib/portfolio-intake.ts (순수 규칙, 테스트 대상)
   ├─ 사진 준비 1920 저장판·1280 비전판   src/lib/portfolio-intake-images.ts
   ├─ Claude 가 글 작성 (JSON 강제)
   ├─ Supabase uploads 버킷에 업로드
   └─ portfolio_items 에 published=false 로 저장 (같은 묶음이 있으면 사진만 덧붙임)
   │
   ▼
스레드 답글: 제목 + 어드민 편집 링크, 건너뛴 파일과 이유   + ✅/❌ 반응
```

같은 뒷단을 CLI 로도 두드릴 수 있다 (`scripts/portfolio-intake.mjs`). 봇을 붙이기 전 시험 운전과
수동 일괄 등록에 쓴다.

## 파일명 규칙

```
고객명-YYMMDD-명칭 (n).jpg
```

| 예 | 고객 | 제작 시기 | 명칭 | n |
|---|---|---|---|---|
| `서울문화교육센터-260907- 무대 위 안무가들 (3).jpg` | 서울문화교육센터 | 2026-09-07 | 무대 위 안무가들 | 3 |
| `온더룩-261013-고양이탈 (1).jpg` | 온더룩 | 2026-10-13 | 고양이탈 | 1 |
| `경주박물관-20260301-금관 마스크.png` | 경주박물관 | 2026-03-01 | 금관 마스크 | 1 |

- 하이픈 옆 공백은 있어도 된다. **고객명에는 하이픈을 쓸 수 없다** (첫 하이픈까지가 고객명).
- 날짜는 6자리(YYMMDD) 또는 8자리. 달력에 없는 날이면 그 파일은 건너뛰고 답글에 이유를 적는다.
- `(n)` 또는 `_n` 이 사진 번호다. `-n` 은 명칭의 일부로 본다(`아이오닉-5`).
- 고객·날짜·명칭이 같은 사진은 **한 사례**로 묶인다. 한 메시지에 여러 사례를 섞어 올려도 된다.
- 같은 묶음을 나중에 또 올리면 새 사례를 만들지 않고 **기존 초안에 사진을 덧붙인다**
  (제목·본문은 그대로, alt 만 새로). 식별자는 `portfolio_items.airtable_id = "intake:<고객|날짜|명칭>"`.
- **이미 공개된 사례에는 덧붙이지 않는다.** 사람이 보지 않은 사진·alt 가 사이트에 바로 노출되기 때문이다.
  답글에 "이미 공개된 사례입니다" 로 적히고, 사진은 어드민에서 직접 추가한다 (CLI 는 `--publish` 로 명시하면 붙인다).
- jpg·png·webp 만 받는다. 한 메시지 20장. Slack 경로는 한 장 15MB 까지, CLI 는 본문 한계(4.5MB) 안에서 줄여 보낸다.

## 설정 체크리스트

### 1. Vercel 환경변수 (production)

| 이름 | 용도 | 비고 |
|---|---|---|
| `PORTFOLIO_INTAKE_SECRET` | `/api/portfolio/intake` 인증 (`x-webhook-secret`) | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | 글 생성 | console.anthropic.com 에서 발급. 없으면 봇은 "생성할 수 없습니다" 로 실패하고 답글에 그렇게 적는다 |
| `SLACK_SIGNING_SECRET` | Slack 요청 서명 검증 | 앱 Basic Information |
| `SLACK_BOT_TOKEN` | 파일 내려받기·답글·반응 | `xoxb-…`, 앱 설치 후 OAuth & Permissions |
| `SLACK_PORTFOLIO_CHANNEL_ID` | (선택) 이 채널만 받는다 | 비우면 봇이 초대된 모든 채널 |
| `PORTFOLIO_INTAKE_MODEL` | (선택) 생성 모델 | 기본 `claude-opus-5-5` |

```bash
vercel env add PORTFOLIO_INTAKE_SECRET production
vercel env add ANTHROPIC_API_KEY production
vercel env add SLACK_SIGNING_SECRET production
vercel env add SLACK_BOT_TOKEN production
```

환경변수를 넣은 뒤에는 **다시 배포해야** 반영된다 (`vercel deploy --prod`, 약 7분).

### 2. Slack 앱

1. https://api.slack.com/apps → **Create New App → From a manifest** → 워크스페이스 선택 →
   `docs/slack-portfolio-bot-manifest.json` 내용을 붙여 넣는다.
2. **Install to Workspace**. 설치가 끝나면 OAuth & Permissions 의 Bot User OAuth Token(`xoxb-…`)과
   Basic Information 의 Signing Secret 을 Vercel 에 넣고 재배포한다.
3. 재배포 뒤 Event Subscriptions 화면에서 Request URL 을 다시 저장(Retry)해 **Verified** 가 뜨는지 본다.
   서버가 `url_verification` 에 `challenge` 로 응답해야 통과한다. 403/503 이면 서명 시크릿이나 봇 토큰이
   비어 있다는 뜻이다.
4. 대상 채널에서 `/invite @포트폴리오 봇`. 비공개 채널이면 그 채널 안에서 초대해야 한다.
5. 사진을 올려 본다. 수십 초 뒤 👀 → ✅ 와 스레드 답글이 달린다.

### 3. DB 인덱스 (권장)

모바일 Slack 은 사진 한 장을 메시지 하나로 연달아 올린다. 메시지마다 함수가 따로 뜨므로 같은 묶음이 동시에
들어오면 초안이 둘이 될 수 있다. 코드는 조회 직후 빈 행을 먼저 넣어(자리 잡기) 틈을 줄이지만, 완전히 막으려면
유니크 인덱스를 한 번 만들어 둔다 — `supabase/migrations/20261013_portfolio_intake_unique.sql`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_items_intake_key_unique
  ON portfolio_items (airtable_id)
  WHERE airtable_id LIKE 'intake:%';
```

Supabase Dashboard > SQL Editor 에 붙여 넣어 실행한다. 어드민 > DB 셋업은 테이블·컬럼 유무만 보므로 이 인덱스는
거기 뜨지 않는다 (`/api/admin/migrate` 허용 목록에는 올려 두었다). 인덱스가 생기면 충돌한 요청은 먼저 생긴 행에
사진을 덧붙인다.

### 4. 점검

```bash
# 서버 설정 상태 — 어떤 환경변수가 비었는지
PORTFOLIO_INTAKE_SECRET=… node scripts/portfolio-intake.mjs --probe

# 파일 묶음만 확인 (네트워크 없음)
node scripts/portfolio-intake.mjs --plan ./사진폴더

# 글만 생성해 보기 (업로드·저장 없음)
PORTFOLIO_INTAKE_SECRET=… node scripts/portfolio-intake.mjs --dry-run ./사진폴더

# 초안으로 등록
PORTFOLIO_INTAKE_SECRET=… node scripts/portfolio-intake.mjs ./사진폴더
```

`--content 파일.json` 을 주면 서버 생성을 건너뛰고 그 내용으로 등록한다. 형식은
`{ "<키>": { "title": …, "summary": …, "description": …, "category": …, "clientType": …, "tags": [], "keywords": [], "imageAlts": [] } }`
이고 키는 `--plan` 출력의 `키:` 줄이다. ANTHROPIC_API_KEY 가 아직 없을 때의 시험 운전과, 사람이 쓴 글로
올릴 때 쓴다.

## 글 생성 규칙

고정 지시문은 `src/lib/portfolio-intake.ts` 의 `INTAKE_SYSTEM_PROMPT`. 발행된 사례(현대자동차 남산 타워 팝업북)의
문체를 예시로 넣었다. 요지:

- 사진·파일명에 없는 사실(수량·가격·납기·소재·설치 장소)은 쓰지 않는다. 자가 찍혔으면 "약 ○cm" 까지만.
- 제목 「고객명 + 작품명 + 형태」 20자 안팎, 요약 1~2문장 격식체, 본문 5~7문단(첫 문단 격식체, 이후 해요체,
  마지막은 "…참고하기 좋은 사례예요"). 사람 이름 금지.
- 카테고리·고객 유형은 사이트 목록 안에서만. 목록 밖 값이 오면 `normalizeGenerated()` 가 파일명 힌트로 보수적
  기본값을 고른다(예: "탈" → 모자/마스크).
- alt 는 사진 수와 같은 개수. 비면 null 로 두어 사이트가 제목 기반으로 대체한다.

모델 호출은 `output_config.format`(JSON 스키마 강제) + 프롬프트 캐시 + `fallbacks: "default"`(안전 분류기 거부 시
서버가 대체 모델로 재시도)로 한다. 사진 6장 기준 한 건에 대략 1~2만 입력 토큰이다.

## 한계와 주의

- **Vercel Hobby 플랜은 크론이 하루 1회**라서 폴링 방식은 쓸 수 없다. 그래서 Events API(푸시)다.
- 한 메시지 = 한 번의 처리다. 사진을 여러 메시지로 나눠 올리면 메시지마다 돌지만, 같은 파일명 묶음이면 기존 초안에
  덧붙으므로 결과는 하나의 사례다.
- Slack 은 3초 안에 응답이 없으면 같은 이벤트를 3번까지 다시 보낸다. 라우트는 즉시 200 을 돌려주고 `after()` 로
  처리한다. 재전송 가운데 "느려서"(`X-Slack-Retry-Reason: http_timeout`) 온 것은 첫 요청이 처리 중이니 버리고,
  우리가 5xx 를 냈거나 연결이 끊겨 온 것은 처리된 적이 없으니 받는다. 그래도 Vercel 함수가 처리 도중 죽으면
  (maxDuration 300초 초과 등) 답글 없이 끝날 수 있다 — 그때는 같은 사진을 다시 올리면 기존 초안에 덧붙는다.
- 생성 한 번은 100초에서 끊는다(재시도 없음). 한 메시지에 묶음이 셋 넘게 섞이면 300초를 넘길 수 있으니 묶음은
  메시지를 나눠 올리는 편이 안전하다.
- 사진을 덧붙일 때는 행을 다시 읽어 `images`·`image_alts` 만 갱신한다. 생성하는 1~2분 사이 어드민에서 고친
  제목·본문은 덮어쓰지 않는다.
- 한글 고객명·제목은 슬러그에 남지 않아 공개 주소가 `/portfolio/case-xxxxxxxx` 꼴이 된다. 어드민에서 영문 슬러그를
  손보면 된다 (기존 사례와 같은 동작).
- 인테이크로 올린 사진은 이미 1920 폭으로 줄여 올리고 `shrink-images/v1` 표식을 남기므로 유지보수 축소 작업이
  다시 건드리지 않는다.
- 생성 실패(키 없음·모델 거부·JSON 아님)는 묶음 단위로 격리된다. 다른 묶음은 계속 처리되고, 실패한 묶음은 답글에
  이유가 적힌다. 업로드까지 됐는데 저장이 실패하면 저장소에 고아 파일이 남을 수 있다(드묾, 수동 정리).
