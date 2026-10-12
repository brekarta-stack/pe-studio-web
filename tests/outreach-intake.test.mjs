/**
 * 발굴 리드 인테이크 판정 테스트 (node --test)
 *   node --test tests/outreach-intake.test.mjs
 *
 * 실제 사고: 옛 발굴 에이전트가 slug 로 중복을 막아 제안서 109건이 기관 53곳에 몰렸다.
 * 기관(normalizeOrgKey) 단위로 create/merge 가 갈리는지, 제안서 링크가 최신 초안만 따라가는지 못 박는다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  validateLead,
  planIntake,
  summarizeActions,
  activityBodyForDraft,
} from "../src/lib/outreach-intake.ts";

/* ── validateLead ─────────────────────────────────────────── */

test("org 가 없거나 공백뿐이면 거절", () => {
  assert.equal(validateLead({}).ok, false);
  assert.equal(validateLead({ org: "   " }).ok, false);
  assert.equal(validateLead(null).ok, false);
  assert.equal(validateLead([]).ok, false);
  assert.equal(validateLead("소방청").ok, false);
});

test("문자열은 trim 되고 빈 문자열 필드는 빠진다", () => {
  const r = validateLead({ org: "  소방청 ", slug: " fire-mascot ", subject: "   ", phone: "" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lead, { org: "소방청", slug: "fire-mascot" });
});

test("문자열 필드에 숫자가 오면 거절", () => {
  assert.equal(validateLead({ org: "소방청", phone: 101 }).ok, false);
});

test("score 는 0..10 정수로, 범위 밖·숫자 아님은 null", () => {
  assert.equal(validateLead({ org: "a기관", score: 4.6 }).lead.score, 5);
  assert.equal(validateLead({ org: "a기관", score: "3" }).lead.score, 3);
  assert.equal(validateLead({ org: "a기관", score: 0 }).lead.score, 0);
  assert.equal(validateLead({ org: "a기관", score: 85 }).lead.score, null);
  assert.equal(validateLead({ org: "a기관", score: -1 }).lead.score, null);
  assert.equal(validateLead({ org: "a기관", score: "높음" }).lead.score, null);
  assert.equal(validateLead({ org: "a기관", score: null }).lead.score, null);
  assert.equal("score" in validateLead({ org: "a기관" }).lead, false);
});

test("stage 는 제안 영업 단계만 허용", () => {
  assert.equal(validateLead({ org: "a기관", stage: "sent" }).lead.stage, "sent");
  assert.equal(validateLead({ org: "a기관", stage: "consulting" }).ok, false);
  assert.equal(validateLead({ org: "a기관", stage: "nope" }).ok, false);
});

test("createdAt 은 날짜로 읽혀야 한다", () => {
  assert.equal(validateLead({ org: "a기관", createdAt: "2026-06-16" }).lead.createdAt, "2026-06-16");
  assert.equal(validateLead({ org: "a기관", createdAt: "어제" }).ok, false);
  assert.equal(validateLead({ org: "a기관", createdAt: 20260616 }).ok, false);
});

test("matchedCases 는 문자열 배열", () => {
  assert.deepEqual(validateLead({ org: "a기관", matchedCases: [" 경찰청 ", ""] }).lead.matchedCases, ["경찰청"]);
  assert.equal(validateLead({ org: "a기관", matchedCases: "경찰청" }).ok, false);
  assert.equal(validateLead({ org: "a기관", matchedCases: [1] }).ok, false);
});

/* ── planIntake ───────────────────────────────────────────── */

const ex = (o) => ({ id: "q1", orgKey: "", createdAt: "", proposalUrl: "", stage: "drafted", droppedAt: null, ...o });

test("같은 배치에서 표기가 다른 같은 기관 → 첫 건 create, 둘째 건 merge", () => {
  const actions = planIntake(
    [
      { org: "수원특례시청", createdAt: "2026-06-20", proposalUrl: "https://b" },
      { org: "수원특례시", createdAt: "2026-06-10", proposalUrl: "https://a" },
    ],
    []
  );
  assert.equal(actions.length, 2);
  assert.equal(actions[0].kind, "create");
  assert.equal(actions[0].lead.org, "수원특례시"); // 오래된 초안이 행이 된다
  assert.equal(actions[0].stage, "drafted");
  assert.equal(actions[1].kind, "merge");
  assert.equal(actions[1].existingId, ""); // 실행기가 삽입 후 채운다
  assert.equal(actions[1].orgKey, actions[0].orgKey);
  assert.equal(actions[1].updateProposal, true); // 더 새 초안
});

test("제안서 링크 없으면 sourced, 명시한 stage 가 우선", () => {
  const [a, b] = planIntake([{ org: "가나기관" }, { org: "다라기관", stage: "sent", proposalUrl: "https://x" }], []);
  assert.equal(a.stage, "sourced");
  assert.equal(b.stage, "sent");
});

test("Drop 된 기존 리드에도 merge 한다", () => {
  const [a] = planIntake(
    [{ org: "국립생태원(NIE)", createdAt: "2026-07-01" }],
    [ex({ id: "dropped1", orgKey: "국립생태원", createdAt: "2026-06-01", droppedAt: "2026-06-30" })]
  );
  assert.equal(a.kind, "merge");
  assert.equal(a.existingId, "dropped1");
  assert.equal(a.updateProposal, false); // 링크 없는 초안
});

test("같은 기관 행이 여럿이면 살아 있는 행에 붙인다", () => {
  const [a] = planIntake(
    [{ org: "소방청" }],
    [
      ex({ id: "old-live", orgKey: "소방청", createdAt: "2026-01-01" }),
      ex({ id: "new-dropped", orgKey: "소방청", createdAt: "2026-05-01", droppedAt: "2026-05-02" }),
    ]
  );
  assert.equal(a.existingId, "old-live");
});

test("updateProposal: 기존 링크가 없으면 날짜와 무관하게 채운다", () => {
  const [a] = planIntake(
    [{ org: "소방청", createdAt: "2026-01-01", proposalUrl: "https://new" }],
    [ex({ orgKey: "소방청", createdAt: "2026-06-01", proposalUrl: "" })]
  );
  assert.equal(a.updateProposal, true);
});

test("updateProposal: 기존 링크가 있으면 더 새(같거나 늦은) 초안만 덮는다", () => {
  const existing = [ex({ orgKey: "소방청", createdAt: "2026-06-01T00:00:00+00:00", proposalUrl: "https://old" })];
  assert.equal(planIntake([{ org: "소방청", createdAt: "2026-05-01", proposalUrl: "https://p" }], existing)[0].updateProposal, false);
  assert.equal(planIntake([{ org: "소방청", createdAt: "2026-06-01", proposalUrl: "https://p" }], existing)[0].updateProposal, true);
  assert.equal(planIntake([{ org: "소방청", createdAt: "2026-07-01", proposalUrl: "https://p" }], existing)[0].updateProposal, true);
  assert.equal(planIntake([{ org: "소방청", proposalUrl: "https://p" }], existing)[0].updateProposal, false); // 날짜 미상은 최신이라 보지 않는다
  assert.equal(planIntake([{ org: "소방청", createdAt: "2026-07-01" }], existing)[0].updateProposal, false); // 링크 없음
});

test("배치 안에서 링크 갱신이 이어진다 — 셋째 초안은 둘째 기준으로 비교", () => {
  const actions = planIntake(
    [
      { org: "소방청", createdAt: "2026-06-03", proposalUrl: "https://c" },
      { org: "소방청", createdAt: "2026-06-01", proposalUrl: "https://a" },
      { org: "소방청", createdAt: "2026-06-02" },
    ],
    []
  );
  assert.deepEqual(actions.map((a) => a.kind), ["create", "merge", "merge"]);
  assert.deepEqual(actions.map((a) => a.lead.createdAt), ["2026-06-01", "2026-06-02", "2026-06-03"]);
  assert.equal(actions[1].updateProposal, false);
  assert.equal(actions[2].updateProposal, true);
});

test("createdAt 오름차순 정렬, 날짜 없는 건 뒤로 · 같은 값은 입력 순서", () => {
  const actions = planIntake(
    [
      { org: "가기관" },
      { org: "나기관", createdAt: "2026-06-02" },
      { org: "다기관", createdAt: "2026-06-01" },
      { org: "라기관" },
      { org: "마기관", createdAt: "2026-06-01" },
    ],
    []
  );
  assert.deepEqual(actions.map((a) => a.lead.org), ["다기관", "마기관", "나기관", "가기관", "라기관"]);
});

test("정규화 키가 비면 skip", () => {
  const [a] = planIntake([{ org: "   " }], []);
  assert.equal(a.kind, "skip");
  assert.equal(a.reason, "기관명을 정규화할 수 없음");
});

test("summarizeActions", () => {
  const actions = planIntake(
    [{ org: "소방청" }, { org: "소방청" }, { org: "경찰청" }, { org: " " }],
    [ex({ id: "p", orgKey: "경찰청" })]
  );
  assert.deepEqual(summarizeActions(actions), { created: 1, merged: 2, skipped: 1 });
});

/* ── activityBodyForDraft ─────────────────────────────────── */

test("activityBodyForDraft", () => {
  assert.equal(
    activityBodyForDraft({ org: "빙그레", createdAt: "2026-06-16", slug: "binggrae", proposalUrl: "https://docs.google.com/x" }),
    "제안 초안 2026-06-16 · binggrae · https://docs.google.com/x"
  );
  assert.equal(activityBodyForDraft({ org: "빙그레" }), "제안 초안 날짜 미상");
  // UTC 저녁 = 한국 다음 날
  assert.equal(activityBodyForDraft({ org: "빙그레", createdAt: "2026-06-16T20:00:00Z", subject: "제목" }), "제안 초안 2026-06-17 · 제목");
});
