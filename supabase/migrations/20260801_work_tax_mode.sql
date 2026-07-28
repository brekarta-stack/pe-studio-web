-- ============================================================
-- 작업 관리 세금 처리 (2026-08-01)
--
-- 세금은 "켠 경우에만" 계산한다. 그래서 기본값은 전부 세금 없음/미포함이다.
--   · client_vat    : 매출에 부가세 10% 를 더해 청구하면 true
--   · fee_tax_mode  : 아티스트에게 줄 작업비의 세금 처리
--       'none'        세금 처리 없이 액면 그대로 지급
--       'vat'         사업자 → 작업비 + 부가세 10% 지급 (세금계산서 수취)
--       'withholding' 프리랜서 → 작업비 − 원천징수 3.3% 지급
--
-- 금액 컬럼(artist_fee·client_amount·deposit_amount)은 계속 **세전** 기준으로
-- 저장한다. 세액은 화면에서 계산한다 — 저장하면 세율 변경 시 과거가 어긋난다.
--
-- 멱등 (여러 번 실행해도 안전).
-- ============================================================

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS client_vat   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS fee_tax_mode TEXT    NOT NULL DEFAULT 'none';

-- 프리랜서로 일하는 아티스트(문재호)의 기존 배정은 원천징수 3.3% 로 맞춰 둔다.
-- 아직 기본값('none')인 건만 건드리므로 나중에 수동으로 바꾼 값은 보존된다.
UPDATE assignments a
   SET fee_tax_mode = 'withholding'
  FROM artists ar
 WHERE a.artist_id = ar.id
   AND ar.name = '문재호'
   AND a.fee_tax_mode = 'none';

-- PostgREST(supabase-js 가 쓰는 REST 레이어) 스키마 캐시 즉시 리로드.
NOTIFY pgrst, 'reload schema';
