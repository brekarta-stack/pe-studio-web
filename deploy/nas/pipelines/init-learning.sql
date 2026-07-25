-- 학습 파이프라인 스키마 (수집→요약→임베딩→아카이브→간격반복 퀴즈)
-- 미니 learning.json의 검증된 설정(간격 1·3·7·16·35·90일, 하루 최대 7문항)을 이식한다.
-- archive/expressions 테이블은 init-db.sql이 이미 만들었다 — 여기선 학습 항목·복습 큐만 추가.
-- 전부 추가형(IF NOT EXISTS) — 재적용 안전.

BEGIN;

-- 학습 항목(사람이 넣거나 아카이브에서 파생). 미니 learning.json items[]의 대응물.
CREATE TABLE IF NOT EXISTS learning_items (
  id          BIGSERIAL PRIMARY KEY,
  item_key    TEXT UNIQUE NOT NULL,           -- 결정적 키(재수집·재실행 시 중복 방지)
  topic       TEXT NOT NULL,
  note        TEXT,                           -- 회상 프롬프트(질문 형태로 쓰는 것이 효과적)
  source      TEXT,                           -- URL 또는 archive 참조
  archive_id  BIGINT REFERENCES archive(id),  -- 아카이브에서 파생된 경우
  block       TEXT NOT NULL DEFAULT 'general',-- industry | invest | culture | lang ... (요일 블록)
  rep         INTEGER NOT NULL DEFAULT 0,     -- 반복 횟수(간격 배열 인덱스)
  next_due    DATE NOT NULL DEFAULT CURRENT_DATE,
  retired     BOOLEAN NOT NULL DEFAULT false, -- 다 익힘(간격 소진) — 삭제하지 않는다
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learning_due ON learning_items(next_due) WHERE NOT retired;

-- 발송·응답 이력(효과 측정용 — "미리 써둔 스킬이 효과 있었나"의 데이터원)
CREATE TABLE IF NOT EXISTS learning_reviews (
  id          BIGSERIAL PRIMARY KEY,
  item_id     BIGINT NOT NULL REFERENCES learning_items(id),
  sent_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  outcome     TEXT CHECK (outcome IN ('correct','wrong','skipped')),
  answered_at TIMESTAMPTZ,
  UNIQUE (item_id, sent_on)                   -- 같은 항목을 같은 날 두 번 보내지 않는다
);

-- 간격반복 설정(미니 learning.json에서 이식). 값 하나만 바꾸면 전체 정책이 바뀐다.
CREATE TABLE IF NOT EXISTS learning_config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
INSERT INTO learning_config (key, value) VALUES
  ('intervals_days', '[1,3,7,16,35,90]'::jsonb),
  ('max_items_per_day', '7'::jsonb),
  ('blocks_by_weekday', '{"1":"industry","2":"invest","3":"industry","4":"culture","5":"invest"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 복습 결과에 따라 다음 일정을 계산하는 함수(결정적 — LLM이 스케줄을 정하지 않는다).
-- 정답: rep+1, 간격 배열의 다음 값만큼 뒤로. 오답: rep을 0으로 되돌려 처음부터.
CREATE OR REPLACE FUNCTION learning_schedule_next(p_item_id BIGINT, p_outcome TEXT)
RETURNS DATE LANGUAGE plpgsql AS $$
DECLARE
  v_intervals INTEGER[];
  v_rep INTEGER;
  v_gap INTEGER;
  v_next DATE;
BEGIN
  SELECT ARRAY(SELECT jsonb_array_elements_text(value)::int) INTO v_intervals
    FROM learning_config WHERE key = 'intervals_days';
  SELECT rep INTO v_rep FROM learning_items WHERE id = p_item_id;

  IF p_outcome = 'correct' THEN
    v_rep := LEAST(v_rep + 1, array_length(v_intervals, 1));
  ELSE
    v_rep := 0;
  END IF;

  IF p_outcome = 'correct' AND v_rep >= array_length(v_intervals, 1) THEN
    -- 마지막 간격까지 통과 = 익힘. 삭제하지 않고 retired로 표시(기록 보존).
    UPDATE learning_items SET rep = v_rep, retired = true, updated_at = now() WHERE id = p_item_id;
    RETURN NULL;
  END IF;

  v_gap := v_intervals[GREATEST(v_rep, 1)];
  v_next := CURRENT_DATE + v_gap;
  UPDATE learning_items SET rep = v_rep, next_due = v_next, updated_at = now() WHERE id = p_item_id;
  RETURN v_next;
END $$;

GRANT SELECT, INSERT, UPDATE ON learning_items, learning_reviews TO pipeline_runner;
GRANT SELECT ON learning_config TO pipeline_runner;
GRANT USAGE ON SEQUENCE learning_items_id_seq, learning_reviews_id_seq TO pipeline_runner;
GRANT SELECT, INSERT ON archive TO pipeline_runner;
GRANT USAGE ON SEQUENCE archive_id_seq TO pipeline_runner;
GRANT EXECUTE ON FUNCTION learning_schedule_next(BIGINT, TEXT) TO pipeline_runner;

COMMIT;
