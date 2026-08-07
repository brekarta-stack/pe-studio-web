# 블로그 주간 자동 발행

주 1회, **화·수·목 중 랜덤 요일**, **14:00~16:00 KST 사이 30분 단위 랜덤 시각**에
대기열의 글을 자동 발행한다.

## 동작 방식

```
admin 에서 글 작성(비공개) ──[자동 발행 대기열 체크]──▶ posts.queued = true
                                                          │
Vercel Cron (화~목 14~16시 KST, 30분 간격)                 ▼
  GET /api/cron/blog-publish ──▶ 이번 주 슬롯 계산(결정론) ─▶ 슬롯 도달 & 미발행이면
                                                          대기열 맨 앞 글 발행
```

- **슬롯 계산**: `src/lib/blog-schedule-shared.mjs`의 `weeklySlot()`.
  ISO 주차 문자열을 해시해 요일·시각을 고르므로 **같은 주에는 항상 같은 슬롯**이 나온다.
  크론이 여러 번 두드려도 이중 발행이 없고, 특정 틱이 실패해도 다음 틱이 이어받는다.
- **주 1회 가드**: 발행 시 `auto_published_at`을 찍고, 이번 주에 찍힌 글이 있으면 건너뛴다.
- **대기열 순서**: `queued = true AND published = false`인 글 중 `created_at`이 가장 오래된 것.
- **대기열이 비면** 그 주는 발행을 건너뛴다 (빈 글을 억지로 내지 않는다).
- 발행 시 `created_at`을 실제 발행 시각으로 덮어써 목록 정렬·표시 날짜가 자연스럽다.

## 설정 체크리스트

1. **DB 마이그레이션**: `supabase/migrations/20260808_blog_scheduling.sql` 적용
   (posts에 `queued`, `auto_published_at` 컬럼 추가).
2. **환경변수** (Vercel): `CRON_SECRET` 설정 — Vercel Cron이 자동으로
   `Authorization: Bearer $CRON_SECRET` 헤더를 붙인다.
   기존 `BLOG_PUBLISH_SECRET`(`x-webhook-secret` 헤더)로도 수동 호출 가능.
3. **크론 스케줄**: `vercel.json`의 `*/30 5-7 * * 2-4` (UTC) = 화~목 14:00~16:30 KST.
   ⚠️ Vercel **Hobby 플랜은 크론이 하루 1회로 제한**된다. Hobby라면
   GitHub Actions 스케줄러 등 외부에서 같은 엔드포인트를 호출하도록 바꿔야 한다
   (엔드포인트는 호출 주체와 무관하게 동작이 같다).

## 수동 트리거 / 점검

```bash
# 상태 확인 겸 수동 트리거 (슬롯 전이면 before-slot, 발행 후면 already-published 응답)
curl -H "x-webhook-secret: $BLOG_PUBLISH_SECRET" https://www.papercraft.kr/api/cron/blog-publish
```

응답의 `skipped` 값: `before-slot`(아직 슬롯 전) / `already-published-this-week` /
`empty-queue`(대기열 비어 있음 — 글을 채워야 다음 주에 나간다).

## 콘텐츠 규칙

새 글 작성 기준은 `docs/blog-content-guide.md`,
코퍼스 스타일 규칙 자동 검사는 `tests/blog-style.test.mjs` 참고.
