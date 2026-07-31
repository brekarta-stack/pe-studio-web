/**
 * 개략 견적 계산 테스트 (node --test)
 *   node --test tests/quote-pricing.test.mjs
 *
 * 고객에게 그대로 보이는 금액이라 자릿수 하나만 틀려도 사고가 된다.
 * 단가 기준: 디자인 1종 50만~700만 / 1개당 생산 1,000~15,000원 /
 *            포장 1개당 벌크 0 · OPP 500 · 종이박스 1,500원.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateQuote,
  parseQuantity,
  formatKrw,
  formatRange,
  DESIGN_COST_MIN,
  DESIGN_COST_MAX,
} from "../src/lib/quote-pricing.ts";

const line = (quantity, over = {}) => ({
  id: "l1",
  name: "",
  quantity: String(quantity),
  file: null,
  ...over,
});

test("라인이 없으면 전부 0 — '무료'로 읽히지 않게 폼에서 카드를 감춘다", () => {
  const e = estimateQuote([], "bulk");
  assert.equal(e.designCount, 0);
  assert.equal(e.totalQuantity, 0);
  assert.equal(e.totalMin, 0);
  assert.equal(e.totalMax, 0);
  assert.equal(e.quantityMissing, false, "라인 자체가 없으면 '수량 미입력'이 아니다");
});

test("디자인 1종 1,000부 벌크 — 디자인비 + 생산비", () => {
  const e = estimateQuote([line(1000)], "bulk");
  assert.equal(e.designCount, 1);
  assert.equal(e.totalQuantity, 1000);
  assert.equal(e.designMin, 500_000);
  assert.equal(e.designMax, 7_000_000);
  assert.equal(e.productionMin, 1_000_000, "1,000개 × 1,000원");
  assert.equal(e.productionMax, 15_000_000, "1,000개 × 15,000원");
  assert.equal(e.packagingCost, 0, "벌크는 포장비 없음");
  assert.equal(e.totalMin, 1_500_000);
  assert.equal(e.totalMax, 22_000_000);
});

test("라인을 추가하면 디자인비와 수량이 함께 늘어난다", () => {
  const one = estimateQuote([line(1000)], "bulk");
  const two = estimateQuote([line(1000), line(2000, { id: "l2" })], "bulk");

  assert.equal(two.designCount, 2);
  assert.equal(two.totalQuantity, 3000, "종류별 수량의 합계");
  assert.equal(two.designMin - one.designMin, DESIGN_COST_MIN, "라인당 디자인비 하한이 더해진다");
  assert.equal(two.designMax - one.designMax, DESIGN_COST_MAX);
  assert.ok(two.totalMin > one.totalMin, "범위가 늘어난다");
});

test("포장비는 총수량에 개당 단가를 곱한 고정액 (범위 아님)", () => {
  const qty = 2000;
  assert.equal(estimateQuote([line(qty)], "bulk").packagingCost, 0);
  assert.equal(estimateQuote([line(qty)], "opp").packagingCost, 1_000_000, "2,000 × 500");
  assert.equal(estimateQuote([line(qty)], "paper-box").packagingCost, 3_000_000, "2,000 × 1,500");
});

test("포장비는 하한·상한에 똑같이 더해진다", () => {
  const bulk = estimateQuote([line(1000)], "bulk");
  const box = estimateQuote([line(1000)], "paper-box");
  const diff = 1000 * 1500;
  assert.equal(box.totalMin - bulk.totalMin, diff);
  assert.equal(box.totalMax - bulk.totalMax, diff);
});

test("포장 미선택은 벌크와 같게 취급한다 (추가 비용 0)", () => {
  assert.equal(estimateQuote([line(1000)], "").packagingCost, 0);
});

test("수량 미입력은 따로 알린다 — 생산비를 셀 수 없는 상태", () => {
  const e = estimateQuote([line("")], "bulk");
  assert.equal(e.quantityMissing, true);
  assert.equal(e.totalQuantity, 0);
  assert.equal(e.designMin, 500_000, "디자인비는 라인 수만으로 계산된다");
});

test("parseQuantity — 콤마·단위가 섞여도 숫자만 읽는다", () => {
  assert.equal(parseQuantity("1,000"), 1000);
  assert.equal(parseQuantity("1000개"), 1000);
  assert.equal(parseQuantity(""), 0);
  assert.equal(parseQuantity("abc"), 0);
  assert.equal(parseQuantity("-500"), 500, "부호는 무시하고 숫자만");
});

test("formatKrw — 억·만 단위로 읽기 쉽게", () => {
  assert.equal(formatKrw(500_000), "50만원");
  assert.equal(formatKrw(1_500_000), "150만원");
  assert.equal(formatKrw(22_000_000), "2,200만원");
  assert.equal(formatKrw(100_000_000), "1억원");
  assert.equal(formatKrw(123_000_000), "1억 2,300만원");
  assert.equal(formatKrw(0), "0원");
});

test("formatRange — 하한과 상한이 같으면 하나만", () => {
  assert.equal(formatRange(1_500_000, 22_000_000), "150만원 ~ 2,200만원");
  assert.equal(formatRange(500_000, 500_000), "50만원");
});
