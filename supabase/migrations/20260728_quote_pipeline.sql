-- ============================================================
-- 제작 문의 파이프라인 + 아티스트 업무 배정 (2026-07-28)
--
-- 1) quotes 에 진행 여부 체크박스(in_progress)와 단계(stage) 추가
-- 2) assignments 신설 — 리드(quote) ↔ 아티스트(artist) 업무 배정의 단일 출처.
--    작업비/청구금액/진행률/납기/지급상태를 배정 단위로 관리한다.
--    한 리드에 아티스트가 둘 이상 붙을 수 있어 quotes 컬럼이 아닌 별도 테이블로 둔다.
--
-- 모든 구문이 IF NOT EXISTS / 조건부라 여러 번 실행해도 안전하다.
-- Supabase 대시보드 > SQL Editor 에서 실행하거나, 어드민 > DB 셋업의
-- "마이그레이션 실행" 버튼으로 적용한다.
-- ============================================================

-- ── 1. quotes: 진행 여부 + 단계 ──────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS in_progress BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS stage       TEXT    NOT NULL DEFAULT 'new';
-- stage: new(접수) | consulting(상담중) | quoted(견적발송) | contracted(계약확정)
--        | producing(제작중) | delivered(납품완료) | settled(정산완료) | on_hold(보류·취소)

CREATE INDEX IF NOT EXISTS quotes_stage_idx       ON quotes (stage);
CREATE INDEX IF NOT EXISTS quotes_in_progress_idx ON quotes (in_progress);

-- ── 2. assignments: 리드 ↔ 아티스트 배정 ─────────────────────
CREATE TABLE IF NOT EXISTS assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  -- artists.id 를 가리키지만 FK 는 아래 DO 블록에서 조건부로 건다
  -- (artists 테이블이 아직 없는 환경에서도 이 마이그레이션이 통째로 실패하지 않도록)
  artist_id     TEXT NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'assigned',
  -- status: assigned(배정) | working(작업중) | review(검수) | done(완료) | cancelled(취소)
  progress      INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  artist_fee    BIGINT,          -- 아티스트에게 지급할 작업비 (원, 원가)
  client_amount BIGINT,          -- 고객에게 청구한 금액 (원, 매출)
  payout_status TEXT NOT NULL DEFAULT 'unpaid',
  -- payout_status: unpaid(미지급) | partial(부분지급) | paid(지급완료)
  paid_at       TIMESTAMPTZ,
  due_date      DATE,            -- 납품 기한
  started_at    DATE,            -- 작업 착수일
  memo          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignments_quote_idx  ON assignments (quote_id);
CREATE INDEX IF NOT EXISTS assignments_artist_idx ON assignments (artist_id);
CREATE INDEX IF NOT EXISTS assignments_due_idx    ON assignments (due_date);

-- 같은 리드에 같은 아티스트를 중복 배정하지 않는다 (upsert 대상 키)
CREATE UNIQUE INDEX IF NOT EXISTS assignments_quote_artist_unique
  ON assignments (quote_id, artist_id);

-- artists 테이블이 있을 때만 FK 를 건다. 이미 걸려 있으면 건너뛴다.
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

-- RLS: 서비스 롤(supabaseAdmin)로만 접근 → 켜두고 정책 없음 = 외부 전면 차단
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

-- updated_at 자동 갱신
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

DO $$
BEGIN
  RAISE NOTICE 'quotes.in_progress/stage 추가 + assignments 테이블 준비 완료';
END $$;
