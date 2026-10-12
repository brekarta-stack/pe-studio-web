/**
 * quoteFromRow 영업 파이프라인 필드 테스트 (node --test)
 *   node --test tests/quote-types-sales.test.mjs
 *
 * 마이그레이션 20261013 을 실행하기 전에도 어드민이 떠야 한다 — 새 컬럼이 없는 로우가
 * 기본값으로 떨어지는지, 그리고 컬럼이 다 있을 때 빠짐없이 옮겨지는지 확인한다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  quoteFromRow,
  isQuoteSource,
  QUOTE_SOURCES,
  SOURCE_LABELS,
} from "../src/lib/quote-types.ts";

/** 마이그레이션 20261013 이전의 로우 — 영업 컬럼이 아예 없다 */
const LEGACY = {
  id: "q1",
  product: "eco-kit",
  quantity: "100",
  delivery_date: "2026-11-01",
  purpose: "행사",
  custom_design: "",
  color_request: "",
  notes: "",
  name: "홍길동",
  email: "a@b.c",
  phone: "010",
  file_name: "",
  stage: "consulting",
  created_at: "2026-10-01T00:00:00.000Z",
};

test("레거시 로우 — 새 컬럼이 없어도 던지지 않고 기본값으로 떨어진다", () => {
  const q = quoteFromRow(LEGACY);
  assert.equal(q.source, "inbound");
  assert.equal(q.org, "");
  assert.equal(q.orgKey, "");
  assert.equal(q.segment, "");
  assert.equal(q.score, null);
  assert.equal(q.proposalUrl, "");
  assert.equal(q.proposalSentAt, null);
  assert.equal(q.proposalSentTo, "");
  assert.equal(q.nextActionAt, null);
  assert.equal(q.convertedAt, null);
  assert.equal(q.stageChangedAt, null);
  assert.equal(q.closedAt, null);
  assert.equal(q.lostReason, "");
  assert.equal(q.outreach, null);
  assert.equal(q.stage, "consulting");
});

test("모르는 단계·원천은 기본값으로 (기존 stage 폴백 유지)", () => {
  const q = quoteFromRow({ ...LEGACY, stage: "on_hold", source: "partner", score: "abc", outreach: [1, 2] });
  assert.equal(q.stage, "new");
  assert.equal(q.source, "inbound");
  assert.equal(q.score, null);
  assert.equal(q.outreach, null, "배열은 객체로 믿지 않는다");
});

test("전체 로우 — 모든 영업 필드가 옮겨진다", () => {
  const outreach = { subject: "제안", slug: "nie-ecology-friends" };
  const q = quoteFromRow({
    ...LEGACY,
    stage: "followup",
    source: "outbound",
    org: "국립생태원(NIE)",
    org_key: "국립생태원",
    segment: "공공",
    score: 87,
    proposal_url: "https://docs.google.com/x",
    proposal_sent_at: "2026-10-02T01:00:00.000Z",
    proposal_sent_to: "nie@example.kr",
    next_action_at: "2026-10-16",
    converted_at: "2026-10-10T01:00:00.000Z",
    stage_changed_at: "2026-10-09T01:00:00.000Z",
    closed_at: "2026-10-11T01:00:00.000Z",
    lost_reason: "예산 없음",
    outreach,
  });
  assert.equal(q.stage, "followup");
  assert.equal(q.source, "outbound");
  assert.equal(q.org, "국립생태원(NIE)");
  assert.equal(q.orgKey, "국립생태원");
  assert.equal(q.segment, "공공");
  assert.equal(q.score, 87);
  assert.equal(q.proposalUrl, "https://docs.google.com/x");
  assert.equal(q.proposalSentAt, "2026-10-02T01:00:00.000Z");
  assert.equal(q.proposalSentTo, "nie@example.kr");
  assert.equal(q.nextActionAt, "2026-10-16");
  assert.equal(q.convertedAt, "2026-10-10T01:00:00.000Z");
  assert.equal(q.stageChangedAt, "2026-10-09T01:00:00.000Z");
  assert.equal(q.closedAt, "2026-10-11T01:00:00.000Z");
  assert.equal(q.lostReason, "예산 없음");
  assert.deepEqual(q.outreach, outreach);
});

test("원천 레지스트리", () => {
  assert.deepEqual([...QUOTE_SOURCES], ["inbound", "outbound"]);
  assert.equal(SOURCE_LABELS.inbound, "인바운드");
  assert.equal(SOURCE_LABELS.outbound, "아웃바운드");
  assert.ok(isQuoteSource("outbound"));
  assert.equal(isQuoteSource("manual"), false);
});
