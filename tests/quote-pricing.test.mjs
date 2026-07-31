/**
 * 개략 견적 계산 테스트 (node --test)
 *   node --test tests/quote-pricing.test.mjs
 *
 * 고객에게 그대로 보이는 금액이라 자릿수 하나만 틀려도 사고가 된다.
 *
 * 기준:
 *   도면만 의뢰 — 디자인비 1종 50만~600만. 수량·포장 없음.
 *   제품 생산   — 디자인비 1종 50만~600만 + 생산비 개당 2,000~15,000원 + 포장비
 *   완제품 의뢰 — 제작비 1종 50만~1,000만. 수량으로 곱하지 않는다.
 *   포장(개당) — 벌크 0 / OPP 500 / 종이박스 2,000원. 고르는 순간 확정되는
 *              비용이라 하한·상한 양쪽에 더한다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateQuote,
  parseQuantity,
  formatKrw,
  formatRange,
  isOrderType,
  ORDER_TYPES,
  ORDER_TYPE_SPECS,
} from "../src/lib/quote-pricing.ts";

const line = (quantity, id = "l1") => ({ id, name: "", quantity: String(quantity), file: null });

test("isOrderType — 정의된 값만 통과", () => {
  for (const t of ORDER_TYPES) assert.equal(isOrderType(t), true, t);
  assert.equal(isOrderType("etc"), false);
  assert.equal(isOrderType(""), false);
  assert.equal(isOrderType(undefined), false);
});

/* ── 도면만 의뢰 ── */

test("도면만 의뢰 — 디자인비만, 수량은 금액에 영향이 없다", () => {
  const e = estimateQuote("blueprint", [line(9999)], "paper-box");
  assert.equal(e.costLabel, "디자인비");
  assert.equal(e.designMin, 500_000);
  assert.equal(e.designMax, 6_000_000);
  assert.equal(e.productionMin, 0, "실물을 만들지 않는다");
  assert.equal(e.productionMax, 0);
  assert.equal(e.packagingCost, 0, "포장할 실물이 없다");
  assert.equal(e.totalQuantity, 0, "수량 자체를 세지 않는다");
  assert.equal(e.totalMin, 500_000);
  assert.equal(e.totalMax, 6_000_000);
});

test("도면만 의뢰 — 수량 미입력 경고가 뜨지 않는다", () => {
  assert.equal(estimateQuote("blueprint", [line("")], "bulk").quantityMissing, false);
});

/* ── 제품 생산 ── */

test("제품 생산 1종 1,000부 벌크 — 디자인비 + 생산비", () => {
  const e = estimateQuote("production", [line(1000)], "bulk");
  assert.equal(e.designMin, 500_000);
  assert.equal(e.designMax, 6_000_000);
  assert.equal(e.productionMin, 2_000_000, "1,000개 × 2,000원");
  assert.equal(e.productionMax, 15_000_000, "1,000개 × 15,000원");
  assert.equal(e.packagingCost, 0, "벌크는 포장비 없음");
  assert.equal(e.totalMin, 2_500_000);
  assert.equal(e.totalMax, 21_000_000);
});

test("제품 생산 — 라인을 추가하면 종류와 총수량이 함께 늘어난다", () => {
  const one = estimateQuote("production", [line(1000)], "bulk");
  const two = estimateQuote("production", [line(1000), line(2000, "l2")], "bulk");
  assert.equal(two.designCount, 2);
  assert.equal(two.totalQuantity, 3000);
  assert.equal(two.designMin - one.designMin, 500_000);
  assert.equal(two.designMax - one.designMax, 6_000_000);
  assert.ok(two.totalMax > one.totalMax);
});

test("포장비는 총액의 하한·상한 양쪽에 더해진다", () => {
  // 상한에만 얹으면 포장을 골라도 왼쪽 금액이 그대로라 "계산이 안 된다"고 읽힌다
  const bulk = estimateQuote("production", [line(1000)], "bulk");
  const box = estimateQuote("production", [line(1000)], "paper-box");

  assert.equal(box.packagingCost, 2_000_000, "1,000개 × 2,000원");
  assert.equal(box.totalMin - bulk.totalMin, 2_000_000, "하한도 함께 올라간다");
  assert.equal(box.totalMax - bulk.totalMax, 2_000_000);
});

test("포장 방식별 개당 단가 — 벌크 0 / OPP 500 / 종이박스 2,000", () => {
  const q = 2000;
  assert.equal(estimateQuote("production", [line(q)], "bulk").packagingCost, 0);
  assert.equal(estimateQuote("production", [line(q)], "opp").packagingCost, 1_000_000);
  assert.equal(estimateQuote("production", [line(q)], "paper-box").packagingCost, 4_000_000);
  assert.equal(estimateQuote("production", [line(q)], "").packagingCost, 0, "미선택은 0");
  assert.equal(
    estimateQuote("production", [line(q)], "opp").packagingUnitCost,
    500,
    "화면에 근거로 보여줄 개당 단가"
  );
});

test("포장을 고르면 총액이 정확히 그만큼 오른다 — 1종 1,000부 OPP", () => {
  const e = estimateQuote("production", [line(1000)], "opp");
  // 디자인 50만~600만 + 생산 200만~1,500만 + 포장 50만(1,000×500)
  assert.equal(e.totalMin, 3_000_000);
  assert.equal(e.totalMax, 21_500_000);
});

test("제품 생산 — 수량 미입력은 따로 알린다", () => {
  const e = estimateQuote("production", [line("")], "bulk");
  assert.equal(e.quantityMissing, true);
  assert.equal(e.designMin, 500_000, "디자인비는 라인 수만으로 계산된다");
  assert.equal(e.productionMin, 0);
});

/* ── 완제품 의뢰 ── */

test("완제품 의뢰 — 제작비 하나로, 수량으로 곱하지 않는다", () => {
  const e = estimateQuote("finished", [line(5)], "bulk");
  assert.equal(e.costLabel, "제작비");
  assert.equal(e.designMin, 500_000);
  assert.equal(e.designMax, 10_000_000);
  assert.equal(e.productionMin, 0, "생산비를 따로 세지 않는다");
  assert.equal(e.productionMax, 0);
  assert.equal(e.totalMax, 10_000_000);
});

test("완제품 의뢰 — 종류가 늘면 제작비가 늘어난다", () => {
  const e = estimateQuote("finished", [line(1), line(1, "l2")], "bulk");
  assert.equal(e.designMax, 20_000_000, "2종 × 1,000만원");
});

/* ── 공통 ── */

test("라인이 없으면 전부 0 — 폼에서 금액 대신 안내 문구를 띄운다", () => {
  for (const t of ORDER_TYPES) {
    const e = estimateQuote(t, [], "paper-box");
    assert.equal(e.totalMin, 0, t);
    assert.equal(e.totalMax, 0, t);
    assert.equal(e.quantityMissing, false, t);
  }
});

test("주문 형태 기본 수량 — 생산 1,000부 / 완제품 1개 / 도면 없음", () => {
  assert.equal(ORDER_TYPE_SPECS.production.defaultQuantity, 1000);
  assert.equal(ORDER_TYPE_SPECS.finished.defaultQuantity, 1);
  assert.equal(ORDER_TYPE_SPECS.blueprint.hasQuantity, false);
});

test("parseQuantity — 콤마·단위가 섞여도 숫자만 읽는다", () => {
  assert.equal(parseQuantity("1,000"), 1000);
  assert.equal(parseQuantity("1000부"), 1000);
  assert.equal(parseQuantity(""), 0);
  assert.equal(parseQuantity("abc"), 0);
});

test("formatKrw — 억·만 단위로 읽기 쉽게", () => {
  assert.equal(formatKrw(500_000), "50만원");
  assert.equal(formatKrw(21_000_000), "2,100만원");
  assert.equal(formatKrw(100_000_000), "1억원");
  assert.equal(formatKrw(123_000_000), "1억 2,300만원");
  assert.equal(formatKrw(0), "0원");
});

test("formatRange — 하한과 상한이 같으면 하나만", () => {
  assert.equal(formatRange(2_500_000, 21_000_000), "250만원 ~ 2,100만원");
  assert.equal(formatRange(500_000, 500_000), "50만원");
});
