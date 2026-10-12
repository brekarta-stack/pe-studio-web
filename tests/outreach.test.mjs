/**
 * 제안 영업 보드 순수 헬퍼 테스트 (node --test)
 *   node --test tests/outreach.test.mjs
 *
 * 보드의 정렬·D-day 표시가 날짜 경계에서 하루씩 밀리면 "팔로업 지연"이 엉뚱한 건에 붙는다.
 * 로컬 자정 기준 비교와 정렬 순서를 못 박는다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  dueState,
  defaultFollowupDate,
  sortOutreach,
  isMissingColumnError,
  OUTREACH_FILTERS,
  OUTREACH_FILTER_LABELS,
  SALES_PATHS,
  localDate,
} from "../src/lib/outreach.ts";

// 로컬 시각 2026-10-13 23:30 — 자정 직전에도 "오늘"이 오늘이어야 한다
const TODAY = new Date(2026, 9, 13, 23, 30);

test("dueState — 날짜 경계", () => {
  assert.equal(dueState(null, TODAY), "none");
  assert.equal(dueState("", TODAY), "none");
  assert.equal(dueState("엉뚱한값", TODAY), "none");
  assert.equal(dueState("2026-10-12", TODAY), "overdue");
  assert.equal(dueState("2026-10-13", TODAY), "today");
  assert.equal(dueState("2026-10-14", TODAY), "upcoming");
  assert.equal(dueState("2025-01-01", TODAY), "overdue");
});

test("dueState — 타임스탬프가 와도 날짜 부분만 본다", () => {
  assert.equal(dueState("2026-10-13T00:00:00+00:00", TODAY), "today");
  assert.equal(dueState("2026-10-12T23:59:59Z", TODAY), "overdue");
});

test("dueState — 자정 직후에도 같은 날짜는 today", () => {
  const earlyMorning = new Date(2026, 9, 13, 0, 1);
  assert.equal(dueState("2026-10-13", earlyMorning), "today");
  assert.equal(dueState("2026-10-12", earlyMorning), "overdue");
});

test("defaultFollowupDate — 기본 7일, 월·연 넘김", () => {
  assert.equal(defaultFollowupDate(new Date(2026, 9, 13, 23, 59)), "2026-10-20");
  assert.equal(defaultFollowupDate(new Date(2026, 9, 28, 9, 0)), "2026-11-04");
  assert.equal(defaultFollowupDate(new Date(2026, 11, 30, 9, 0), 3), "2027-01-02");
  assert.equal(defaultFollowupDate(new Date(2026, 9, 13), 0), "2026-10-13");
});

test("defaultFollowupDate — ISO 문자열은 로컬 날짜로 해석", () => {
  const iso = new Date(2026, 9, 13, 8, 0).toISOString();
  assert.equal(defaultFollowupDate(iso), "2026-10-20");
});

test("localDate — 0 채움", () => {
  assert.equal(localDate(new Date(2026, 0, 5)), "2026-01-05");
});

test("sortOutreach — 지연(오래된 순) → 오늘 → 예정(가까운 순) → 미지정(최근 등록 순)", () => {
  const rows = [
    { id: "none-old", nextActionAt: null, createdAt: "2026-09-01T00:00:00Z" },
    { id: "up-far", nextActionAt: "2026-11-01", createdAt: "2026-09-01T00:00:00Z" },
    { id: "over-recent", nextActionAt: "2026-10-12", createdAt: "2026-09-01T00:00:00Z" },
    { id: "today", nextActionAt: "2026-10-13", createdAt: "2026-09-01T00:00:00Z" },
    { id: "none-new", nextActionAt: null, createdAt: "2026-10-10T00:00:00Z" },
    { id: "over-old", nextActionAt: "2026-10-01", createdAt: "2026-09-01T00:00:00Z" },
    { id: "up-near", nextActionAt: "2026-10-15", createdAt: "2026-09-01T00:00:00Z" },
  ];
  const ids = sortOutreach(rows, TODAY).map((r) => r.id);
  assert.deepEqual(ids, ["over-old", "over-recent", "today", "up-near", "up-far", "none-new", "none-old"]);
});

test("sortOutreach — 같은 날짜면 원래 순서 유지, 원본 배열은 건드리지 않는다", () => {
  const rows = [
    { id: "a", nextActionAt: "2026-10-20", createdAt: "2026-09-01T00:00:00Z" },
    { id: "b", nextActionAt: "2026-10-20", createdAt: "2026-10-01T00:00:00Z" },
    { id: "c", nextActionAt: "2026-10-20", createdAt: "2026-08-01T00:00:00Z" },
  ];
  const before = rows.map((r) => r.id);
  assert.deepEqual(sortOutreach(rows, TODAY).map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(rows.map((r) => r.id), before);
});

test("OUTREACH_FILTERS — 전체·지연 + 아웃바운드 4단계, 라벨 빠짐 없음", () => {
  assert.deepEqual([...OUTREACH_FILTERS], ["all", "overdue", "sourced", "drafted", "sent", "followup"]);
  assert.deepEqual(
    OUTREACH_FILTERS.map((f) => OUTREACH_FILTER_LABELS[f]),
    ["전체", "팔로업 지연", "발굴", "제안서 준비", "제안 발송", "팔로업"]
  );
});

test("SALES_PATHS — 단계 이동이 닿는 화면 전부", () => {
  for (const p of ["/admin", "/admin/quotes", "/admin/outreach", "/admin/completed", "/admin/settlements", "/admin/drops", "/admin/works"]) {
    assert.ok(SALES_PATHS.includes(p), p);
  }
});

test("isMissingColumnError — 마이그레이션 전 신호만 참", () => {
  assert.equal(isMissingColumnError({ code: "42703", message: "column quotes.org does not exist" }), true);
  assert.equal(isMissingColumnError({ code: "PGRST204", message: "Could not find the 'org' column" }), true);
  assert.equal(isMissingColumnError({ message: "column \"lost_reason\" does not exist" }), true);
  assert.equal(isMissingColumnError({ message: "Could not find the 'x' column of 'quotes' in the schema cache" }), true);
  assert.equal(isMissingColumnError({ code: "23505", message: "duplicate key value" }), false);
  assert.equal(isMissingColumnError(new Error("fetch failed")), false);
  assert.equal(isMissingColumnError(null), false);
  assert.equal(isMissingColumnError("does not exist"), false);
});
