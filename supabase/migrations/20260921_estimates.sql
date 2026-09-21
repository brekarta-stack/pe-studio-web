-- ============================================================
-- 견적서 자동 생성 (2026-09-21)
--
-- 1) estimates              견적서 한 건 = 한 줄. 생성 → 확인 → 발송 상태를 가진다
-- 2) estimate_events        견적서에 일어난 일 (append-only 감사 기록)
-- 3) google_drive_connection 견적서 시트를 만들 구글 계정 연결 (한 줄)
--
-- 모든 구문이 IF NOT EXISTS / 조건부라 여러 번 실행해도 안전하다.
-- Supabase 대시보드 > SQL Editor 에서 실행하거나, 어드민 > DB 셋업의
-- "마이그레이션 실행" 버튼으로 적용한다.
-- ============================================================

-- ── 1. estimates ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT NOT NULL,            -- papertoy | woodrock
  doc_number      TEXT NOT NULL,            -- TO260921, TO260921-2 …
  client_company  TEXT NOT NULL,
  client_contact  TEXT NOT NULL DEFAULT '',
  client_email    TEXT NOT NULL DEFAULT '',
  issued_on       DATE NOT NULL,            -- 견적 일자 (한국 날짜)
  delivery_term   TEXT NOT NULL DEFAULT '지정 기일',
  delivery_place  TEXT NOT NULL DEFAULT '귀사 지정장소',
  payment_term    TEXT NOT NULL DEFAULT '현 금',
  items           JSONB NOT NULL DEFAULT '[]'::jsonb,
  supply_amount   BIGINT NOT NULL DEFAULT 0,   -- 공급가액 (부가세 별도)
  vat_amount      BIGINT NOT NULL DEFAULT 0,
  total_amount    BIGINT NOT NULL DEFAULT 0,   -- 부가세 포함
  status          TEXT NOT NULL DEFAULT 'draft',
  -- status: draft(시트 미반영) | generated(확인 대기) | confirmed(발송 대기)
  --         | sending(발송 중 잠금) | sent(발송 완료)
  content_rev     INTEGER NOT NULL DEFAULT 0,  -- 내용 판번호 (저장마다 +1, 시트를 그린 판과 대조)
  send_attempt    INTEGER NOT NULL DEFAULT 0,  -- 메일 서버가 거절한 발송 시도 수 (멱등 키 접미사)
  quote_id        UUID REFERENCES quotes(id) ON DELETE SET NULL,  -- 연결된 제작 문의 (선택)
  sheet_id        TEXT,                     -- 구글 스프레드시트 파일 id
  sheet_gid       BIGINT,                   -- 앱이 그린 견적서 탭 id
  sheet_url       TEXT,
  sheet_modified_at TEXT,                   -- 확인 시점의 드라이브 modifiedTime (발송 전 변경 감지)
  confirmed_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  sent_to         TEXT,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 표가 이미 있는 환경(이 파일의 앞선 판을 적용한 경우)에도 칸이 생기게
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS content_rev  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS send_attempt INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS estimates_doc_number_unique ON estimates (doc_number);
CREATE INDEX IF NOT EXISTS estimates_status_idx     ON estimates (status);
CREATE INDEX IF NOT EXISTS estimates_created_at_idx ON estimates (created_at DESC);

-- 값 목록 제약 — 앱 검증(src/lib/estimate-types.ts)과 같은 목록. 값을 늘릴 때 여기도 갈아 끼운다
DO $$
BEGIN
  ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_category_check;
  ALTER TABLE estimates ADD CONSTRAINT estimates_category_check
    CHECK (category IN ('papertoy', 'woodrock'));
  ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_status_check;
  ALTER TABLE estimates ADD CONSTRAINT estimates_status_check
    CHECK (status IN ('draft', 'generated', 'confirmed', 'sending', 'sent'));
  ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_amounts_check;
  ALTER TABLE estimates ADD CONSTRAINT estimates_amounts_check
    CHECK (supply_amount >= 0 AND vat_amount >= 0 AND total_amount >= 0);
END $$;

-- ── 2. estimate_events (append-only) ────────────────────────
-- estimate_id 에 FK 를 걸지 않는다 — 견적서를 지워도 "누가 언제 지웠는지"는 남아야 한다.
CREATE TABLE IF NOT EXISTS estimate_events (
  id           BIGSERIAL PRIMARY KEY,
  estimate_id  UUID,
  doc_number   TEXT NOT NULL DEFAULT '',
  action       TEXT NOT NULL,     -- created | sheet_generated | updated | confirmed | unconfirmed | sent | send_failed | deleted | google_connected …
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estimate_events_estimate_idx ON estimate_events (estimate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS estimate_events_created_idx  ON estimate_events (created_at DESC);

-- append-only 를 DB 에서 강제한다 — service_role 은 RLS 를 넘지만 트리거는 넘지 못한다.
-- 기록을 고치거나 지우는 경로가 애플리케이션에 없어도, 키가 털렸을 때 흔적 지우기를 막는다.
CREATE OR REPLACE FUNCTION estimate_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'estimate_events 는 추가만 할 수 있습니다 (append-only)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS estimate_events_no_update ON estimate_events;
CREATE TRIGGER estimate_events_no_update
  BEFORE UPDATE OR DELETE ON estimate_events
  FOR EACH ROW EXECUTE FUNCTION estimate_events_append_only();

-- ── 3. google_drive_connection (한 줄) ──────────────────────
CREATE TABLE IF NOT EXISTS google_drive_connection (
  id             TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  email          TEXT NOT NULL DEFAULT '',
  refresh_token  TEXT NOT NULL,             -- AES-256-GCM 암호문 (src/lib/token-crypto.ts)
  scope          TEXT NOT NULL DEFAULT '',
  folder_ids     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { root, papertoy, woodrock }
  last_error     TEXT,
  connected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RLS: anon/authenticated 전면 차단. 모든 접근은 service_role 경유 ──
ALTER TABLE estimates               ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_drive_connection ENABLE ROW LEVEL SECURITY;

-- PostgREST 스키마 캐시 갱신 — 새 표가 API 에 바로 보이게
NOTIFY pgrst, 'reload schema';
