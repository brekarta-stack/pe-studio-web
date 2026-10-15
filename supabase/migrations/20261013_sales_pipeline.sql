-- ============================================================
-- 영업 파이프라인 개편 — 아웃바운드 · 완료 분리 · 월 정산 (2026-10-13)
-- 설계 정본: docs/sales-pipeline-plan.md §3
--
-- 1) quotes 확장 — 아웃바운드(먼저 보내는 제안)를 같은 표에 싣는다.
--    · source 는 영원히 남는다. 아웃바운드에서 전환된 건도 'outbound' 를 유지한 채
--      단계만 consulting 으로 옮긴다 — 그래야 아웃바운드의 매출 기여를 셀 수 있다.
--    · org_key 는 앱(normalizeOrgKey)이 계산한 정규화 기관명. 중복 제안 판정이
--      캠페인 slug 가 아니라 기관 단위여야 해서 따로 둔다(국립생태원 중복 제안 사례).
--    · stage 값 4개(sourced·drafted·sent·followup)가 늘지만 DB 에 CHECK 제약이
--      없으므로(기존 방식) 앱 검증(isQuoteStage)만 넓힌다.
-- 2) lead_activities 신설 — 접촉 기록. **append-only** 다.
--    수정·삭제 경로를 만들지 않는다 — 감사 기록이자 CRM 타임라인이므로.
-- 3) assignments.client_paid_at — 고객 입금일. NULL 이면 미수.
--    지금까지는 작업비 지급일만 있고 수금일이 없어 월 정산을 낼 수 없었다.
--
-- 모든 구문이 IF NOT EXISTS / COALESCE 라 여러 번 실행해도 안전하다.
-- ============================================================

-- ── 1. quotes 확장 ──────────────────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS source           TEXT NOT NULL DEFAULT 'inbound';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS org              TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS org_key          TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS segment          TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS score            INTEGER;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS proposal_url     TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS proposal_sent_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS proposal_sent_to TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS next_action_at   DATE;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_at     TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS closed_at        TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_reason      TEXT;
-- 발굴 에이전트 산출물 원문 {subject, body_text, matched_cases, image_prompt, slug…}
-- 형태가 자주 바뀌므로 컬럼으로 쪼개지 않고 통째로 보관한다
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS outreach         JSONB;

-- 보드 분리(source) · 중복 판정(org_key) · 팔로업 지연 정렬(next_action_at) ·
-- 완료 화면 정렬과 월 집계(closed_at) 가 각각 이 컬럼으로 훑는다
CREATE INDEX IF NOT EXISTS quotes_source_idx         ON quotes (source);
CREATE INDEX IF NOT EXISTS quotes_org_key_idx        ON quotes (org_key);
CREATE INDEX IF NOT EXISTS quotes_next_action_at_idx ON quotes (next_action_at);
CREATE INDEX IF NOT EXISTS quotes_closed_at_idx      ON quotes (closed_at);

-- ── 2. lead_activities (append-only) ───────────────────────
-- kind: note|call|email|meeting|proposal_sent|stage|convert|drop|restore|system
-- (CHECK 제약 없이 앱의 isActivityKind 로 검증 — quotes.stage 와 같은 방침)
CREATE TABLE IF NOT EXISTS lead_activities (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    UUID        NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL,
  body        TEXT        NOT NULL DEFAULT '',
  actor       TEXT        NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 타임라인은 리드 하나의 기록을 최신순으로 읽는다
CREATE INDEX IF NOT EXISTS lead_activities_quote_occurred_idx
  ON lead_activities (quote_id, occurred_at DESC);

-- RLS 를 켜고 정책은 만들지 않는다 → anon/authenticated 는 아무것도 못 하고
-- service role(서버의 supabaseAdmin)만 읽고 쓴다. 앱에도 update/delete 함수가 없다.
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

-- ── 3. assignments 수금일 ──────────────────────────────────
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS client_paid_at DATE;

-- ── 4. 기존 데이터 이행 ────────────────────────────────────
-- 이미 납품·정산된 건은 완료 시각을 모르므로 접수일로 채운다.
-- 완료 화면 정렬용 근사치일 뿐 — 실제 완료일이 아니다. 이후 완료되는 건은 앱이 정확히 기록한다.
UPDATE quotes
   SET closed_at = COALESCE(closed_at, created_at)
 WHERE stage IN ('delivered', 'settled')
   AND closed_at IS NULL;

-- PostgREST(supabase-js 가 쓰는 REST 레이어) 스키마 캐시 즉시 리로드.
-- 이게 없으면 컬럼·표를 만들어도 REST 가 한동안 못 알아채(PGRST205) 어드민이
-- "아직 없음"으로 보고 → "실행해도 그대로"인 것처럼 보이는 함정이 있다.
NOTIFY pgrst, 'reload schema';
