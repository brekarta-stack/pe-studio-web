/**
 * 제안서 AI 작성을 맥 작업자로 옮긴 부분의 테스트 (node --test) — DB·네트워크 없음.
 *   node --test tests/proposal-jobs.test.mjs
 *
 * 못 박는 것: 작업자 원고 후처리(출처는 http(s) 만 남기되 허용 목록은 보지 않음, 수신 메일은 리드 메일,
 * 분량·견적 빈칸·추천 하나·이미지 비움), 작업 상태 규칙(오래된 running 처리, 자동 적용 조건, 오류 자르기).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { finalizeDraft, postProcessWorkerContent } from "../src/lib/proposal-book/generate.ts";
import { bookContentSchema, checkLimits, emptyContent, LIMITS, TBD } from "../src/lib/proposal-book/schema.ts";
import {
  GEN_MAX_ATTEMPTS,
  GEN_STALE_MS,
  clipGenError,
  isGenActive,
  isGenMode,
  normalizeGenStatus,
  shouldAutoApply,
  staleDecision,
} from "../src/lib/proposal-book/jobs.ts";

const lead = {
  org: "통영시",
  name: "관광과",
  email: "tour@tongyeong.go.kr",
  segment: "지자체",
  notes: "",
  outreach: { body_text: "통영시는 케이블카를 운영합니다." },
};

/** 작업자가 보낸 원고 — 저장 모양(specs 튜플·이미지 칸 포함)으로 온다고 본다 */
function workerContent() {
  const c = structuredClone(emptyContent("통영시"));
  c.title = "케이블카를 손으로 세워 가져가는 기념품";
  c.contact = { dept: "관광과", email: "someone-else@example.com" };
  c.observation.body = ["통영시는 공모전을 열었습니다.[^1]", "케이블카 이용객은 연 100만 명입니다.[^2]"];
  c.observation.sources = [
    { label: "공모전 공고", url: "https://www.tongyeong.go.kr/notice/1" },
    { label: "통계 기사", url: "http://news.example.com/a?b=1" },
    { label: "악성", url: "javascript:alert(1)" },
    { label: "상대 경로", url: "/notice/2" },
    { label: "공백 낀 주소", url: "https://a.example.com/x y" },
  ];
  c.cover = "https://evil.example.com/cover.png";
  c.designs.items[0].image = { url: "https://evil.example.com/a.png", fit: "cover", zoom: 1, x: 50, y: 50 };
  c.designs.items[0].key = "Z";
  c.pricing.tiers = [
    { qty: "2,000개", desc: "1,000부 × 2종", total: "500만 원", unit: "2,500원", pick: true },
    { qty: "4,000개", desc: "2,000부 × 2종", total: "800만 원", unit: "2,000원", pick: true },
    { qty: "8,000개", desc: "4,000부 × 2종", total: "1,200만 원", unit: "1,500원" },
    { qty: "16,000개", desc: "8,000부 × 2종", total: "2,000만 원", unit: "1,250원" },
  ];
  c.glance.headline = "가".repeat(60);
  return c;
}

test("postProcessWorkerContent: https·http 출처는 남기고(허용 목록 무관) javascript:·상대 경로·공백 주소는 버린다", () => {
  const c = postProcessWorkerContent(workerContent(), lead);
  assert.deepEqual(c.observation.sources, [
    { label: "공모전 공고", url: "https://www.tongyeong.go.kr/notice/1" },
    { label: "통계 기사", url: "http://news.example.com/a?b=1" },
  ]);
  // 같은 원고를 Vercel 경로(finalizeDraft)로 돌리면 자료에 없는 링크라 다 빠진다 — 두 정책이 갈리는지 확인
  const v = finalizeDraft(workerContent(), lead);
  assert.deepEqual(v.observation.sources, [{ label: TBD("출처"), url: "" }]);
});

test("postProcessWorkerContent: 수신 메일은 리드 메일로 고정, 리드 메일이 없으면 빈칸", () => {
  assert.equal(postProcessWorkerContent(workerContent(), lead).contact.email, "tour@tongyeong.go.kr");
  assert.equal(postProcessWorkerContent(workerContent(), { ...lead, email: "" }).contact.email, "");
  assert.equal(postProcessWorkerContent(workerContent(), lead).contact.dept, "관광과");
});

test("postProcessWorkerContent: 분량 한도·견적 빈칸·추천 하나·시안 키·이미지 비움", () => {
  const c = postProcessWorkerContent(workerContent(), lead);
  assert.equal(bookContentSchema.safeParse(c).success, true);
  assert.deepEqual(checkLimits(c), []);
  assert.equal(c.pricing.tiers.length, 3);
  assert.equal(c.pricing.tiers.filter((t) => t.pick).length, 1);
  assert.ok(c.pricing.tiers.every((t) => t.total === TBD("단가") && t.unit === TBD("단가")));
  assert.deepEqual(c.designs.items.map((d) => d.key), ["A", "B", "C"]);
  assert.equal(c.cover, "");
  assert.ok(c.designs.items.every((d) => d.image === ""));
  assert.ok([...c.glance.headline].length <= LIMITS.chars.headline);
  assert.equal(c.org, "통영시");
});

test("postProcessWorkerContent: 출처가 모두 버려지면 [확인 필요: 출처] 하나, 형식이 깨지면 던진다", () => {
  const w = workerContent();
  w.observation.sources = [{ label: "x", url: "ftp://a.example.com" }];
  assert.deepEqual(postProcessWorkerContent(w, lead).observation.sources, [{ label: TBD("출처"), url: "" }]);
  assert.throws(() => postProcessWorkerContent("not an object", lead), /AI 응답/);
  assert.throws(() => postProcessWorkerContent(null, lead));
});

test("작업 상태: 모르는 값·마이그레이션 전은 idle, 살아 있는 상태는 requested·running", () => {
  assert.equal(normalizeGenStatus(undefined), "idle");
  assert.equal(normalizeGenStatus("weird"), "idle");
  assert.equal(normalizeGenStatus("running"), "running");
  assert.equal(isGenActive("requested"), true);
  assert.equal(isGenActive("running"), true);
  assert.equal(isGenActive("done"), false);
  assert.equal(isGenActive("failed"), false);
  assert.equal(isGenMode("create"), true);
  assert.equal(isGenMode("regenerate"), true);
  assert.equal(isGenMode("delete"), false);
});

test("staleDecision: 20분 안이면 기다림, 넘으면 시도 2회 전까지 다시 줄 세움, 그 뒤 실패", () => {
  const now = Date.parse("2026-10-16T10:00:00Z");
  const fresh = new Date(now - 5 * 60 * 1000).toISOString();
  const old = new Date(now - GEN_STALE_MS - 1000).toISOString();
  assert.equal(staleDecision({ startedAt: fresh, attempts: 1 }, now), null);
  assert.equal(staleDecision({ startedAt: old, attempts: 1 }, now), "requeue");
  assert.equal(staleDecision({ startedAt: old, attempts: GEN_MAX_ATTEMPTS }, now), "fail");
  assert.equal(staleDecision({ startedAt: null, attempts: 0 }, now), "requeue", "시작 시각이 없으면 오래된 것으로");
  assert.equal(staleDecision({ startedAt: "garbage", attempts: 5 }, now), "fail");
});

test("shouldAutoApply: create 이고 요청 이후 rev 가 그대로일 때만", () => {
  assert.equal(shouldAutoApply({ mode: "create", rev: 3, requestedRev: 3 }), true);
  assert.equal(shouldAutoApply({ mode: "create", rev: 4, requestedRev: 3 }), false);
  assert.equal(shouldAutoApply({ mode: "regenerate", rev: 3, requestedRev: 3 }), false);
  assert.equal(shouldAutoApply({ mode: "create", rev: 0, requestedRev: null }), false);
  assert.equal(shouldAutoApply({ mode: null, rev: 0, requestedRev: 0 }), false);
});

test("clipGenError: 줄바꿈을 걷고 300자로, 비면 기본 문구", () => {
  assert.equal(clipGenError("a\n\n b"), "a b");
  assert.equal(clipGenError(new Error("boom")), "boom");
  assert.equal(clipGenError(""), "알 수 없는 오류");
  assert.equal(clipGenError(undefined), "알 수 없는 오류");
  const long = clipGenError("x".repeat(500));
  assert.equal(long.length, 300);
  assert.ok(long.endsWith("…"));
});
