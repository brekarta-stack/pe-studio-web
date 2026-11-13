-- ============================================================
-- 작업 공고 (선착순 배정) + 이메일 로그인 링크 (2026-11-13)
--
-- 설계: docs/job-board-plan.md
--
-- 1) job_postings — 문의(quotes) 하나에 공고 하나. 운영자가 작업비·마감일을 적어 올리면
--    작업자가 포털에서 선착순으로 가져간다. 가져가는 순간 assignments 에 수락 완료 배정이 생긴다.
-- 2) artist_login_tokens — 구글 계정이 없는 작업자(네이버 메일)를 위한 1회용 로그인 링크.
-- 3) 김철호·박형미 포털 계정을 승인 상태로 넣는다(이미 계정이 있으면 건드리지 않는다).
--
-- 멱등 (여러 번 실행해도 안전).
-- ============================================================

-- ── 1. job_postings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_postings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id          UUID NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
  -- status: draft(작성·내림) | open(공고 중) | claimed(가져감)
  status            TEXT NOT NULL DEFAULT 'draft',
  -- 견적가(고객 청구, 공급가액) — 작업자에게 보이지 않는다
  client_amount     BIGINT,
  -- 작업자에게 보이는 작업비(세전)·마감일·전달 메모
  artist_fee        BIGINT,
  due_date          DATE,
  memo              TEXT NOT NULL DEFAULT '',
  opened_at         TIMESTAMPTZ,
  claimed_by        TEXT,
  claimed_at        TIMESTAMPTZ,
  assignment_id     UUID REFERENCES assignments(id) ON DELETE SET NULL,
  calendar_event_id TEXT,
  calendar_error    TEXT,
  -- 마감 알림 발송(또는 건너뜀) 시각 — NULL 이면 아직
  alert_50_at       TIMESTAMPTZ,
  alert_25_at       TIMESTAMPTZ,
  alert_10_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_schema = 'public'
                   AND constraint_name = 'job_postings_status_check') THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_status_check CHECK (status IN ('draft', 'open', 'claimed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_schema = 'public'
                   AND constraint_name = 'job_postings_amounts_check') THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_amounts_check
      CHECK ((client_amount IS NULL OR client_amount >= 0) AND (artist_fee IS NULL OR artist_fee >= 0));
  END IF;
  -- 공고 중·가져감 상태면 작업비와 마감일이 반드시 있어야 한다 (앱 검증의 뒷받침)
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_schema = 'public'
                   AND constraint_name = 'job_postings_open_fields_check') THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_open_fields_check
      CHECK (status = 'draft' OR (artist_fee IS NOT NULL AND due_date IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS job_postings_status_idx ON job_postings (status);

ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION set_job_postings_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS job_postings_set_updated_at ON job_postings;
CREATE TRIGGER job_postings_set_updated_at
  BEFORE UPDATE ON job_postings
  FOR EACH ROW EXECUTE FUNCTION set_job_postings_updated_at();

-- ── 2. artist_login_tokens ──────────────────────────────────
-- 토큰 원문은 메일에만 있다. 여기엔 SHA-256 해시(hex)만 둔다.
CREATE TABLE IF NOT EXISTS artist_login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artist_login_tokens_email_idx ON artist_login_tokens (email, created_at);

ALTER TABLE artist_login_tokens ENABLE ROW LEVEL SECURITY;

-- ── 3. 작업자 포털 계정 ─────────────────────────────────────
-- email UNIQUE 와 artist_id 부분 유니크 중 어느 쪽에 걸려도 조용히 넘어간다 —
-- 이미 계정이 있는 사람은 운영자가 /admin/accounts 에서 정리한 값을 존중한다.
INSERT INTO artist_accounts (email, artist_id, status, display_name, note, approved_at)
SELECT v.email, v.artist_id, 'approved', v.display_name, '작업 공고 도입 시 등록 (2026-11-13)', now()
  FROM (VALUES
    ('finalpaper@naver.com', 'artist-01', '김철호'),
    ('dinonabi@naver.com',   'artist-03', '박형미')
  ) AS v(email, artist_id, display_name)
 WHERE EXISTS (SELECT 1 FROM artists a WHERE a.id = v.artist_id)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'job_postings · artist_login_tokens 준비 완료';
END $$;
