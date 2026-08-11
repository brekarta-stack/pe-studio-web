-- 블로그 주간 자동 발행 대기열
-- queued: 발행 대기열 표시 (admin 에서 체크한 비공개 글을 크론이 순서대로 발행)
-- auto_published_at: 자동 발행 시각 — "이번 주 이미 발행했는가" 가드에 사용
ALTER TABLE posts ADD COLUMN IF NOT EXISTS queued BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS auto_published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS posts_queue_idx
  ON posts (created_at) WHERE queued AND NOT published;
