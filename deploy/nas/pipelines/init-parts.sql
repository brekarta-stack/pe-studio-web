-- 파트 정의 테이블 (D5 공용 골격) — "표 하나 읽고 다 돈다"의 런타임 실체
-- SSOT는 레포의 deploy/pipelines/part-definitions.yaml(사람이 편집, 주석 포함).
-- load-parts.py가 그 YAML을 읽어 이 테이블로 동기화한다. n8n 워크플로는 이 테이블만 읽는다.
-- 전부 IF NOT EXISTS / 추가형 — 재적용 안전(실데이터 파괴 없음).
-- 전체를 트랜잭션으로 감싼다: DROP INDEX 후 CREATE가 실패하면 dedup이 무력화된 채 남기 때문.

BEGIN;

CREATE TABLE IF NOT EXISTS part_definitions (
  part_key    TEXT PRIMARY KEY,               -- biz-a | biz-b | biz-c ...
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT false, -- false면 모든 공용 워크플로가 건너뛴다
  config      JSONB NOT NULL,                 -- lead_gen/blog/quote/sns 하위 설정 통째로
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 리드 중복 방지. leads는 init-db.sql이 만든다 — 여기선 dedup 키만 추가(추가형).
-- 부분 인덱스(WHERE dedup_key IS NOT NULL)를 쓰면 ON CONFLICT (dedup_key) 추론이 실패한다.
-- Postgres UNIQUE 인덱스는 NULL을 서로 중복으로 보지 않으므로 조건 없이도 의도가 같다.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS dedup_key TEXT;
DROP INDEX IF EXISTS idx_leads_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedup ON leads(dedup_key);

-- n8n(파이프라인)이 파트 정의를 읽을 수 있게. 쓰기는 sync-parts.sh(관리자 경로)만.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pipeline_runner') THEN
    CREATE ROLE pipeline_runner NOLOGIN;
  END IF;
END $$;
GRANT SELECT ON part_definitions TO pipeline_runner;
GRANT SELECT, INSERT, UPDATE ON leads TO pipeline_runner;
GRANT USAGE ON SEQUENCE leads_id_seq TO pipeline_runner;
-- (매매 테이블에는 권한 없음 — 사업 파이프라인과 매매는 서로 못 건드린다)

-- 발행·이메일 멱등성(GD-2)은 매매와 **같은 키 테이블**을 쓴다는 것이 확정 결정이다.
-- 그래서 파이프라인에 이 테이블 권한을 주되, RLS로 가둔다.
--
-- ★ kind만 검사하면 안 된다: kind='publish'인 채 key='trade:ck:analyst:날짜:morning'을 심으면
--   매매 엔진의 check-then-act가 그 키를 '이미 처리됨'으로 보고 **주문 없이 제안을 종결**한다
--   (무단 주문은 못 내지만 매매를 조용히 멈출 수 있다 — client_key 형식이 공개돼 추측 가능).
--   따라서 key 접두사가 kind와 일치하도록 강제한다. 현재 생산자 3종 모두 이 규칙을 이미 만족한다
--   (엔진 'trade:…', 블로그 'publish:…', 견적 'email:…').
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pipeline_kinds_only ON idempotency_keys;
CREATE POLICY pipeline_kinds_only ON idempotency_keys FOR ALL TO pipeline_runner
  USING      (kind IN ('publish','email') AND key LIKE kind || ':%')
  WITH CHECK (kind IN ('publish','email') AND key LIKE kind || ':%');
GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO pipeline_runner;

COMMIT;
