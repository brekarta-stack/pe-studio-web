-- ============================================================
-- 제안서 AI 작성 작업 큐 — proposal_docs 에 작업 상태 컬럼 추가 (2026-10-16)
-- 설계 정본: docs/proposal-editor-plan.md §8
--
-- AI 원고는 맥 스튜디오(Claude Code)가 쓴다. 백오피스는 요청만 남기고(gen_status=requested),
-- 맥이 1분마다 GET /api/admin/proposals/jobs/next 로 하나를 running 으로 잡아 간 뒤
-- POST /api/admin/proposals/{id}/worker-result 로 결과를 돌려준다.
-- 결과는 gen_result 에 보관했다가 문서가 요청 이후 안 바뀌었으면 바로, 아니면 편집기에서 적용한다.
--
-- gen_status: idle | requested | running | done | failed (CHECK 없이 앱이 검증 — source 와 같은 방침)
--
-- 모든 구문이 IF NOT EXISTS 라 여러 번 실행해도 안전하다.
-- ============================================================

ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS gen_status        TEXT        NOT NULL DEFAULT 'idle';
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS gen_mode          TEXT;
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS gen_requested_at  TIMESTAMPTZ;
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS gen_started_at    TIMESTAMPTZ;
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS gen_finished_at   TIMESTAMPTZ;
-- 요청할 때의 rev — 결과가 왔을 때 rev 가 그대로면 아무도 안 고친 것이라 자동 적용한다
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS gen_requested_rev INTEGER;
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS gen_attempts      INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS gen_error         TEXT;
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS gen_result        JSONB;
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS gen_result_at     TIMESTAMPTZ;

-- 맥이 "가장 오래된 requested" 를 고르고, 20분 넘은 running 을 찾는다
CREATE INDEX IF NOT EXISTS proposal_docs_gen_status_idx ON proposal_docs (gen_status, gen_requested_at);

-- PostgREST 스키마 캐시 즉시 리로드 — 없으면 컬럼을 만들어도 한동안 PGRST204 로 "없음"이 뜬다
NOTIFY pgrst, 'reload schema';
