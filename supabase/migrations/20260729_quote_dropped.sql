-- ============================================================
-- 제작 문의 Drop(제외) 처리 (2026-07-29)
--
-- quotes.dropped_at 추가 — 값이 있으면 "Drop 처리"된 문의.
--  · 제작 문의 목록(/admin/quotes)에서는 dropped_at IS NULL 만 보인다.
--  · 운영 > Drop(/admin/drops)에서 dropped_at 이 있는 것만 따로 본다(복구 가능).
-- 단계(stage)의 on_hold(보류·취소)와는 별개 — 그건 여전히 목록에 남는 진행 단계다.
--
-- 모든 구문이 IF NOT EXISTS 라 여러 번 실행해도 안전하다.
-- ============================================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS dropped_at TIMESTAMPTZ;

-- Drop 목록은 dropped_at 최신순으로 훑으므로 인덱스를 건다
CREATE INDEX IF NOT EXISTS quotes_dropped_at_idx ON quotes (dropped_at);

-- PostgREST(supabase-js 가 쓰는 REST 레이어) 스키마 캐시 즉시 리로드.
-- 이게 없으면 컬럼을 만들어도 REST 가 한동안 못 알아채(PGRST205) 어드민이
-- "아직 없음"으로 보고 → "실행해도 그대로"인 것처럼 보이는 함정이 있다.
NOTIFY pgrst, 'reload schema';
