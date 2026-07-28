/**
 * 업무 배정 계산 로직 테스트 (node --test)
 *   node --test tests/assignment-types.test.mjs
 *
 * 화면에서 눈으로 확인하기 어려운 것들 — 납기 D-day 경계, 마진 계산,
 * 상태 가드 — 만 골라서 검증한다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  daysUntil,
  dueUrgency,
  margin,
  isActive,
  formatWon,
  isQuoteStage,
  isAssignmentStatus,
  isPayoutStatus,
  STAGE_LABELS,
  QUOTE_STAGES,
  vatOf,
  withVat,
  balanceOf,
  paidFee,
  unpaidFee,
  derivePayoutStatus,
  feeNetOf,
  feeTaxAmountOf,
  withholdingOf,
  isFeeTaxMode,
} from "../src/lib/assignment-types.ts";

/** 테스트 기준일 — 로컬 자정 (실제 실행 시각의 영향을 받지 않게 고정) */
const TODAY = new Date(2026, 6, 28); // 2026-07-28

test("daysUntil — 시:분:초에 흔들리지 않고 날짜 차이만 센다", () => {
  assert.equal(daysUntil("2026-07-28", TODAY), 0, "당일은 0");
  assert.equal(daysUntil("2026-07-29", TODAY), 1);
  assert.equal(daysUntil("2026-08-04", TODAY), 7);
  assert.equal(daysUntil("2026-07-27", TODAY), -1, "지난 날짜는 음수");
  assert.equal(daysUntil(null, TODAY), null);
  assert.equal(daysUntil("", TODAY), null);
  assert.equal(daysUntil("garbage", TODAY), null);
});

test("daysUntil — 실행 시각이 늦은 오후여도 D-day 가 밀리지 않는다", () => {
  const lateAfternoon = new Date(2026, 6, 28, 23, 59, 30);
  assert.equal(daysUntil("2026-07-29", lateAfternoon), 1);
  assert.equal(daysUntil("2026-07-28", lateAfternoon), 0);
});

test("daysUntil — 월·연 경계를 넘어도 맞다", () => {
  assert.equal(daysUntil("2026-08-01", new Date(2026, 6, 31)), 1, "7/31 → 8/1");
  assert.equal(daysUntil("2027-01-01", new Date(2026, 11, 31)), 1, "12/31 → 1/1");
});

test("dueUrgency — D-7 이내는 soon, 지나면 overdue", () => {
  const w = (dueDate, status = "working") => ({ dueDate, status });
  assert.equal(dueUrgency(w("2026-08-05"), TODAY), "none", "D-8 은 아직 여유");
  assert.equal(dueUrgency(w("2026-08-04"), TODAY), "soon", "D-7 은 경고");
  assert.equal(dueUrgency(w("2026-07-28"), TODAY), "soon", "당일도 경고");
  assert.equal(dueUrgency(w("2026-07-27"), TODAY), "overdue");
  assert.equal(dueUrgency(w(null), TODAY), "none", "납기 미정은 경고하지 않음");
});

test("dueUrgency — 완료·취소 건은 기한이 지나도 경고하지 않는다", () => {
  assert.equal(dueUrgency({ dueDate: "2026-01-01", status: "done" }, TODAY), "none");
  assert.equal(dueUrgency({ dueDate: "2026-01-01", status: "cancelled" }, TODAY), "none");
  assert.equal(dueUrgency({ dueDate: "2026-01-01", status: "review" }, TODAY), "overdue");
});

test("margin — 둘 다 있어야 계산한다", () => {
  assert.equal(margin({ artistFee: 1_000_000, clientAmount: 2_500_000 }), 1_500_000);
  assert.equal(margin({ artistFee: 3_000_000, clientAmount: 2_500_000 }), -500_000, "역마진");
  assert.equal(margin({ artistFee: null, clientAmount: 2_500_000 }), null);
  assert.equal(margin({ artistFee: 1_000_000, clientAmount: null }), null);
  assert.equal(margin({ artistFee: 0, clientAmount: 0 }), 0, "0 은 미입력이 아니다");
});

test("isActive — 배정·작업중·검수만 진행중으로 센다", () => {
  assert.equal(isActive({ status: "assigned" }), true);
  assert.equal(isActive({ status: "working" }), true);
  assert.equal(isActive({ status: "review" }), true);
  assert.equal(isActive({ status: "done" }), false);
  assert.equal(isActive({ status: "cancelled" }), false);
});

test("formatWon — 천단위 콤마, 미입력은 —", () => {
  assert.equal(formatWon(1234567), "1,234,567");
  assert.equal(formatWon(0), "0");
  assert.equal(formatWon(null), "—");
  assert.equal(formatWon(undefined), "—");
});

test("타입 가드 — 알 수 없는 값을 거른다", () => {
  assert.equal(isQuoteStage("producing"), true);
  assert.equal(isQuoteStage("nonsense"), false);
  assert.equal(isQuoteStage(null), false);

  assert.equal(isAssignmentStatus("working"), true);
  assert.equal(isAssignmentStatus("in_progress"), false, "quotes 쪽 용어와 섞이지 않아야 한다");

  assert.equal(isPayoutStatus("paid"), true);
  assert.equal(isPayoutStatus("done"), false);
});

test("STAGE_LABELS — 모든 단계에 한글 라벨이 있다", () => {
  for (const s of QUOTE_STAGES) {
    assert.ok(STAGE_LABELS[s], `${s} 라벨 누락`);
  }
});

/* ── 부가세 ── */

test("vatOf / withVat — 공급가액의 10%, 원 미만은 절사", () => {
  assert.equal(vatOf(3_850_000), 385_000);
  assert.equal(withVat(3_850_000), 4_235_000);
  assert.equal(vatOf(1_234_567), 123_456, "123,456.7 → 절사");
  assert.equal(withVat(1_234_567), 1_358_023);
  assert.equal(vatOf(0), 0);
  assert.equal(vatOf(null), null, "미입력은 계산하지 않는다");
  assert.equal(withVat(null), null);
});

/* ── 작업비 세금 처리 (켠 경우에만 계산) ── */

test("feeNetOf — 세금 없음이 기본, 금액을 건드리지 않는다", () => {
  assert.equal(feeNetOf(2_000_000, "none"), 2_000_000);
  assert.equal(feeTaxAmountOf(2_000_000, "none"), 0);
  assert.equal(feeNetOf(null, "none"), null);
});

test("feeNetOf — 사업자(vat)는 부가세를 더해 지급", () => {
  assert.equal(feeNetOf(2_000_000, "vat"), 2_200_000);
  assert.equal(feeTaxAmountOf(2_000_000, "vat"), 200_000, "가산은 +");
});

test("feeNetOf — 프리랜서(withholding)는 3.3% 를 떼고 지급", () => {
  // 문재호 같은 프리랜서: 2,000,000 × 3.3% = 66,000 원천징수 → 1,934,000 입금
  assert.equal(withholdingOf(2_000_000), 66_000);
  assert.equal(feeNetOf(2_000_000, "withholding"), 1_934_000);
  assert.equal(feeTaxAmountOf(2_000_000, "withholding"), -66_000, "공제는 −");
});

test("withholdingOf — 원 미만은 절사", () => {
  assert.equal(withholdingOf(1_000_000), 33_000);
  assert.equal(withholdingOf(1_234_567), 40_740, "40,740.7 → 절사");
  assert.equal(withholdingOf(null), null);
});

test("isFeeTaxMode — 알 수 없는 값을 거른다", () => {
  assert.equal(isFeeTaxMode("withholding"), true);
  assert.equal(isFeeTaxMode("vat"), true);
  assert.equal(isFeeTaxMode("none"), true);
  assert.equal(isFeeTaxMode("3.3"), false);
  assert.equal(isFeeTaxMode(null), false);
});

test("마진은 세전 작업비 기준 — 원천징수분도 결국 내가 납부한다", () => {
  // 실지급이 1,934,000 이어도 3.3% 는 내가 세무서에 내므로 비용은 2,000,000 전액
  const m = margin({ artistFee: 2_000_000, clientAmount: 3_850_000 });
  assert.equal(m, 1_850_000);
  assert.notEqual(m, 3_850_000 - feeNetOf(2_000_000, "withholding"));
});

/* ── 선금 / 잔금 ── */

test("balanceOf — 잔금은 작업비 − 선금, 음수가 되지 않는다", () => {
  assert.equal(balanceOf({ artistFee: 5_000_000, depositAmount: 2_000_000 }), 3_000_000);
  assert.equal(balanceOf({ artistFee: 5_000_000, depositAmount: null }), 5_000_000, "선금 없으면 전액");
  assert.equal(balanceOf({ artistFee: 5_000_000, depositAmount: 5_000_000 }), 0);
  assert.equal(balanceOf({ artistFee: 1_000_000, depositAmount: 3_000_000 }), 0, "선금 초과는 0 으로 막는다");
  assert.equal(balanceOf({ artistFee: null, depositAmount: 1_000_000 }), null);
});

test("paidFee / unpaidFee — 지급 처리된 회차만 더한다", () => {
  const w = (o) => ({ artistFee: 5_000_000, depositAmount: 2_000_000, depositPaidAt: null, balancePaidAt: null, ...o });
  assert.equal(paidFee(w({})), 0);
  assert.equal(paidFee(w({ depositPaidAt: "2026-07-01" })), 2_000_000);
  assert.equal(paidFee(w({ balancePaidAt: "2026-08-01" })), 3_000_000);
  assert.equal(paidFee(w({ depositPaidAt: "2026-07-01", balancePaidAt: "2026-08-01" })), 5_000_000);
  assert.equal(unpaidFee(w({ depositPaidAt: "2026-07-01" })), 3_000_000, "남은 것은 잔금");
  assert.equal(unpaidFee(w({ depositPaidAt: "2026-07-01", balancePaidAt: "2026-08-01" })), 0);
});

test("paidFee — 금액이 0 인 회차는 지급일이 있어도 세지 않는다", () => {
  // 선금 없이 잔금만 있는 건: 선금 지급일이 잘못 남아 있어도 금액은 0
  const noDeposit = { artistFee: 4_000_000, depositAmount: 0, depositPaidAt: "2026-07-01", balancePaidAt: null };
  assert.equal(paidFee(noDeposit), 0);
  assert.equal(unpaidFee(noDeposit), 4_000_000);
});

test("derivePayoutStatus — 선금/잔금 지급 여부에서 상태를 만든다", () => {
  const w = (o) => ({ artistFee: 5_000_000, depositAmount: 2_000_000, depositPaidAt: null, balancePaidAt: null, ...o });
  assert.equal(derivePayoutStatus(w({})), "unpaid");
  assert.equal(derivePayoutStatus(w({ depositPaidAt: "2026-07-01" })), "partial");
  assert.equal(derivePayoutStatus(w({ balancePaidAt: "2026-08-01" })), "partial");
  assert.equal(
    derivePayoutStatus(w({ depositPaidAt: "2026-07-01", balancePaidAt: "2026-08-01" })),
    "paid"
  );
});

test("derivePayoutStatus — 선금 없이 잔금만 지급해도 완료", () => {
  assert.equal(
    derivePayoutStatus({
      artistFee: 4_000_000, depositAmount: null,
      depositPaidAt: null, balancePaidAt: "2026-08-01",
    }),
    "paid",
    "선금을 안 잡았으면 잔금 = 전액"
  );
});

test("derivePayoutStatus — 작업비 미입력이면 지급을 논할 수 없다", () => {
  assert.equal(
    derivePayoutStatus({ artistFee: null, depositAmount: null, depositPaidAt: null, balancePaidAt: null }),
    "unpaid"
  );
  assert.equal(
    derivePayoutStatus({ artistFee: 0, depositAmount: null, depositPaidAt: null, balancePaidAt: "2026-08-01" }),
    "unpaid",
    "0원짜리를 지급완료로 표시하지 않는다"
  );
});
