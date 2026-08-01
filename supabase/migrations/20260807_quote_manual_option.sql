-- ============================================================
-- 설명서 생산 선택지 (2026-08-07)
--
-- 폼에 "설명서 생산" 항목이 추가됐다 (제작 희망 디자인 아래, 포장 방식 위):
--   guide  도면 내 간단한 조립 가이드로 갈음 — 무료
--   qr     도면 내 QR 코드 및 영상 삽입 — 종당 +100만원~
--   print  설명서 및 표지 생산 — 부수당 300원 (OPP·박스 생산 시 추천)
--
-- 디자인 라인별 설계 난이도(simple/normal/complex)는 별도 컬럼 없이
-- 기존 designs JSONB 안에 complexity 필드로 함께 저장된다.
--
-- 기존 문의는 기본값('')으로 남는다.
--
-- 멱등 (여러 번 실행해도 안전).
-- ============================================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS manual_option TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN quotes.manual_option IS '설명서 생산 — guide(도면 내 가이드) / qr(QR·영상) / print(인쇄 설명서)';

-- PostgREST 스키마 캐시 즉시 리로드 — 없으면 컬럼을 만들어도 REST 가 한동안
-- 못 알아채(PGRST205) 저장이 조용히 실패한다.
NOTIFY pgrst, 'reload schema';
