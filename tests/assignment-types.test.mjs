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
