-- ============================================================
-- 제작 희망 디자인 목록 (2026-08-03)
--
-- 제작 문의 폼이 "디자인 라인"을 받도록 바뀐다.
--   한 줄 = { 이름, 수량, 참고 자료 1개 }
--   총 생산 종류 = 라인 수, 총 수량 = 라인별 수량 합계
--
-- quotes.designs 에 JSONB 배열로 저장한다:
--   [{ "name": "마스코트 A", "quantity": "1000",
--      "file": { "name": "ref.png", "url": "https://…" } }, …]
--
-- 기존 quotes.quantity(TEXT)는 계속 채운다 — 총 수량을 넣어 둬서
-- 어드민 시트·CSV·대시보드 등 quantity 를 읽는 기존 화면이 그대로 동작한다.
-- (designs 가 비어 있는 옛 문의도 quantity 만으로 계속 읽힌다)
--
-- quotes.files 와 같은 JSONB 배열 방식 — 개수가 적고 항상 통째로 읽는다.
--
-- 멱등 (여러 번 실행해도 안전).
-- ============================================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS designs JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN quotes.designs IS
  '제작 희망 디자인 목록 [{name,quantity,file:{name,url}}]. 종류=배열 길이, 총수량=quantity 합계.';

-- PostgREST(supabase-js 가 쓰는 REST 레이어) 스키마 캐시 즉시 리로드.
-- 이게 없으면 컬럼을 만들어도 REST 가 한동안 못 알아채(PGRST205) 저장이 조용히 실패한다.
NOTIFY pgrst, 'reload schema';
