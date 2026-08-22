/**
 * IP 요청 한도 테스트 (node --test)
 *   node --test tests/rate-limit.test.mjs
 *
 * 이 로직은 원래 라우트 안에 숨어 있어 테스트가 불가능했고, 그 사이
 * "실패한 시도까지 한도를 깎는" 사고가 났다 — 고객이 오류를 보고 다시 누를수록
 * 429 에 가까워져서, 고칠 수 없는 오류가 됐다. 그 규칙을 여기서 못 박는다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createRateLimiter } from "../src/lib/rate-limit.ts";

const OPTS = { acceptLimit: 5, totalLimit: 60, windowMs: 60_000 };
const T0 = 1_700_000_000_000; // 고정 기준시각 (Date.now 에 의존하지 않게)

test("실패한 시도는 한도를 깎지 않는다 — 이 폼이 겪은 바로 그 사고", () => {
  const rl = createRateLimiter(OPTS);
  // 20번 연속 실패(= allow 만 하고 recordAccepted 없음)해도 계속 받아준다
  for (let i = 0; i < 20; i++) {
    assert.equal(rl.allow("1.1.1.1", T0), true, `${i + 1}번째 시도에서 막혔다`);
  }
});

test("접수 성공 5건을 넘으면 막는다 — 중복 제출 방지", () => {
  const rl = createRateLimiter(OPTS);
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.allow("2.2.2.2", T0), true);
    rl.recordAccepted("2.2.2.2", T0);
  }
  assert.equal(rl.allow("2.2.2.2", T0), false, "6번째 접수는 막혀야 한다");
});

test("총 요청 상한이 남용을 막는다", () => {
  const rl = createRateLimiter(OPTS);
  for (let i = 0; i < 60; i++) assert.equal(rl.allow("3.3.3.3", T0), true);
  assert.equal(rl.allow("3.3.3.3", T0), false, "61번째부터는 막혀야 한다");
});

test("창이 지나면 초기화된다", () => {
  const rl = createRateLimiter(OPTS);
  for (let i = 0; i < 5; i++) {
    rl.allow("4.4.4.4", T0);
    rl.recordAccepted("4.4.4.4", T0);
  }
  assert.equal(rl.allow("4.4.4.4", T0), false);
  assert.equal(rl.allow("4.4.4.4", T0 + 60_001), true, "다음 창에서는 다시 받아야 한다");
});

test("IP 마다 따로 센다", () => {
  const rl = createRateLimiter(OPTS);
  for (let i = 0; i < 5; i++) {
    rl.allow("5.5.5.5", T0);
    rl.recordAccepted("5.5.5.5", T0);
  }
  assert.equal(rl.allow("5.5.5.5", T0), false);
  assert.equal(rl.allow("6.6.6.6", T0), true, "다른 IP 까지 막으면 안 된다");
});

test("만료 항목을 청소한다 — 오래 사는 인스턴스에서 맵만 커지던 문제", () => {
  const rl = createRateLimiter({ ...OPTS, maxEntries: 10 });
  for (let i = 0; i < 10; i++) rl.allow(`old-${i}`, T0);
  assert.equal(rl.size(), 10);
  // 창이 지난 뒤 새 IP 가 들어오면 만료 항목이 정리된다
  rl.allow("new", T0 + 60_001);
  assert.equal(rl.size(), 1, "만료된 10개가 정리되고 새 항목만 남아야 한다");
});

test("peek 은 살아 있는 창만 보여준다", () => {
  const rl = createRateLimiter(OPTS);
  rl.allow("7.7.7.7", T0);
  assert.equal(rl.peek("7.7.7.7", T0).total, 1);
  assert.equal(rl.peek("7.7.7.7", T0 + 60_001), null);
  assert.equal(rl.peek("없는아이피", T0), null);
});
