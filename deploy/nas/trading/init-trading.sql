-- 매매 도메인 테이블 (D7 스켈레톤 v3 — 2차 적대 리뷰 반영)
-- ⚠️ 스켈레톤 단계 한정: DROP 후 재생성. engine.apply_schema가 non-mock 주문이 있으면 거부한다.
--    KIS 전환 첫 작업 = 이 파일을 추가형 마이그레이션으로 바꾸고 DROP/DELETE 제거.
-- v2 반영: NaN/Infinity CHECK · client_key · state CHECK · analyst 롤
-- v3 반영: symbol 형식 CHECK(인젝션이 임의 종목 고르는 것 차단) · picked_at(스윕 오탐 제거) ·
--          needs_reconcile 플래그(자유텍스트 LIKE 판정 탈피) · expired 상태(제안 TTL) · 컬럼단위 GRANT

DROP TABLE IF EXISTS trade_orders CASCADE;
DROP TABLE IF EXISTS trade_proposals CASCADE;
DROP TABLE IF EXISTS trade_daily_pnl CASCADE;
-- 테이블 리셋 시 공유 멱등키의 trade 항목도 함께 리셋(안 하면 재시작된 proposal id가 과거 키와 충돌).
DELETE FROM idempotency_keys WHERE kind = 'trade';

CREATE TABLE trade_proposals (
  id          BIGSERIAL PRIMARY KEY,
  client_key  TEXT UNIQUE,                -- 제안자가 채우는 결정적 키. ★ LLM 출력에 의존시키지 말 것
                                          --   (의존하면 종목만 바뀌어도 dedup 우회 — 2차 리뷰 지적)
  source      TEXT NOT NULL,
  market      TEXT NOT NULL CHECK (market IN ('KR','US')),
  -- KR 6자리 숫자 코드만. 인젝션이 임의 문자열을 종목으로 넣는 것을 DB에서 차단.
  -- US 확장 시 market별 CHECK로 분기할 것.
  symbol      TEXT NOT NULL CHECK (symbol ~ '^[0-9]{6}$'),
  side        TEXT NOT NULL CHECK (side IN ('buy','sell')),
  qty         NUMERIC NOT NULL CHECK (qty > 0 AND qty <> 'NaN'::numeric AND qty < 'Infinity'::numeric),
  limit_price NUMERIC NOT NULL CHECK (limit_price > 0 AND limit_price <> 'NaN'::numeric AND limit_price < 'Infinity'::numeric),
  rationale   TEXT CHECK (rationale IS NULL OR length(rationale) <= 500),   -- 2차 인젝션 표면 축소
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','picked','rejected','done','expired')),
  picked_at   TIMESTAMPTZ,                -- 집힌 시각(스윕이 created_at으로 오탐하던 것 수정)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trade_proposals_status ON trade_proposals(status, created_at);

CREATE TABLE trade_orders (
  id            BIGSERIAL PRIMARY KEY,
  proposal_id   BIGINT REFERENCES trade_proposals(id),
  idem_key      TEXT NOT NULL UNIQUE,
  state         TEXT NOT NULL CHECK (state IN ('VALIDATED','SUBMITTED','FILLED','REJECTED','CANCELLED','FAILED')),
  broker        TEXT NOT NULL,
  broker_order_id TEXT,
  filled_qty    NUMERIC NOT NULL DEFAULT 0 CHECK (filled_qty <> 'NaN'::numeric),
  avg_price     NUMERIC,
  reject_reason TEXT,
  -- "브로커에 나갔는지 불명" 주문 표시. 엔진 HALT 판정의 단일 기준(자유텍스트 LIKE 아님).
  needs_reconcile BOOLEAN NOT NULL DEFAULT false,
  reconciled_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trade_orders_reconcile ON trade_orders(needs_reconcile) WHERE reconciled_at IS NULL;
-- 당일 체결 명목가 합산용(총량 상한 가드레일)
CREATE INDEX idx_trade_orders_filled_day ON trade_orders(state, created_at);

-- 일손실한도 데이터원. ⚠️ 스켈레톤에서 realized_krw는 항상 0이다(원가/포지션 미구현) →
--    이 한도는 **아직 발화하지 않는다**. 실질 브레이크는 guardrails의 당일 명목가 총량 상한.
CREATE TABLE trade_daily_pnl (
  trade_date  DATE PRIMARY KEY,
  realized_krw NUMERIC NOT NULL DEFAULT 0 CHECK (realized_krw <> 'NaN'::numeric),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LLM 분석가 경로용 최소권한 롤. 컬럼 단위 GRANT — status/picked_at을 분석가가 못 정한다.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trade_analyst') THEN
    CREATE ROLE trade_analyst NOLOGIN;
  END IF;
END $$;
GRANT SELECT ON trade_proposals TO trade_analyst;
GRANT INSERT (client_key, source, market, symbol, side, qty, limit_price, rationale)
  ON trade_proposals TO trade_analyst;
GRANT USAGE ON SEQUENCE trade_proposals_id_seq TO trade_analyst;
-- (trade_orders/idempotency_keys/trade_daily_pnl에는 권한 없음 — 계약 1의 DB 레벨 강제)
