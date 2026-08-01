/**
 * 개략 견적 계산 테스트 (node --test)
 *   node --test tests/quote-pricing.test.mjs
 *
 * 고객에게 그대로 보이는 금액이라 자릿수 하나만 틀려도 사고가 된다.
 *
 * 기준 (메인 캐릭터 및 디자인 = 1종):
 *   디자인비   — 모델 설계 난이도로 결정: 단순함 100만 / 일반적 200만 / 복잡함 300만.
 *               미선택 라인은 '일반적'으로 계산한다.
 *   도면만 의뢰 — 디자인비만. 수량·포장 없음.
 *   제품 생산   — 종당 [디자인비 + 생산비(그 종의 수량 기반: 첫 1,000부 400만,
 *               둘째 +250만, 셋째부터 +200만씩)] + 설명서 생산비 + 포장비
 *   완제품 의뢰 — 제작비 1종 300만~1,000만. 수량으로 곱하지 않는다.
 *   설명서     — guide 무료 / qr 종당 100만 / print 부수당 300원
 *   포장(개당)  — 벌크 0 / OPP 500 / 종이박스 2,000원. 고르는 순간 확정되는
 *               비용이라 하한·상한 양쪽에 더한다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateQuote,
  estimateLeadWeeks,
  parseQuantity,
  formatApprox,
  formatKrw,
  formatRange,
  formatFrom,
  formatWeeks,
  isComplexity,
  isManualOption,
  isOrderType,
  productionCost,
  productionCostForQuantity,
  designCostOf,
  COMPLEXITY_LEVELS,
  COMPLEXITY_SPECS,
  DEFAULT_COMPLEXITY,
  MANUAL_QR_COST,
  MANUAL_PRINT_UNIT_COST,
  ORDER_TYPES,
  ORDER_TYPE_SPECS,
  SAMPLING_COST,
  SAMPLING_IMPROVE_COST,
  SUPERVISION_COST,
} from "../src/lib/quote-pricing.ts";

const line = (quantity, id = "l1", complexity = "") => ({
  id,
  name: "",
  quantity: String(quantity),
  complexity,
  file: null,
});

test("isOrderType — 정의된 값만 통과", () => {
  for (const t of ORDER_TYPES) assert.equal(isOrderType(t), true, t);
  assert.equal(isOrderType("etc"), false);
  assert.equal(isOrderType(""), false);
  assert.equal(isOrderType(undefined), false);
});

/* ── 모델 설계 난이도 ── */

test("isComplexity — 정의된 값만 통과", () => {
  for (const c of COMPLEXITY_LEVELS) assert.equal(isComplexity(c), true, c);
  assert.equal(isComplexity(""), false);
  assert.equal(isComplexity("hard"), false);
});

test("난이도별 디자인비 — 단순함 100만 / 일반적 200만 / 복잡함 300만", () => {
  assert.equal(COMPLEXITY_SPECS.simple.cost, 1_000_000);
  assert.equal(COMPLEXITY_SPECS.normal.cost, 2_000_000);
  assert.equal(COMPLEXITY_SPECS.complex.cost, 3_000_000);
});

test("designCostOf — 미선택 라인은 기본 난이도(일반적)로 계산", () => {
  assert.equal(DEFAULT_COMPLEXITY, "normal");
  assert.equal(designCostOf({ complexity: "" }), 2_000_000);
  assert.equal(designCostOf({}), 2_000_000);
  assert.equal(designCostOf({ complexity: "simple" }), 1_000_000);
  assert.equal(designCostOf({ complexity: "complex" }), 3_000_000);
});

/* ── 도면만 의뢰 ── */

test("도면만 의뢰 — 디자인비만(난이도 기반), 수량은 금액에 영향이 없다", () => {
  const e = estimateQuote("blueprint", [line(9999)], "paper-box");
  assert.equal(e.costLabel, "디자인비");
  assert.equal(e.designMin, 2_000_000, "미선택은 일반적(200만)으로");
  assert.equal(e.designMax, 2_000_000, "난이도는 확정값 — 하한=상한");
  assert.equal(e.productionMin, 0, "실물을 만들지 않는다");
  assert.equal(e.productionMax, 0);
  assert.equal(e.packagingCost, 0, "포장할 실물이 없다");
  assert.equal(e.totalQuantity, 0, "수량 자체를 세지 않는다");
  assert.equal(e.totalMin, 2_000_000);
  assert.equal(e.totalMax, 2_000_000);
});

test("도면만 의뢰 — 난이도를 고르면 그 금액으로 계산된다", () => {
  assert.equal(estimateQuote("blueprint", [line(0, "l1", "simple")], "").totalMin, 1_000_000);
  assert.equal(estimateQuote("blueprint", [line(0, "l1", "normal")], "").totalMin, 2_000_000);
  assert.equal(estimateQuote("blueprint", [line(0, "l1", "complex")], "").totalMin, 3_000_000);
  // 라인마다 다른 난이도 — 합산
  const e = estimateQuote(
    "blueprint",
    [line(0, "l1", "simple"), line(0, "l2", "complex")],
    ""
  );
  assert.equal(e.designMin, 4_000_000, "100만 + 300만");
});

test("도면만 의뢰 — 수량 미입력 경고가 뜨지 않는다", () => {
  assert.equal(estimateQuote("blueprint", [line("")], "bulk").quantityMissing, false);
});

/* ── 생산비 (수량 기반 사다리) ── */

test("생산비 사다리 — 1블록 400만 / 2블록 650만 / 3블록 850만 / 이후 +200만씩", () => {
  assert.equal(productionCost(0), 0);
  assert.equal(productionCost(1), 4_000_000);
  assert.equal(productionCost(2), 6_500_000);
  assert.equal(productionCost(3), 8_500_000);
  assert.equal(productionCost(5), 12_500_000);
});

test("생산비 — 수량을 1,000부 단위로 올림해 사다리에 태운다", () => {
  assert.equal(productionCostForQuantity(0), 0);
  assert.equal(productionCostForQuantity(500), 4_000_000, "1,000부 미만도 첫 블록 값");
  assert.equal(productionCostForQuantity(1000), 4_000_000);
  assert.equal(productionCostForQuantity(1001), 6_500_000, "올림 — 둘째 블록 진입");
  assert.equal(productionCostForQuantity(2000), 6_500_000);
  assert.equal(productionCostForQuantity(3000), 8_500_000);
  assert.equal(productionCostForQuantity(5000), 12_500_000);
});

/* ── 제품 생산 ── */

test("제품 생산 1종 1,000부 벌크 — 디자인비(일반적) + 생산비(첫 1,000부)", () => {
  const e = estimateQuote("production", [line(1000)], "bulk");
  assert.equal(e.designMin, 2_000_000);
  assert.equal(e.designMax, 2_000_000);
  assert.equal(e.productionMin, 4_000_000, "1,000부 = 첫 블록 400만");
  assert.equal(e.productionMax, 4_000_000, "정액이라 하한·상한이 같다");
  assert.equal(e.packagingCost, 0, "벌크는 포장비 없음");
  assert.equal(e.totalMin, 6_000_000);
  assert.equal(e.totalMax, 6_000_000);
});

test("제품 생산 — 생산비는 종마다 그 종의 수량으로 계산해 합산한다", () => {
  const one = estimateQuote("production", [line(1000)], "bulk");
  const two = estimateQuote("production", [line(1000), line(2000, "l2")], "bulk");
  assert.equal(two.designCount, 2);
  assert.equal(two.totalQuantity, 3000);
  assert.equal(two.designMin - one.designMin, 2_000_000, "라인 추가 = 디자인비 +200만(일반적)");
  assert.equal(
    two.productionMin - one.productionMin,
    6_500_000,
    "둘째 종 2,000부 = 자체 사다리로 650만"
  );
  assert.ok(two.totalMin > one.totalMin);
});

test("제품 생산 — 한 종의 수량이 늘면 그 종의 사다리를 따라 오른다", () => {
  const q1 = estimateQuote("production", [line(1000)], "bulk");
  const q2 = estimateQuote("production", [line(2000)], "bulk");
  const q3 = estimateQuote("production", [line(3000)], "bulk");
  assert.equal(q2.productionMin - q1.productionMin, 2_500_000, "둘째 1,000부 +250만");
  assert.equal(q3.productionMin - q2.productionMin, 2_000_000, "셋째 1,000부 +200만");
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
  // 디자인 200만(일반적) + 생산 400만 + 포장 50만(1,000×500)
  assert.equal(e.totalMin, 6_500_000);
  assert.equal(e.totalMax, 6_500_000);
});

test("제품 생산 — 수량 미입력은 따로 알린다 (생산비·포장비 계산용)", () => {
  const e = estimateQuote("production", [line("")], "bulk");
  assert.equal(e.quantityMissing, true);
  assert.equal(e.designMin, 2_000_000, "디자인비는 라인 수·난이도만으로 계산된다");
  assert.equal(e.productionMin, 0, "수량이 없으면 생산비를 아직 잡을 수 없다");
});

/* ── 설명서 생산 ── */

test("isManualOption — 정의된 값만 통과", () => {
  assert.equal(isManualOption("guide"), true);
  assert.equal(isManualOption("qr"), true);
  assert.equal(isManualOption("print"), true);
  assert.equal(isManualOption(""), false);
  assert.equal(isManualOption("etc"), false);
});

test("설명서 — 도면 내 가이드(guide)·미선택은 무료", () => {
  const base = estimateQuote("production", [line(1000)], "bulk");
  const guide = estimateQuote("production", [line(1000)], "bulk", { manual: "guide" });
  assert.equal(guide.manualCost, 0);
  assert.equal(guide.totalMin, base.totalMin);
});

test("설명서 — QR·영상 삽입은 종당 100만원", () => {
  assert.equal(MANUAL_QR_COST, 1_000_000);
  const one = estimateQuote("production", [line(1000)], "bulk", { manual: "qr" });
  const two = estimateQuote("production", [line(1000), line(1000, "l2")], "bulk", { manual: "qr" });
  assert.equal(one.manualCost, 1_000_000);
  assert.equal(two.manualCost, 2_000_000, "2종 × 100만");
  // 도면만 의뢰에서도 QR 삽입 가능 (도면 안에 들어간다)
  assert.equal(
    estimateQuote("blueprint", [line(0)], "", { manual: "qr" }).manualCost,
    1_000_000
  );
});

test("설명서 — 인쇄 설명서(print)는 부수당 300원", () => {
  assert.equal(MANUAL_PRINT_UNIT_COST, 300);
  const e = estimateQuote("production", [line(2000)], "bulk", { manual: "print" });
  assert.equal(e.manualCost, 600_000, "2,000부 × 300원");
  assert.equal(e.totalMin, 2_000_000 + 6_500_000 + 600_000);
});

test("설명서 비용은 하한·상한 양쪽에 더해진다", () => {
  const base = estimateQuote("production", [line(1000)], "bulk");
  const qr = estimateQuote("production", [line(1000)], "bulk", { manual: "qr" });
  assert.equal(qr.totalMin - base.totalMin, 1_000_000);
  assert.equal(qr.totalMax - base.totalMax, 1_000_000);
});

test("완제품 의뢰 — 설명서 개념이 없어 값이 남아 있어도 계산하지 않는다", () => {
  const e = estimateQuote("finished", [line(5)], "bulk", { manual: "qr" });
  assert.equal(e.manualCost, 0);
});

/* ── 완제품 의뢰 ── */

test("완제품 의뢰 — 제작비 하나로(300만~/종), 수량으로 곱하지 않는다", () => {
  const e = estimateQuote("finished", [line(5)], "bulk");
  assert.equal(e.costLabel, "제작비");
  assert.equal(e.designMin, 3_000_000);
  assert.equal(e.designMax, 10_000_000);
  assert.equal(e.productionMin, 0, "생산비를 따로 세지 않는다");
  assert.equal(e.productionMax, 0);
  assert.equal(e.totalMax, 10_000_000);
});

test("완제품 의뢰 — 종류가 늘면 제작비가 늘어난다", () => {
  const e = estimateQuote("finished", [line(1), line(1, "l2")], "bulk");
  assert.equal(e.designMax, 20_000_000, "2종 × 1,000만원");
});

test("완제품 의뢰 — 난이도를 쓰지 않는다 (hasComplexity=false)", () => {
  assert.equal(ORDER_TYPE_SPECS.finished.hasComplexity, false);
  const simple = estimateQuote("finished", [line(1, "l1", "simple")], "bulk");
  const complex = estimateQuote("finished", [line(1, "l1", "complex")], "bulk");
  assert.equal(simple.designMin, complex.designMin, "난이도 값이 남아 있어도 무시");
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

test("난이도 사용 여부 — 도면만·제품 생산만 (완제품은 제작비 일원화)", () => {
  assert.equal(ORDER_TYPE_SPECS.blueprint.hasComplexity, true);
  assert.equal(ORDER_TYPE_SPECS.production.hasComplexity, true);
  assert.equal(ORDER_TYPE_SPECS.finished.hasComplexity, false);
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

test("formatApprox — 예상 견적은 '약 N만원' 표기", () => {
  assert.equal(formatApprox(6_000_000), "약 600만원");
  assert.equal(formatApprox(500_000), "약 50만원");
});

test("formatFrom — 카드 안내용 시작 금액", () => {
  assert.equal(formatFrom(4_500_000), "450만원~");
  assert.equal(formatFrom(500_000), "50만원~");
});

/* ── B2B 제작 옵션 (샘플링·디자인 개선·감리) ── */

test("제작 옵션 정액 — 샘플링 100만 / 디자인 개선 200만 / 감리 100만", () => {
  assert.equal(SAMPLING_COST, 1_000_000);
  assert.equal(SAMPLING_IMPROVE_COST, 2_000_000);
  assert.equal(SUPERVISION_COST, 1_000_000);
});

test("제작 옵션은 하한·상한 양쪽에 정액으로 더해진다", () => {
  const base = estimateQuote("production", [line(1000)], "bulk");
  const all = estimateQuote("production", [line(1000)], "bulk", {
    sampling: true,
    samplingImprove: true,
    supervision: true,
  });
  assert.equal(all.samplingCost, 1_000_000);
  assert.equal(all.samplingImproveCost, 2_000_000);
  assert.equal(all.supervisionCost, 1_000_000);
  assert.equal(all.totalMin - base.totalMin, 4_000_000, "하한도 함께 오른다");
  assert.equal(all.totalMax - base.totalMax, 4_000_000);
});

test("옵션 미선택이면 정액 비용은 전부 0", () => {
  const e = estimateQuote("production", [line(1000)], "bulk");
  assert.equal(e.samplingCost, 0);
  assert.equal(e.samplingImproveCost, 0);
  assert.equal(e.supervisionCost, 0);
  assert.equal(e.manualCost, 0);
});

/* ── 납기 산식 ── */

test("기본 납기 — 도면만 2주 / 제품 생산 4주 / 완제품 4주", () => {
  assert.equal(estimateLeadWeeks("blueprint", ""), 2);
  assert.equal(estimateLeadWeeks("production", ""), 4);
  assert.equal(estimateLeadWeeks("finished", ""), 4);
});

test("포장 납기 — 종이박스 +2주 / OPP +1주 / 벌크 +0 (제품 생산에서만)", () => {
  assert.equal(estimateLeadWeeks("production", "paper-box"), 6);
  assert.equal(estimateLeadWeeks("production", "opp"), 5);
  assert.equal(estimateLeadWeeks("production", "bulk"), 4);
  // 도면만·완제품 의뢰는 포장 선택지가 없다 — 포장 값이 남아 있어도 무시
  assert.equal(estimateLeadWeeks("blueprint", "paper-box"), 2);
  assert.equal(estimateLeadWeeks("finished", "paper-box"), 4);
});

test("옵션 납기 — 샘플링 +2 / 디자인 개선 +2 / 감리 +1.5 / 별도 가공 +1", () => {
  assert.equal(estimateLeadWeeks("production", "bulk", { sampling: true }), 6);
  assert.equal(estimateLeadWeeks("production", "bulk", { samplingImprove: true }), 6);
  assert.equal(estimateLeadWeeks("production", "bulk", { supervision: true }), 5.5);
  assert.equal(estimateLeadWeeks("production", "bulk", { premiumFinish: true }), 5);
  // 전부 선택: 4 + 2(종이박스) + 2 + 2 + 1.5 + 1 = 12.5주
  assert.equal(
    estimateLeadWeeks("production", "paper-box", {
      sampling: true, samplingImprove: true, supervision: true, premiumFinish: true,
    }),
    12.5
  );
});

test("formatWeeks — 정수는 그대로, 소수는 한 자리로", () => {
  assert.equal(formatWeeks(4), "약 4주");
  assert.equal(formatWeeks(5.5), "약 5.5주");
  assert.equal(formatWeeks(12.5), "약 12.5주");
});

test("완제품 의뢰 — 포장 선택지가 없다 (hasPackaging=false)", () => {
  assert.equal(ORDER_TYPE_SPECS.finished.hasPackaging, false);
  // 포장 값이 남아 있어도 견적에 포장비가 붙지 않는다
  const e = estimateQuote("finished", [line(5)], "paper-box");
  assert.equal(e.packagingCost, 0);
});
