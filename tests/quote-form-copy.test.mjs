/**
 * 제작 문의 폼 카피(문구) 규칙 테스트 (node --test)
 *   node --test tests/quote-form-copy.test.mjs
 *
 * 고객에게 그대로 보이는 설명 문구라 어미·마침표가 흐트러지면 바로 눈에 띈다.
 *   - 설명 문구는 존댓말(…다.)로 끝나고 마침표를 찍는다
 *   - 만드는 방식의 추천 옵션은 "전문가 추천" (구 라벨 "PE 스튜디오 추천대로 작업" 금지)
 *   - 완제품 의뢰에서는 제품 이용 연령·만드는 방식 섹션을 숨긴다
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { ORDER_TYPE_SPECS, ORDER_TYPES } from "../src/lib/quote-pricing.ts";

const SRC = new URL("../src/components/QuoteForm.tsx", import.meta.url);

test("주문 형태 설명 — 존댓말 종결 + 마침표", () => {
  for (const t of ORDER_TYPES) {
    assert.match(ORDER_TYPE_SPECS[t].desc, /다\.$/, `${t} desc: ${ORDER_TYPE_SPECS[t].desc}`);
  }
});

test("만드는 방식 — '전문가 추천' 라벨과 설명 문구", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes('value: "전문가 추천"'), "전문가 추천 옵션이 있어야 한다");
  assert.ok(
    src.includes("PE 스튜디오가 추천해주는 방식대로 만듭니다."),
    "전문가 추천 설명 문구가 있어야 한다"
  );
  assert.ok(!src.includes("PE 스튜디오 추천대로 작업"), "구 라벨이 남아 있으면 안 된다");
});

test("완제품 의뢰 — 이용 연령·만드는 방식 숨김 + 값 정리", async () => {
  const src = await readFile(SRC, "utf8");
  // 두 섹션 모두 finished 가드로 감싼다 (연령 1 + 만드는 방식 1)
  const guards = src.match(/form\.orderType !== "finished" &&/g) ?? [];
  assert.ok(guards.length >= 2, `finished 가드가 2곳 이상이어야 한다 (현재 ${guards.length})`);
  // 완제품으로 전환하면 숨긴 값이 접수되지 않게 비운다
  assert.ok(src.includes('ageGroups: next === "finished" ? [] : prev.ageGroups'));
  assert.ok(src.includes('assemblyMethod: next === "finished" ? "" : prev.assemblyMethod'));
});

test("모델 설계 난이도 — 붉은 안내 문구 + 라인별 선택지", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(
    src.includes("설계 난이도는 PE 스튜디오가 조정할 수 있으니 편하게 선택하셔도 괜찮습니다."),
    "난이도 안내 문구가 있어야 한다"
  );
  assert.ok(src.includes("text-rose-700"), "안내 문구는 붉은색이어야 한다");
  assert.ok(src.includes("설계 난이도"), "라인별 난이도 선택지 라벨이 있어야 한다");
});

test("설명서 생산 — 섹션 존재 + 주문 형태 전환 시 값 정리", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("설명서 생산"), "설명서 생산 섹션이 있어야 한다");
  // 완제품 의뢰로 바꾸면 설명서 값이 접수되지 않게 비운다
  assert.match(src, /manualOption:\s*\n?\s*next === "finished" \? ""/);
  // 인쇄 설명서(부수당)는 수량이 있는 주문에서만 노출
  assert.ok(src.includes('m !== "print" || orderSpec.hasQuantity'));
});

test("예상 견적 — VAT 별도 안내가 있다", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("VAT 별도"), "견적 금액 옆에 VAT 별도 표기가 있어야 한다");
  assert.ok(src.includes("임의로 산정된 금액(VAT 별도)"), "하단 고지에도 VAT 별도가 있어야 한다");
});

test("설명 문구(desc) — 마침표 누락 없음", async () => {
  const src = await readFile(SRC, "utf8");
  // PRODUCTS·USAGES·STYLE_OPTIONS·ASSEMBLY_OPTIONS 의 desc 리터럴을 전부 걷어 검사
  const descs = [...src.matchAll(/desc: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(descs.length >= 13, `desc 리터럴이 13개 이상이어야 한다 (현재 ${descs.length})`);
  for (const d of descs) {
    assert.match(d, /다\.$/, `마침표·존댓말 종결이 아니다: ${d}`);
  }
});
