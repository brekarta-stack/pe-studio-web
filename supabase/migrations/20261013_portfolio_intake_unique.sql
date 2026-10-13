-- 포트폴리오 인테이크(Slack 봇) 중복 초안 방지
-- 같은 묶음 키(airtable_id = 'intake:고객|날짜|명칭')는 한 행만 — 사진이 메시지 여러 개로 나뉘어
-- 동시에 들어와도 초안이 하나로 모인다. Airtable 동기화의 rec… ID 에는 영향이 없다.
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_items_intake_key_unique
  ON portfolio_items (airtable_id)
  WHERE airtable_id LIKE 'intake:%';
