/**
 * 완료 프로젝트 집계 테스트 (node --test)
 *   node --test tests/completed.test.mjs
 *
 * 리드 한 줄에 묶이는 배정 합계(취소 제외)·수금 판정·완료일 폴백을 검증한다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { summarizeQuoteBilling, completedAtOf } from "../src/lib/completed.ts";

function view(over = {}) {
  return {
    id: "a1",
    quoteId: "q1",
    artistId: "ar1",
    status: "done",
    progress: 100,
    artistFee: 1_000_000,
    clientAmount: 3_000_000,
    feeTaxMode: "none",
    clientVat: false,
    depositAmount: null,
    depositPaidAt: null,
    balancePaidAt: null,
    clientPaidAt: null,
    payoutStatus: "unpaid",
    paidAt: null,
    dueDate: "2026-10-10",
    startedAt: null,
    memo: "",
    offerStatus: "accepted",
    offeredAt: null,
    respondedAt: null,
    declineReason: "",
    deliverables: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    artistName: "문재호",
    quoteName: "국립생태원",
    quoteProduct: "papercraft",
    quoteCreatedAt: "2026-08-20T00:00:00Z",
    quoteStage: "delivered",
    ...over,
  };
}

test("summarizeQuoteBilling: 배정이 없으면 0·미확정", () => {
  const b = summarizeQuoteBilling([]);
  assert.deepEqual(b, {
    revenue: 0,
    artistNames: [],
    received: false,
    receivableCount: 0,
    payoutDone: false,
  });
});

test("summarizeQuoteBilling: 매출 합은 취소 배정을 뺀다", () => {
  const b = summarizeQuoteBilling([
    view({ id: "a1", clientAmount: 3_000_000 }),
    view({ id: "a2", clientAmount: 2_000_000, artistName: "김작가" }),
    view({ id: "a3", clientAmount: 9_000_000, status: "cancelled", artistName: "취소됨" }),
  ]);
  assert.equal(b.revenue, 5_000_000);
  assert.deepEqual(b.artistNames, ["문재호", "김작가"]);
});

test("summarizeQuoteBilling: 아티스트 이름은 중복 제거", () => {
  const b = summarizeQuoteBilling([view({ id: "a1" }), view({ id: "a2" })]);
  assert.deepEqual(b.artistNames, ["문재호"]);
});

test("summarizeQuoteBilling: 금액 있는 배정이 전부 수금돼야 수금 완료", () => {
  const partial = summarizeQuoteBilling([
    view({ id: "a1", clientPaidAt: "2026-10-11" }),
    view({ id: "a2", clientPaidAt: null }),
  ]);
  assert.equal(partial.received, false);
  assert.equal(partial.receivableCount, 1);

  const all = summarizeQuoteBilling([
    view({ id: "a1", clientPaidAt: "2026-10-11" }),
    view({ id: "a2", clientPaidAt: "2026-10-12" }),
    // 금액 없는 배정·취소 배정은 미수로 치지 않는다
    view({ id: "a3", clientAmount: null, clientPaidAt: null }),
    view({ id: "a4", status: "cancelled", clientPaidAt: null }),
  ]);
  assert.equal(all.received, true);
  assert.equal(all.receivableCount, 0);
});

test("summarizeQuoteBilling: 금액이 하나도 없으면 수금 완료로 보지 않는다", () => {
  const b = summarizeQuoteBilling([view({ clientAmount: null })]);
  assert.equal(b.received, false);
  assert.equal(b.receivableCount, 0);
  assert.equal(b.revenue, 0);
});

test("summarizeQuoteBilling: 지급 완료는 선금·잔금 지급일로 판정", () => {
  const unpaid = summarizeQuoteBilling([view()]);
  assert.equal(unpaid.payoutDone, false);

  const paid = summarizeQuoteBilling([
    view({ id: "a1", depositAmount: 300_000, depositPaidAt: "2026-09-10", balancePaidAt: "2026-10-10" }),
    view({ id: "a2", balancePaidAt: "2026-10-10" }),
  ]);
  assert.equal(paid.payoutDone, true);

  // 저장된 payoutStatus 캐시가 아니라 지급일을 본다
  const stale = summarizeQuoteBilling([view({ payoutStatus: "paid" })]);
  assert.equal(stale.payoutDone, false);

  // 작업비가 없으면 지급 완료로 보지 않는다
  assert.equal(summarizeQuoteBilling([view({ artistFee: null })]).payoutDone, false);
});

test("completedAtOf: closedAt → stageChangedAt → createdAt 순", () => {
  assert.equal(
    completedAtOf({ closedAt: "2026-10-05T00:00:00Z", stageChangedAt: "2026-10-06T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" }),
    "2026-10-05T00:00:00Z"
  );
  assert.equal(
    completedAtOf({ closedAt: null, stageChangedAt: "2026-10-06T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" }),
    "2026-10-06T00:00:00Z"
  );
  assert.equal(
    completedAtOf({ closedAt: null, stageChangedAt: null, createdAt: "2026-09-01T00:00:00Z" }),
    "2026-09-01T00:00:00Z"
  );
});
