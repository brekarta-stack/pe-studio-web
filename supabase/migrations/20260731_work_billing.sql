-- ============================================================
-- 작업 관리 정산 구조 — 선금/잔금 + 부가세 (2026-07-31)
--
-- 금액 정책: assignments.artist_fee(작업비 원가) 와 client_amount(매출) 는
--   모두 **공급가액(부가세 별도)** 으로 저장한다. 부가세(10%)와 합계는
--   화면에서 자동 계산한다 — 저장하면 세율 변경 시 과거 데이터가 어긋난다.
--
-- 지급(작업비 송금)은 선금/잔금 2회로 나눠 관리한다:
--   · deposit_amount    : 선금 금액 (공급가액). NULL/0 이면 선금 없이 잔금 일괄.
--   · deposit_paid_at   : 선금 지급일. NULL 이면 미지급.
--   · balance_paid_at   : 잔금 지급일. NULL 이면 미지급.
--   잔금 = artist_fee − deposit_amount (자동 계산, 별도 저장 안 함)
--   payout_status 는 위 둘로부터 도출해 저장한다(기존 화면 호환 유지).
--
-- 멱등 (여러 번 실행해도 안전).
-- ============================================================

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS deposit_amount  BIGINT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS deposit_paid_at DATE;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS balance_paid_at DATE;

-- 기존 데이터 이행: 이미 '지급완료'인 건은 잔금까지 지급된 것으로 본다.
-- (선금 개념이 없던 시절 데이터라 전액을 잔금 1회 지급으로 취급)
UPDATE assignments
   SET balance_paid_at = COALESCE(balance_paid_at, paid_at::date, updated_at::date)
 WHERE payout_status = 'paid'
   AND balance_paid_at IS NULL;

-- PostgREST(supabase-js 가 쓰는 REST 레이어) 스키마 캐시 즉시 리로드.
-- 이게 없으면 컬럼을 만들어도 REST 가 한동안 못 알아채(PGRST205) 저장이 조용히 실패한다.
NOTIFY pgrst, 'reload schema';
