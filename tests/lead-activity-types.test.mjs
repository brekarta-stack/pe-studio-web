/**
 * 기관명 정규화 · 180일 중복 제안 경고 테스트 (node --test)
 *   node --test tests/lead-activity-types.test.mjs
 *
 * 실제 사고: 같은 국립생태원에 캠페인 slug 만 다른 제안이 두 번 나갔다.
 * 표기 흔들림(괄호·공백·시/시청)이 하나의 키로 접히는지, 경계일이 맞는지 못 박는다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOrgKey,
  isRecentlyProposed,
  isActivityKind,
  ACTIVITY_KINDS,
  ACTIVITY_KIND_LABELS,
} from "../src/lib/lead-activity-types.ts";

function sameKey(names) {
  const keys = names.map(normalizeOrgKey);
  assert.equal(new Set(keys).size, 1, `${names.join(" / ")} → ${keys.join(" / ")}`);
  return keys[0];
}

test("국립생태원 표기 흔들림이 한 키로 접힌다", () => {
  const k = sameKey(["국립생태원", "국립생태원(NIE)", "국립 생태원", "국립생태원 (NIE)", "국립생태원（NIE）"]);
  assert.equal(k, "국립생태원");
});

test("수원특례시청 / 수원특례시 / 수원시청 / 수원시 가 한 키로 접힌다", () => {
  assert.equal(sameKey(["수원특례시청", "수원특례시", "수원시청", "수원시", "수원 시청"]), "수원");
});

test("법인격 접두어·영문 접미어가 떨어진다", () => {
  sameKey(["(주)페이퍼크래프트", "주식회사 페이퍼크래프트", "페이퍼크래프트"]);
  sameKey(["Samsung Co., Ltd.", "samsung", "SAMSUNG Inc."]);
  assert.equal(normalizeOrgKey("Tesco"), "tesco", "단어 안의 co 는 지우지 않는다");
});

test("접미어를 떼서 2자 미만이 되면 떼지 않는다", () => {
  assert.equal(normalizeOrgKey("대구"), "대구", "'구' 를 떼면 '대' 한 글자");
  assert.equal(normalizeOrgKey("대구시"), "대구");
  assert.equal(normalizeOrgKey("서구청"), "서구청");
});

test("비어 있지 않은 입력은 절대 빈 키가 되지 않는다", () => {
  for (const s of ["(주)", "시", "구청", "Co., Ltd.", "!!!", "재단", "(NIE)"]) {
    assert.ok(normalizeOrgKey(s).length > 0, s);
  }
  assert.equal(normalizeOrgKey(""), "");
  assert.equal(normalizeOrgKey("   "), "");
});

const TODAY = new Date(2026, 9, 13, 15, 30); // 2026-10-13 15:30 로컬

/** 로컬 날짜 n 일 전의 ISO */
function daysAgo(n, hour = 10) {
  return new Date(2026, 9, 13 - n, hour).toISOString();
}

test("isRecentlyProposed — 정확히 180일 전은 포함, 181일 전은 제외", () => {
  const at180 = [{ orgKey: "수원", createdAt: daysAgo(180), proposalSentAt: null }];
  const at181 = [{ orgKey: "수원", createdAt: daysAgo(181), proposalSentAt: null }];
  assert.equal(isRecentlyProposed(at180, "수원", 180, TODAY).hit, true);
  assert.equal(isRecentlyProposed(at180, "수원", 180, TODAY).daysAgo, 180);
  assert.equal(isRecentlyProposed(at181, "수원", 180, TODAY).hit, false);
  // 시각이 기준일보다 늦어도(23시) 경계가 하루 밀리지 않는다
  const late = [{ orgKey: "수원", createdAt: daysAgo(180, 23), proposalSentAt: null }];
  assert.equal(isRecentlyProposed(late, "수원", 180, TODAY).hit, true);
});

test("isRecentlyProposed — 발송 시각이 있으면 등록일보다 우선한다", () => {
  // 등록은 1년 전이지만 발송은 10일 전 → 최근 제안
  const rec = { orgKey: "수원", createdAt: daysAgo(365), proposalSentAt: daysAgo(10) };
  const r = isRecentlyProposed([rec], "수원", 180, TODAY);
  assert.equal(r.hit, true);
  assert.equal(r.match, rec);
  assert.equal(r.daysAgo, 10);
  // 반대로 등록은 최근이어도 발송이 200일 전이면 발송 기준으로 판정
  const old = { orgKey: "수원", createdAt: daysAgo(5), proposalSentAt: daysAgo(200) };
  assert.equal(isRecentlyProposed([old], "수원", 180, TODAY).hit, false);
});

test("isRecentlyProposed — 가장 최근 건을 돌려주고, 다른 기관·빈 키는 무시한다", () => {
  const a = { orgKey: "수원", createdAt: daysAgo(90), proposalSentAt: null };
  const b = { orgKey: "수원", createdAt: daysAgo(30), proposalSentAt: null };
  const other = { orgKey: "국립생태원", createdAt: daysAgo(1), proposalSentAt: null };
  assert.equal(isRecentlyProposed([a, other, b], "수원", 180, TODAY).match, b);
  assert.equal(isRecentlyProposed([other], "수원", 180, TODAY).hit, false);
  const blank = { orgKey: "", createdAt: daysAgo(1), proposalSentAt: null };
  assert.equal(isRecentlyProposed([blank], "", 180, TODAY).hit, false, "빈 키끼리 중복 판정 금지");
});

test("활동 종류 레지스트리 — 라벨이 모두 있고 가드가 맞다", () => {
  for (const k of ACTIVITY_KINDS) {
    assert.ok(ACTIVITY_KIND_LABELS[k], k);
    assert.ok(isActivityKind(k), k);
  }
  assert.equal(ACTIVITY_KIND_LABELS.proposal_sent, "제안서 발송");
  assert.equal(isActivityKind("delete"), false);
});
