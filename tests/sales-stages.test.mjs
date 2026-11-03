/**
 * 영업 파이프라인 단계 그룹 테스트 (node --test)
 *   node --test tests/sales-stages.test.mjs
 *
 * 화면 셋(제안 영업·제작 문의·완료)이 같은 quotes 표를 겹치지 않게 나눠 보여 주는 근거가
 * 이 그룹 배열이다. 단계가 어느 그룹에도 안 들어가거나 둘에 들어가면 리드가 화면에서
 * 사라지거나 두 번 보인다 — 눈으로는 잘 안 잡히는 조용한 실패라 여기서 못 박는다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  QUOTE_STAGES,
  OUTREACH_STAGES,
  ACTIVE_STAGES,
  DONE_STAGES,
  STAGE_LABELS,
  STAGE_COLORS,
  STAGE_GROUP_LABELS,
  stageGroup,
  isQuoteStage,
  isOutreachStage,
  isActiveStage,
  isDoneStage,
} from "../src/lib/assignment-types.ts";

test("세 그룹이 QUOTE_STAGES 를 빠짐없이, 겹치지 않게 나눈다", () => {
  const union = [...OUTREACH_STAGES, ...ACTIVE_STAGES, ...DONE_STAGES];
  assert.deepEqual([...QUOTE_STAGES], union, "순서까지 그룹을 이어 붙인 것과 같다");
  assert.equal(new Set(union).size, union.length, "중복 단계 없음");
});

test("기존 7단계가 그대로 남아 있다 — 옛 데이터가 'new' 로 떨어지지 않게", () => {
  for (const s of ["new", "consulting", "quoted", "contracted", "producing", "delivered", "settled"]) {
    assert.ok(isQuoteStage(s), s);
  }
  for (const s of ["sourced", "drafted", "sent", "followup"]) assert.ok(isQuoteStage(s), s);
  assert.equal(isQuoteStage("on_hold"), false, "제거된 단계");
  assert.equal(isQuoteStage(undefined), false);
});

test("라벨·색이 모든 단계를 덮는다", () => {
  for (const s of QUOTE_STAGES) {
    assert.ok(STAGE_LABELS[s], `라벨 누락: ${s}`);
    assert.match(STAGE_COLORS[s], /^bg-\w+-\d+ text-\w+-\d+ border-\w+-\d+$/, `색 누락: ${s}`);
  }
  assert.equal(STAGE_LABELS.sourced, "발굴");
  assert.equal(STAGE_LABELS.drafted, "제안서 준비");
  assert.equal(STAGE_LABELS.sent, "제안 발송");
  assert.equal(STAGE_LABELS.followup, "팔로업");
});

test("stageGroup — 단계가 속한 그룹", () => {
  assert.equal(stageGroup("sourced"), "outreach");
  assert.equal(stageGroup("followup"), "outreach");
  assert.equal(stageGroup("new"), "active");
  assert.equal(stageGroup("producing"), "active");
  assert.equal(stageGroup("delivered"), "done");
  assert.equal(stageGroup("settled"), "done");
  for (const s of QUOTE_STAGES) assert.ok(STAGE_GROUP_LABELS[stageGroup(s)], s);
});

test("그룹 가드는 정확히 한 그룹에서만 참이다", () => {
  for (const s of QUOTE_STAGES) {
    const hits = [isOutreachStage(s), isActiveStage(s), isDoneStage(s)].filter(Boolean).length;
    assert.equal(hits, 1, s);
  }
  for (const g of [isOutreachStage, isActiveStage, isDoneStage]) {
    assert.equal(g("garbage"), false);
    assert.equal(g(null), false);
  }
});
