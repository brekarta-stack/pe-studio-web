# PE Studio Web

**Paper Engineering Studio (PE Studio)** 공식 웹사이트 및 백오피스 — https://www.papercraft.kr

> 저장소 이름이 `actioncraft-web` 에서 `pe-studio-web` 으로 바뀌었습니다 (2026-07-28).
> GitHub 이 옛 URL 을 리다이렉트하지만, 기존 클론은 아래로 갱신해 두세요.
> ```bash
> git remote set-url origin https://github.com/brekarta-stack/pe-studio-web.git
> ```
> ⚠️ `actioncraft-web` 이름으로 새 저장소를 만들면 리다이렉트가 즉시 깨집니다.
> Vercel 프로젝트 이름(`actioncraft-web`)과 `actioncraft-web.vercel.app` 은 그대로입니다 —
> 바꾸려면 `NEXTAUTH_URL` 과 Google OAuth 리다이렉트 URI 를 함께 갱신해야 합니다.

## 스택

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind 4 · Supabase · NextAuth (Google)

## 시작하기

```bash
npm install
# .env.local 준비 (아래 표 참고) — 또는 vercel env pull
npm run dev                  # http://localhost:3000
```

### 필요한 환경변수

| 변수 | 용도 |
|---|---|
| `ADMIN_EMAIL` | 어드민 로그인을 허용할 Google 계정 (없으면 앱이 뜨지 않음) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | NextAuth Google 로그인 |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | 세션 서명·콜백 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 서버에서 DB 접근 (RLS 우회) |
| `SUPABASE_ACCESS_TOKEN` | (선택) 어드민 > DB 셋업에서 마이그레이션 자동 실행 |
| `RESEND_API_KEY` | 견적 접수 알림·자동회신 메일 |

## 명령어

```bash
npm run dev     # 개발 서버
npm run build   # 프로덕션 빌드 (타입체크 포함)
npm run lint    # ESLint
npm test        # node --test — 도면 산출물·배정 로직 검증
```

## 백오피스 (`/admin`)

| 그룹 | 메뉴 | 하는 일 |
|---|---|---|
| — | 대시보드 · 유입·클릭 분석 | 요약 지표, 자체 수집 트래픽 분석 |
| **운영** | **제작 문의** | 견적 문의를 시트로 조회. 수집 항목 전체를 컬럼으로 노출하고, 진행 여부·단계·담당 아티스트를 인라인 편집 |
| **운영** | **작업 관리** | 리드↔아티스트 배정, 진행률·작업비·청구금액·마진·납기(D-day)·지급상태 관리 |
| 콘텐츠 | 작업 포트폴리오 · 아티스트 · 블로그 · 도면 검수 | 사이트 노출 콘텐츠 편집 (아티스트는 **프로필**만) |
| 시스템 | DB 셋업 | 테이블·컬럼 존재 확인, 누락된 마이그레이션 실행 |

`아티스트`(프로필)와 `작업 관리`(업무 배정)는 목적이 다릅니다 — 전자는 사이트에 노출되는 인물 소개,
후자는 그 아티스트에게 실제로 배정된 작업 건입니다.

## 데이터베이스

Supabase(Postgres). 스키마는 `supabase/schema.sql`, 이후 변경은 `supabase/migrations/` 에 날짜순으로 쌓습니다.
모든 구문이 `IF NOT EXISTS` 라 여러 번 실행해도 안전합니다.

적용 방법은 두 가지입니다.

1. **어드민 > DB 셋업** — 누락된 테이블·컬럼을 감지해 필요한 마이그레이션만 보여줍니다.
   `SUPABASE_ACCESS_TOKEN` 이 설정돼 있으면 **마이그레이션 실행** 버튼으로 바로 적용됩니다.
2. **수동** — 같은 화면에서 **SQL 복사** 후 Supabase 대시보드 > SQL Editor 에 붙여넣고 Run.

> supabase-js(PostgREST)로는 `CREATE TABLE` 같은 DDL 을 실행할 수 없어, 자동 실행은
> Supabase Management API 를 씁니다. 그래서 프로젝트 키가 아닌 계정 단위 Personal Access Token
> (`SUPABASE_ACCESS_TOKEN`)이 필요합니다. Supabase Dashboard > Account > Access Tokens 에서 발급하세요.

### 주요 테이블

| 테이블 | 내용 |
|---|---|
| `quotes` | 견적 문의. `in_progress`(진행 체크) · `stage`(8단계) 포함 |
| `assignments` | 리드↔아티스트 배정. 작업비·청구금액·진행률·납기·지급상태 |
| `artists` | 아티스트 프로필 (사이트 노출용) |
| `portfolio_items` · `posts` · `analytics_events` · `studio_reviews` | 콘텐츠·분석·도면 검수 |
