-- ============================================================
-- 별도 가공 + 만드는 방식 + 디자인 설계 스타일 (2026-08-06)
--
-- 폼 개편 2차로 수집 항목이 또 늘었다:
--   premium_finish   별도 가공·고급 소재 사용 희망 (B2B 옵션 박스, 납기 +1주)
--   assembly_method  만드는 방식 — 목공풀 / 끼워 만들기 / PE 스튜디오 추천. 라벨 그대로
--   design_style     디자인 설계 스타일 — 폴리곤 / 파츠 결합 / PE STUDIO 권장. 라벨 그대로
--
-- 기존 문의는 기본값(false / '')으로 남는다.
--
-- 멱등 (여러 번 실행해도 안전). 20260805 와 함께 실행해도 된다.
-- ============================================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS premium_finish  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS assembly_method TEXT    NOT NULL DEFAULT '';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS design_style    TEXT    NOT NULL DEFAULT '';

COMMENT ON COLUMN quotes.premium_finish  IS '별도 가공·고급 소재 사용 희망';
COMMENT ON COLUMN quotes.assembly_method IS '만드는 방식 — 폼 라벨 문자열 그대로';
COMMENT ON COLUMN quotes.design_style    IS '디자인 설계 스타일 — 폼 라벨 문자열 그대로';

-- PostgREST 스키마 캐시 즉시 리로드 — 없으면 컬럼을 만들어도 REST 가 한동안
-- 못 알아채(PGRST205) 저장이 조용히 실패한다.
NOTIFY pgrst, 'reload schema';
