-- ============================================================
-- 아티스트 포털 (2026-08-02)
--
-- 아티스트가 papercraft.kr 에 직접 로그인해서
--   · 자기에게 제안된 업무를 수락/거절하고
--   · 진행률·상태를 갱신하고 결과물을 올리고
--   · 자기 작업비 정산 내역을 확인
-- 할 수 있게 하기 위한 스키마.
--
-- 1) artist_accounts — 로그인 계정 ↔ artists 매칭의 단일 출처.
--    구글 이메일 하나가 아티스트 한 명에 붙는다. 관리자가 승인해야 로그인된다.
--    (인증 자체는 next-auth Google 이 하고, 이 표는 "누구를 통과시킬지"만 정한다)
--
-- 2) assignments 에 제안(offer) 상태 + 결과물(deliverables) 추가.
--    기존 배정은 이미 합의된 건이므로 전부 accepted 로 이행한다 —
--    안 그러면 진행 중인 업무가 갑자기 "응답 대기"로 보인다.
--
-- 멱등 (여러 번 실행해도 안전).
-- ============================================================

-- ── 1. artist_accounts ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS artist_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 구글 로그인 이메일(항상 소문자로 저장). 초대만 발급하고 아직 안 받았으면 NULL.
  email             TEXT UNIQUE,
  -- artists.id. 자체 가입 신청은 관리자가 매칭하기 전까지 NULL.
  artist_id         TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  -- status: invited(초대 발급·미수락) | pending(가입 신청·승인 대기)
  --         | approved(승인 — 로그인 가능) | rejected(거절) | disabled(사용 중지)
  display_name      TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  -- 신청자가 남긴 소개 / 관리자 메모
  note              TEXT NOT NULL DEFAULT '',
  -- 초대 링크 토큰 (/artist/join?token=...). 수락하면 NULL 로 소진한다.
  invite_token      TEXT UNIQUE,
  invite_expires_at TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artist_accounts_status_idx ON artist_accounts (status);

-- 아티스트 한 명에 계정 하나 — 두 계정이 같은 아티스트를 주장하지 못하게 막는다.
-- (artist_id 가 NULL 인 미매칭 신청은 여럿 있어도 된다 → 부분 유니크)
CREATE UNIQUE INDEX IF NOT EXISTS artist_accounts_artist_unique
  ON artist_accounts (artist_id) WHERE artist_id IS NOT NULL;

-- artists 테이블이 있을 때만 FK 를 건다 (20260728 마이그레이션과 같은 방침).
-- ON DELETE SET NULL — 아티스트 프로필을 지워도 계정 이력은 남기고 매칭만 푼다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'artists')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE constraint_schema = 'public'
                       AND constraint_name = 'artist_accounts_artist_id_fkey')
  THEN
    ALTER TABLE artist_accounts
      ADD CONSTRAINT artist_accounts_artist_id_fkey
      FOREIGN KEY (artist_id) REFERENCES artists (id) ON DELETE SET NULL;
  END IF;
END $$;

-- RLS: 서비스 롤(supabaseAdmin)로만 접근 → 켜두고 정책 없음 = 외부 전면 차단.
-- 아티스트 본인 확인은 서버(next-auth 세션 → artist_id)에서 한다.
ALTER TABLE artist_accounts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION set_artist_accounts_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artist_accounts_set_updated_at ON artist_accounts;
CREATE TRIGGER artist_accounts_set_updated_at
  BEFORE UPDATE ON artist_accounts
  FOR EACH ROW EXECUTE FUNCTION set_artist_accounts_updated_at();

-- ── 2. assignments: 제안(offer) 상태 ────────────────────────
--
-- 컬럼을 처음 추가할 때만 기본값을 'accepted' 로 둬서 **기존 배정 전체가**
-- 수락 완료 상태로 채워지게 하고, 곧바로 기본값을 'draft' 로 바꿔
-- 앞으로 만들어지는 배정은 "아직 제안 안 함"에서 시작하게 한다.
-- 블록 전체가 컬럼 존재 여부로 가드되므로 재실행해도 값이 덮이지 않는다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'assignments'
                   AND column_name = 'offer_status')
  THEN
    ALTER TABLE assignments ADD COLUMN offer_status TEXT NOT NULL DEFAULT 'accepted';
    ALTER TABLE assignments ALTER COLUMN offer_status SET DEFAULT 'draft';

    ALTER TABLE assignments ADD COLUMN offered_at   TIMESTAMPTZ;
    ALTER TABLE assignments ADD COLUMN responded_at TIMESTAMPTZ;

    -- 이행된 기존 건은 배정 시점에 제안·수락이 함께 일어난 것으로 본다
    UPDATE assignments
       SET offered_at = created_at, responded_at = created_at;
  END IF;
END $$;

-- offer_status: draft(작성중·미제안) | offered(제안됨·응답 대기)
--               | accepted(수락) | declined(거절)
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS decline_reason TEXT  NOT NULL DEFAULT '';
-- 아티스트가 올린 결과물 — [{ "name": 표시명, "url": 공개URL, "uploadedAt": ISO }]
-- quotes.files 와 같은 JSONB 배열 방식 (첨부는 개수가 적고 항상 통째로 읽는다)
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS deliverables   JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS assignments_offer_status_idx ON assignments (offer_status);

DO $$
BEGIN
  RAISE NOTICE 'artist_accounts 생성 + assignments 제안/결과물 컬럼 준비 완료';
END $$;

-- PostgREST(supabase-js 가 쓰는 REST 레이어) 스키마 캐시 즉시 리로드.
-- 이게 없으면 테이블/컬럼을 만들어도 REST 가 한동안 못 알아채(PGRST205)
-- "마이그레이션을 실행해도 그대로"인 것처럼 보인다.
NOTIFY pgrst, 'reload schema';
