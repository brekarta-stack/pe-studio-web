-- ============================================================
-- 제안서 편집기 — proposal_docs (2026-10-15)
-- 설계 정본: docs/proposal-editor-plan.md §2
--
-- 리드(quotes) 하나에 제안서 원고 하나. 원고·스타일·쪽 구성은 형태가 자주 바뀌므로
-- 컬럼으로 쪼개지 않고 JSONB 로 둔다 (검증은 앱의 zod 스키마가 맡는다).
-- rev 는 낙관적 잠금용이다 — 두 창에서 같은 문서를 고치면 나중 저장이 먼저 저장을
-- 조용히 덮어쓰므로, 앱이 "UPDATE … WHERE rev = 기대값" 으로 저장하고 rev 를 올린다.
--
-- 모든 구문이 IF NOT EXISTS / OR REPLACE 라 여러 번 실행해도 안전하다.
-- ============================================================

CREATE TABLE IF NOT EXISTS proposal_docs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    UUID        NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
  content     JSONB       NOT NULL,
  style       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  pages       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- ai | fallback | manual (CHECK 없이 앱이 검증 — quotes.stage 와 같은 방침)
  source      TEXT        NOT NULL DEFAULT 'ai',
  rev         INTEGER     NOT NULL DEFAULT 0,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS 를 켜고 정책은 만들지 않는다 → service role(서버의 supabaseAdmin)만 읽고 쓴다.
-- 제안서에는 확인 전 단가·내부 메모가 섞여 있어 공개 키로 읽히면 안 된다.
ALTER TABLE proposal_docs ENABLE ROW LEVEL SECURITY;

-- updated_at 은 앱이 넣지 않아도 저장할 때마다 갱신되게 한다 (자동 저장이 잦아 빠뜨리기 쉽다)
CREATE OR REPLACE FUNCTION set_proposal_docs_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS proposal_docs_set_updated_at ON proposal_docs;
CREATE TRIGGER proposal_docs_set_updated_at
  BEFORE UPDATE ON proposal_docs
  FOR EACH ROW EXECUTE FUNCTION set_proposal_docs_updated_at();

-- PostgREST 스키마 캐시 즉시 리로드 — 없으면 표를 만들어도 한동안 PGRST205 로 "없음"이 뜬다
NOTIFY pgrst, 'reload schema';
