-- ============================================================
-- 샘플링 옵션 + 제품 이용 연령 (2026-08-05)
--
-- 폼의 '제작' 섹션 개편으로 수집 항목이 늘었다:
--   sampling_improve  샘플링을 보고 디자인 개선 희망 (B2B 권장 박스의 하위 선택)
--   supervision       생산 시 감리 진행 희망
--   age_groups        제품 이용 연령 — 복수 선택. 폼 라벨 문자열 그대로
--                     ["6세~7세 (유치원생)", ...] 형태의 jsonb 배열
--
-- 기존 문의는 기본값(false / [])으로 남는다.
--
-- 멱등 (여러 번 실행해도 안전).
-- ============================================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sampling_improve BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS supervision      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS age_groups       JSONB   NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN quotes.sampling_improve IS '샘플링을 보고 디자인 개선 희망';
COMMENT ON COLUMN quotes.supervision      IS '생산 시 감리 진행 희망';
COMMENT ON COLUMN quotes.age_groups       IS '제품 이용 연령 (복수 선택) — 폼 라벨 문자열 배열';

-- PostgREST 스키마 캐시 즉시 리로드 — 없으면 컬럼을 만들어도 REST 가 한동안
-- 못 알아채(PGRST205) 저장이 조용히 실패한다.
NOTIFY pgrst, 'reload schema';
