-- ============================================================
-- 주문 형태 (2026-08-04)
--
-- 무엇을 받을 것인지 — 도면만 / 제품 생산 / 완제품. 견적 구조가 통째로 달라진다.
--   blueprint  디자인비만 (실물 없음 → 수량·포장 개념 없음)
--   production 디자인비 + 생산비 + 포장비
--   finished   제작비 하나로 (조립·설치 포함, 수량으로 곱하지 않음)
--
-- 그동안은 /products 에서 넘어온 ?ptype= 값을 quotes.notes 에
-- "[주문 형태: …]" 문자열로 적어 뒀다. 이제 폼에서 직접 고르고 견적에도
-- 쓰이므로 집계·필터가 가능한 컬럼으로 승격한다.
--
-- 기존 문의는 빈 값으로 남는다 — notes 의 문자열이 그대로 남아 있어
-- 과거 건은 거기서 확인할 수 있다. 굳이 추측해 채우지 않는다.
--
-- 멱등 (여러 번 실행해도 안전).
-- ============================================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN quotes.order_type IS
  '주문 형태: blueprint(도면만) | production(제품 생산) | finished(완제품). 빈 값은 폼 개편 이전 문의.';

CREATE INDEX IF NOT EXISTS quotes_order_type_idx ON quotes (order_type);

-- PostgREST 스키마 캐시 즉시 리로드 — 없으면 컬럼을 만들어도 REST 가 한동안
-- 못 알아채(PGRST205) 저장이 조용히 실패한다.
NOTIFY pgrst, 'reload schema';
