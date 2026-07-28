-- ============================================================
-- PE Studio — Supabase 전체 스키마
-- Supabase 대시보드 > SQL Editor 에서 한 번 실행하세요.
-- ============================================================

-- 1. 포트폴리오 (제작 사례)
CREATE TABLE IF NOT EXISTS portfolio_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id  TEXT,
  slug         TEXT,                                   -- URL 슬러그 (UNIQUE 인덱스는 아래)
  title        TEXT NOT NULL DEFAULT '',
  summary      TEXT,                                   -- SEO 요약 (og:description)
  category     TEXT NOT NULL DEFAULT '기타',
  description  TEXT NOT NULL DEFAULT '',
  client       TEXT NOT NULL DEFAULT '',
  client_type  TEXT,                                   -- 박물관/지자체/기업 등 분야
  tags         JSONB NOT NULL DEFAULT '[]',            -- 자유 태그
  keywords     JSONB NOT NULL DEFAULT '[]',            -- 추가 SEO 키워드
  images       JSONB NOT NULL DEFAULT '[]',
  image_alts   JSONB NOT NULL DEFAULT '[]',            -- 이미지별 alt
  published    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_items_slug_unique
  ON portfolio_items (slug)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS portfolio_items_tags_gin
  ON portfolio_items USING GIN (tags);

-- 2. 블로그 포스트
CREATE TABLE IF NOT EXISTS posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL DEFAULT '',
  excerpt      TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',
  tag          TEXT NOT NULL DEFAULT '',
  emoji        TEXT NOT NULL DEFAULT '',
  cover_image  TEXT,
  published    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 견적 문의
CREATE TABLE IF NOT EXISTS quotes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product       TEXT,
  quantity      TEXT,
  delivery_date TEXT,
  purpose       TEXT,
  custom_design TEXT,
  color_request TEXT,
  notes         TEXT,
  name          TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  file_name     TEXT,
  file_url      TEXT,                                   -- 참고자료 공개 URL (마이그레이션 20260710)
  logo_file_name TEXT,                                  -- 회사 로고 (마이그레이션 20260604)
  logo_file_url  TEXT,                                  -- 회사 로고 공개 URL (마이그레이션 20260710)
  style_type    TEXT,                                   -- 디자인 스타일 (마이그레이션 20260604)
  product_text  TEXT,                                   -- 제품 삽입 문구 (마이그레이션 20260604)
  sampling      BOOLEAN NOT NULL DEFAULT FALSE,         -- 샘플링 희망 (마이그레이션 20260605)
  rushed        BOOLEAN NOT NULL DEFAULT FALSE,         -- 최대한 빠르게 (마이그레이션 20260605)
  packaging     TEXT,                                   -- 포장 방식 (마이그레이션 20260605)
  acquisition   JSONB,                                  -- 광고 유입정보 {gclid,utm…} (마이그레이션 20260609)
  in_progress   BOOLEAN NOT NULL DEFAULT FALSE,         -- 진행 여부 체크 (마이그레이션 20260728)
  stage         TEXT NOT NULL DEFAULT 'new',            -- 진행 단계 (마이그레이션 20260728)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quotes_stage_idx       ON quotes (stage);
CREATE INDEX IF NOT EXISTS quotes_in_progress_idx ON quotes (in_progress);

-- 4. 유입·클릭 분석 이벤트
--    (외부 GA 없이 자체 수집 → /admin/analytics. IP·UA·쿠키 미사용)
CREATE TABLE IF NOT EXISTS analytics_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type          TEXT NOT NULL,                       -- 'pageview' | 'click'
  path          TEXT NOT NULL DEFAULT '',
  referrer      TEXT,
  source        TEXT,                                -- google/naver/instagram/direct…
  medium        TEXT,                                -- organic | social | referral | direct
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  label         TEXT,                                -- 클릭된 요소 라벨
  href          TEXT,                                -- 링크 목적지
  duration_ms   BIGINT,                              -- 페이지 체류 시간(ms) — type='dwell'
  session_id    TEXT,                                -- 익명 세션 식별자 (PII 아님)
  device        TEXT,                                -- 'mobile' | 'desktop'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS analytics_events_created_idx
  ON analytics_events (created_at DESC);

CREATE INDEX IF NOT EXISTS analytics_events_type_created_idx
  ON analytics_events (type, created_at DESC);

-- ============================================================
-- RLS (Row Level Security) 활성화
-- 서버는 service_role 키 사용 → RLS 자동 우회
-- 외부에서 anon 키로 직접 접근 시 아래 정책만 허용
-- ============================================================

ALTER TABLE portfolio_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- portfolio_items: 공개된 항목만 anon 읽기 허용 (쓰기는 service_role만)
DROP POLICY IF EXISTS "Public read published portfolio" ON portfolio_items;
CREATE POLICY "Public read published portfolio"
  ON portfolio_items FOR SELECT TO anon
  USING (published = true);

-- posts: 공개된 포스트만 anon 읽기 허용 (쓰기는 service_role만)
DROP POLICY IF EXISTS "Public read published posts" ON posts;
CREATE POLICY "Public read published posts"
  ON posts FOR SELECT TO anon
  USING (published = true);

-- quotes: anon 접근 전면 차단 (삽입 포함) — 모든 접근은 service_role을 통해서만
-- (견적 폼 → /api/quote → supabaseAdmin 경유)

-- analytics_events: anon 접근 전면 차단 — 수집/조회 모두 service_role 경유
-- (수집 → /api/track, 조회 → /admin/analytics)

-- ============================================================
-- studio_reviews — 종이모형 도면 검수 상태 (2026-07-07)
-- /admin/studio-review 에서 관리자가 하루 한 개씩 검수. 행이 없으면 미검수.
-- ============================================================
CREATE TABLE IF NOT EXISTS studio_reviews (
  skey        TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected')),
  note        TEXT,
  reviewer    TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_reviews_status_idx      ON studio_reviews (status);
CREATE INDEX IF NOT EXISTS studio_reviews_reviewed_at_idx ON studio_reviews (reviewed_at DESC);

ALTER TABLE studio_reviews ENABLE ROW LEVEL SECURITY;
-- studio_reviews: anon 접근 전면 차단 — 모든 접근은 service_role(어드민) 경유

-- ============================================================
-- assignments — 리드(quote) ↔ 아티스트 업무 배정 (2026-07-28)
-- /admin/works 에서 진행률·작업비·납기·지급상태를 관리한다.
-- 한 리드에 아티스트가 둘 이상 붙을 수 있어 별도 테이블로 둔다.
-- 상세 주석: supabase/migrations/20260728_quote_pipeline.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  artist_id     TEXT NOT NULL,   -- artists.id (FK 는 아래 DO 블록에서 조건부)
  status        TEXT    NOT NULL DEFAULT 'assigned',  -- assigned|working|review|done|cancelled
  progress      INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  artist_fee    BIGINT,          -- 아티스트 작업비 (원, 원가)
  client_amount BIGINT,          -- 고객 청구금액 (원, 매출)
  payout_status TEXT NOT NULL DEFAULT 'unpaid',       -- unpaid|partial|paid
  paid_at       TIMESTAMPTZ,
  due_date      DATE,
  started_at    DATE,
  memo          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignments_quote_idx  ON assignments (quote_id);
CREATE INDEX IF NOT EXISTS assignments_artist_idx ON assignments (artist_id);
CREATE INDEX IF NOT EXISTS assignments_due_idx    ON assignments (due_date);
CREATE UNIQUE INDEX IF NOT EXISTS assignments_quote_artist_unique
  ON assignments (quote_id, artist_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'artists')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE constraint_schema = 'public'
                       AND constraint_name = 'assignments_artist_id_fkey')
  THEN
    ALTER TABLE assignments
      ADD CONSTRAINT assignments_artist_id_fkey
      FOREIGN KEY (artist_id) REFERENCES artists (id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
-- assignments: anon 접근 전면 차단 — 모든 접근은 service_role(어드민) 경유

CREATE OR REPLACE FUNCTION set_assignments_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assignments_set_updated_at ON assignments;
CREATE TRIGGER assignments_set_updated_at
  BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION set_assignments_updated_at();
