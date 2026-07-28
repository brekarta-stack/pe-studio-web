-- ============================================================
-- 제작 문의 다중 첨부파일 (2026-07-30)
--
-- 그동안 참고 자료는 파일 1개(file_url)만 저장했다. 이제 최대 5개까지
-- 올릴 수 있게 quotes.files 를 신설한다 — [{ "name": 표시명, "url": 공개URL }] 배열.
--   · 폼(/quote)에서 여러 파일을 업로드해 이 배열에 담고,
--   · 어드민 제작 문의 목록의 '첨부' 열에서 모두 링크로 보여준다.
-- 기존 file_url/logo_file_url 은 그대로 둔다(옛 데이터 열람 호환).
--
-- 멱등 (여러 번 실행해도 안전).
-- ============================================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS files JSONB NOT NULL DEFAULT '[]'::jsonb;

-- PostgREST(supabase-js 가 쓰는 REST 레이어) 스키마 캐시 즉시 리로드.
-- 이게 없으면 컬럼을 만들어도 REST 가 한동안 못 알아채(PGRST205) 저장이 조용히 실패한다.
NOTIFY pgrst, 'reload schema';
