/**
 * 월 정산 집계 테스트 (node --test)
 *   node --test tests/settlement.test.mjs
 *
 * 월 귀속(납기 → 생성일 폴백), 취소 제외, 부가세 조건, 수금/미수 분리, CSV 형식을 검증한다.
 * 숫자가 틀려도 화면은 멀쩡히 뜨므로 눈으로는 못 잡는다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  monthKeyOf,
  receivedMonthOf,
  payoutMonthsOf,
  summarizeMonth,
  availableMonths,
  settlementCsv,
  formatMonthLabel,
} from "../src/lib/settlement.ts";

/** 배정 뷰 한 벌 — 지정한 필드만 덮어쓴다 */
function row(over = {}) {
  return {
    id: "a1",
    quoteId: "q1",
    artistId: "ar1",
    status: "working",
    progress: 0,
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
    dueDate: "2026-10-20",
    startedAt: null,
    memo: "",
    offerStatus: "accepted",
    offeredAt: null,
    respondedAt: null,
    declineReason: "",
    deliverables: [],
    createdAt: "2026-09-01T03:00:00.000Z",
    updatedAt: "2026-09-01T03:00:00.000Z",
    artistName: "문재호",
    quoteName: "국립생태원",
    quoteProduct: "eco-kit",
    quoteCreatedAt: "2026-08-30T00:00:00.000Z",
    quoteStage: "producing",
    ...over,
  };
}

test("monthKeyOf — 납기가 있으면 납기, 없으면 생성일(로컬)", () => {
  assert.equal(monthKeyOf(row()), "2026-10");
  const created = new Date(2026, 8, 15, 12).toISOString(); // 로컬 9/15 정오
  assert.equal(monthKeyOf(row({ dueDate: null, createdAt: created })), "2026-09");
  assert.equal(monthKeyOf(row({ dueDate: null, createdAt: "2026-07-03" })), "2026-07", "날짜만 있으면 그대로");
});

test("월 귀속은 한국 달력 — 서버가 UTC 여도 UTC 10/31 16:00 은 11월", () => {
  const instant = "2026-10-31T16:00:00Z"; // KST 2026-11-01 01:00
  assert.equal(monthKeyOf(row({ dueDate: null, createdAt: instant })), "2026-11");
  assert.equal(receivedMonthOf(row({ clientPaidAt: instant })), "2026-11");
  assert.deepEqual(payoutMonthsOf(row({ depositPaidAt: instant, balancePaidAt: null })), ["2026-11"]);
  assert.deepEqual(availableMonths([], new Date(instant)), ["2026-11"]);
  // 날짜만 있는 값은 밀리지 않는다
  assert.equal(receivedMonthOf(row({ clientPaidAt: "2026-10-31" })), "2026-10");
});

test("receivedMonthOf / payoutMonthsOf", () => {
  assert.equal(receivedMonthOf(row()), null, "미수");
  assert.equal(receivedMonthOf(row({ clientPaidAt: "2026-11-02" })), "2026-11");
  assert.deepEqual(payoutMonthsOf(row()), []);
  assert.deepEqual(
    payoutMonthsOf(row({ depositPaidAt: "2026-09-10", balancePaidAt: "2026-10-30" })),
    ["2026-09", "2026-10"]
  );
  assert.deepEqual(payoutMonthsOf(row({ depositPaidAt: "2026-10-01", balancePaidAt: "2026-10-30" })), ["2026-10"]);
});

test("summarizeMonth — 취소 배정은 어디에도 잡히지 않는다", () => {
  const all = [
    row(),
    row({ id: "x", status: "cancelled", clientAmount: 9_000_000, artistFee: 5_000_000, clientPaidAt: "2026-10-05" }),
  ];
  const s = summarizeMonth(all, "2026-10");
  assert.equal(s.count, 1);
  assert.equal(s.revenue, 3_000_000);
  assert.equal(s.cost, 1_000_000);
  assert.equal(s.margin, 2_000_000);
  assert.equal(s.received, 0, "취소 건의 수금도 빠진다");
});

test("summarizeMonth — 부가세는 clientVat 를 켠 배정만, 작업비 세금은 모드대로", () => {
  const all = [
    row({ id: "a", clientAmount: 1_000_000, clientVat: true, artistFee: 500_000, feeTaxMode: "vat" }),
    row({ id: "b", clientAmount: 2_000_000, clientVat: false, artistFee: 1_000_000, feeTaxMode: "withholding" }),
  ];
  const s = summarizeMonth(all, "2026-10");
  assert.equal(s.revenue, 3_000_000);
  assert.equal(s.revenueVat, 100_000, "a 의 10% 만");
  assert.equal(s.costTax, 50_000 - 33_000, "+VAT 50,000 · −3.3% 33,000");
});

test("summarizeMonth — 수금은 입금 달 기준, 미수는 귀속 달 기준", () => {
  const all = [
    row({ id: "paid-next", dueDate: "2026-10-20", clientAmount: 1_000_000, clientPaidAt: "2026-11-05" }),
    row({ id: "unpaid", dueDate: "2026-10-25", clientAmount: 2_000_000 }),
    row({ id: "sep-paid-in-oct", dueDate: "2026-09-10", clientAmount: 500_000, clientPaidAt: "2026-10-02" }),
  ];
  const oct = summarizeMonth(all, "2026-10");
  assert.equal(oct.revenue, 3_000_000);
  assert.equal(oct.received, 500_000, "9월 귀속이지만 10월에 들어온 돈");
  assert.equal(oct.receivable, 2_000_000, "10월 귀속 중 미수만");
  const nov = summarizeMonth(all, "2026-11");
  assert.equal(nov.received, 1_000_000);
  assert.equal(nov.revenue, 0);
});

test("summarizeMonth — 선금·잔금이 다른 달이면 지급액이 달마다 나뉜다", () => {
  const a = row({ artistFee: 1_000_000, depositAmount: 300_000, depositPaidAt: "2026-09-15", balancePaidAt: null });
  const sep = summarizeMonth([a], "2026-09");
  const oct = summarizeMonth([a], "2026-10");
  assert.equal(sep.paidOut, 300_000);
  assert.equal(oct.paidOut, 0);
  assert.equal(oct.unpaid, 700_000, "10월 귀속 작업비 중 잔금 미지급");
  const done = { ...a, balancePaidAt: "2026-10-30" };
  assert.equal(summarizeMonth([done], "2026-10").paidOut, 700_000);
  assert.equal(summarizeMonth([done], "2026-10").unpaid, 0);
});

test("availableMonths — 이번 달 포함, 최신순, 중복 없음", () => {
  const today = new Date(2026, 9, 13);
  const all = [
    row({ dueDate: "2026-08-01" }),
    row({ dueDate: "2026-08-20" }),
    row({ dueDate: "2026-11-01" }),
    row({ dueDate: "2025-12-31", status: "cancelled" }),
  ];
  assert.deepEqual(availableMonths(all, today), ["2026-11", "2026-10", "2026-08"]);
  assert.deepEqual(availableMonths([], today), ["2026-10"]);
});

test("settlementCsv — BOM + 헤더 + 해당 달 배정 한 줄", () => {
  const all = [
    row({ clientVat: true, clientPaidAt: "2026-10-31", quoteName: "국립생태원, 본원" }),
    row({ id: "other-month", dueDate: "2026-11-01" }),
    row({ id: "cancelled", status: "cancelled" }),
  ];
  const csv = settlementCsv(all, "2026-10");
  assert.equal(csv.charCodeAt(0), 0xfeff, "엑셀 한글용 BOM");
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(lines.length, 2, "헤더 + 1행");
  assert.equal(
    lines[0],
    "고객,제품,아티스트,납기,매출(공급가),부가세,작업비,세금,마진,수금일,선금일,잔금일,상태"
  );
  assert.equal(
    lines[1],
    '"국립생태원, 본원",eco-kit,문재호,2026-10-20,3000000,300000,1000000,0,2000000,2026-10-31,,,작업중'
  );
});

test("settlementCsv — 수식으로 시작하는 문자열은 무력화한다", () => {
  const csv = settlementCsv([row({ quoteName: "=HYPERLINK(1)" })], "2026-10");
  assert.ok(csv.includes("'=HYPERLINK(1)"));
});

test("formatMonthLabel", () => {
  assert.equal(formatMonthLabel("2026-10"), "2026년 10월");
  assert.equal(formatMonthLabel("2026-01"), "2026년 1월");
  assert.equal(formatMonthLabel("bad"), "bad");
});
