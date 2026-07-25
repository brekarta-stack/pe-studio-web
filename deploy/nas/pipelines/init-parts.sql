-- 파트 정의 테이블 (D5 공용 골격) — "표 하나 읽고 다 돈다"의 런타임 실체
-- SSOT는 레포의 deploy/pipelines/part-definitions.yaml(사람이 편집, 주석 포함).
-- load-parts.py가 그 YAML을 읽어 이 테이블로 동기화한다. n8n 워크플로는 이 테이블만 읽는다.
-- 전부 IF NOT EXISTS / 추가형 — 재적용 안전(실데이터 파괴 없음).

CREATE TABLE IF NOT EXISTS part_definitions (
  part_key    TEXT PRIMARY KEY,               -- biz-a | biz-b | biz-c ...
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT false, -- false면 모든 공용 워크플로가 건너뛴다
  config      JSONB NOT NULL,                 -- lead_gen/blog/quote/sns 하위 설정 통째로
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 리드 중복 방지(같은 소스의 같은 대상이 매일 다시 들어오는 것 차단).
-- leads는 init-db.sql이 만든다 — 여기선 dedup 키만 추가(추가형).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS dedup_key TEXT;
-- 부분 인덱스(WHERE dedup_key IS NOT NULL)를 쓰면 ON CONFLICT (dedup_key) 추론이 실패한다.
-- Postgres UNIQUE 인덱스는 NULL을 서로 중복으로 보지 않으므로 조건 없이도 의도가 같다.
DROP INDEX IF EXISTS idx_leads_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedup ON leads(dedup_key);

-- n8n(파이프라인)이 파트 정의를 읽을 수 있게. 쓰기는 load-parts.py(관리자 경로)만.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pipeline_runner') THEN
    CREATE ROLE pipeline_runner NOLOGIN;
  END IF;
END $$;
GRANT SELECT ON part_definitions TO pipeline_runner;
GRANT SELECT, INSERT, UPDATE ON leads TO pipeline_runner;
GRANT USAGE ON SEQUENCE leads_id_seq TO pipeline_runner;
-- (매매 테이블에는 권한 없음 — 사업 파이프라인과 매매는 서로 못 건드린다)
