/**
 * 제안서 편집기 순수 로직 테스트 (node --test)
 *   node --test tests/proposal-editor.test.mjs
 *
 * 되돌리기 기록·목록 한도·덮어쓰기 인덱스 따라가기·쪽 순서·빈칸 순서·넘침 판정·이미지 값.
 * 여기서 틀리면 편집기에서 한도를 넘는 원고가 저장되거나, 항목을 지운 뒤 크기 덮어쓰기가
 * 엉뚱한 항목에 붙거나, 표지가 중간으로 밀린다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { DEFAULT_STYLE, conformContent, emptyContent, normalizePages } from "../src/lib/proposal-book/schema.ts";
import { listTbd } from "../src/lib/proposal-book/markup.ts";
import {
  HISTORY_CAP,
  addItem,
  canAdd,
  canMovePage,
  canRemove,
  carryImages,
  caseKey,
  dragFocal,
  fontRoleOfPath,
  hasImage,
  historyReducer,
  initHistory,
  isOverflowing,
  itemLabel,
  limitLabel,
  listDefOf,
  listsOfPath,
  moveItem,
  movePage,
  orderedTbd,
  patchImage,
  remapOverrides,
  removeItem,
  setOverride,
  setPick,
  tbdCountByPage,
  togglePage,
  topListsOfPage,
} from "../src/lib/proposal-book/editor-ops.ts";

const sample = JSON.parse(readFileSync(new URL("./fixtures/proposal-sample.json", import.meta.url), "utf8"));
const content = conformContent(sample, emptyContent(sample.org));
const snap = (c = content, style = DEFAULT_STYLE, pages = normalizePages([])) => ({ content: c, style, pages });

/* ── 되돌리기 ── */

test("history: commit → undo → redo", () => {
  const a = snap();
  const b = snap({ ...content, org: "B" });
  let h = initHistory(a);
  h = historyReducer(h, { type: "commit", snap: b });
  assert.equal(h.present, b);
  assert.equal(h.past.length, 1);
  h = historyReducer(h, { type: "undo" });
  assert.equal(h.present, a);
  assert.equal(h.future.length, 1);
  h = historyReducer(h, { type: "redo" });
  assert.equal(h.present, b);
  // 비어 있으면 아무 일도 없다
  assert.equal(historyReducer(initHistory(a), { type: "undo" }).present, a);
});

test("history: 새 변경은 다시하기 기록을 지운다", () => {
  let h = initHistory(snap());
  h = historyReducer(h, { type: "commit", snap: snap({ ...content, org: "1" }) });
  h = historyReducer(h, { type: "undo" });
  h = historyReducer(h, { type: "commit", snap: snap({ ...content, org: "2" }) });
  assert.equal(h.future.length, 0);
});

test("history: 같은 key 가 짧은 간격으로 이어지면 한 칸으로 묶는다", () => {
  let h = initHistory(snap());
  h = historyReducer(h, { type: "commit", snap: snap({ ...content, org: "1" }), key: "zoom", at: 1000 });
  h = historyReducer(h, { type: "commit", snap: snap({ ...content, org: "2" }), key: "zoom", at: 1200 });
  h = historyReducer(h, { type: "commit", snap: snap({ ...content, org: "3" }), key: "zoom", at: 1500 });
  assert.equal(h.past.length, 1);
  assert.equal(h.present.content.org, "3");
  // 간격이 벌어지면 새 칸
  h = historyReducer(h, { type: "commit", snap: snap({ ...content, org: "4" }), key: "zoom", at: 5000 });
  assert.equal(h.past.length, 2);
  // 다른 key 도 새 칸
  h = historyReducer(h, { type: "commit", snap: snap({ ...content, org: "5" }), key: "x", at: 5100 });
  assert.equal(h.past.length, 3);
});

test("history: 100칸을 넘으면 오래된 것부터 버린다", () => {
  let h = initHistory(snap());
  for (let i = 0; i < HISTORY_CAP + 20; i++) {
    h = historyReducer(h, { type: "commit", snap: snap({ ...content, org: String(i) }) });
  }
  assert.equal(h.past.length, HISTORY_CAP);
  assert.equal(h.past[0].content.org, "19");
});

test("history: apply 는 최신 판 위에서 계산하고 null 이면 무시한다", () => {
  let h = initHistory(snap());
  h = historyReducer(h, { type: "commit", snap: snap({ ...content, org: "A" }) });
  h = historyReducer(h, { type: "apply", fn: (s) => ({ ...s, content: { ...s.content, title: s.content.org + "!" } }) });
  assert.equal(h.present.content.title, "A!");
  assert.equal(h.past.length, 2);
  assert.equal(historyReducer(h, { type: "apply", fn: () => null }), h);
});

test("history: 같은 스냅샷 commit 은 기록하지 않는다", () => {
  const a = snap();
  const h = initHistory(a);
  assert.equal(historyReducer(h, { type: "commit", snap: a }), h);
});

/* ── 목록 ── */

test("listsOfPath: 바깥 목록부터, 목록이 아닌 경로는 빈 배열", () => {
  const hits = listsOfPath("offer.lines.1.body.0");
  assert.deepEqual(
    hits.map((h) => [h.listPath, h.index]),
    [
      ["offer.lines", 1],
      ["offer.lines.1.body", 0],
    ]
  );
  assert.deepEqual(listsOfPath("glance.headline"), []);
  assert.deepEqual(listsOfPath("glance.specs.2.1").map((h) => h.listPath), ["glance.specs"]);
  assert.deepEqual(listsOfPath("pricing.tiers.0.qty").map((h) => h.listPath), ["pricing.tiers"]);
});

test("addItem: 한도까지만, 새 항목 모양이 맞다", () => {
  const s = snap();
  const n = s.content.offer.lines.length;
  const max = listDefOf("offer.lines").max;
  let cur = s;
  for (let i = n; i < max; i++) cur = addItem(cur, "offer.lines");
  assert.equal(cur.content.offer.lines.length, max);
  assert.equal(addItem(cur, "offer.lines"), null);
  assert.equal(canAdd(cur.content, "offer.lines"), false);
  const added = cur.content.offer.lines[max - 1];
  if (n < max) assert.deepEqual(added, { use: "", name: "새 라인", body: [""], spec: "" });
  // 원본은 그대로
  assert.equal(s.content.offer.lines.length, n);
});

test("removeItem: 최소 개수면 거절, 고정 개수 목록은 더하지도 빼지도 못한다", () => {
  const s = snap();
  assert.equal(removeItem(s, "designs.items", 0), null);
  assert.equal(addItem(s, "designs.items"), null);
  assert.equal(canRemove(s.content, "pricing.tiers"), false);
  assert.equal(limitLabel(listDefOf("designs.items")), "3개 고정");
  assert.equal(limitLabel(listDefOf("plan.steps")), "3~5개");
});

test("removeItem/moveItem: 덮어쓰기가 항목을 따라간다", () => {
  const style = {
    ...DEFAULT_STYLE,
    overrides: {
      "plan.steps.0.title": { scale: 1.2 },
      "plan.steps.1.title": { font: "hahmlet" },
      "plan.steps.2.body": { scale: 0.8 },
      "plan.headline": { scale: 1.1 },
    },
  };
  const s = snap(content, style);
  const n = s.content.plan.steps.length;
  assert.ok(n > 3, "fixture 는 일정 4단계 이상");
  const r = removeItem(s, "plan.steps", 1);
  assert.equal(r.content.plan.steps.length, n - 1);
  assert.deepEqual(r.style.overrides, {
    "plan.steps.0.title": { scale: 1.2 },
    "plan.steps.1.body": { scale: 0.8 },
    "plan.headline": { scale: 1.1 },
  });
  const m = moveItem(s, "plan.steps", 0, 1);
  assert.equal(m.content.plan.steps[1], s.content.plan.steps[0]);
  assert.deepEqual(m.style.overrides["plan.steps.1.title"], { scale: 1.2 });
  assert.deepEqual(m.style.overrides["plan.steps.0.title"], { font: "hahmlet" });
  assert.equal(moveItem(s, "plan.steps", 0, -1), null);
  assert.equal(moveItem(s, "plan.steps", n - 1, 1), null);
});

test("moveItem: 시안 글자(A·B·C)는 자리에 남는다", () => {
  const s = snap();
  const m = moveItem(s, "designs.items", 0, 1);
  assert.deepEqual(m.content.designs.items.map((d) => d.key), s.content.designs.items.map((d) => d.key));
  assert.equal(m.content.designs.items[1].title, s.content.designs.items[0].title);
});

test("remapOverrides: 다른 목록과 비슷한 접두어(plan.steps10)는 건드리지 않는다", () => {
  const o = { "plan.stepsX.0": { scale: 1.1 }, "closing.next.0": { scale: 1.2 } };
  assert.equal(remapOverrides(o, "plan.steps", (i) => i + 1), o);
});

test("setPick: 추천 구간은 정확히 하나", () => {
  const c = setPick(content, 2);
  assert.deepEqual(
    c.pricing.tiers.map((t) => !!t.pick),
    [false, false, true]
  );
  assert.ok(c.pricing.tiers.every((t, i) => i === 2 || !("pick" in t)));
});

test("topListsOfPage / itemLabel", () => {
  assert.deepEqual(
    topListsOfPage("pricing").map((d) => d.pattern),
    ["pricing.tiers", "pricing.includes", "pricing.notes"]
  );
  assert.deepEqual(topListsOfPage("back").map((d) => d.pattern), ["closing.next"]);
  assert.deepEqual(topListsOfPage("offer").map((d) => d.pattern), ["offer.lines"]);
  assert.equal(itemLabel({ image: "x.jpg", org: "", title: "**굵은** 제목" }), "굵은 제목");
  assert.equal(itemLabel({ title: "" }), "(비어 있음)");
  assert.equal(itemLabel("가".repeat(30)).length, 19);
});

/* ── 쪽 ── */

test("movePage/togglePage: 표지·뒤표지 고정", () => {
  const pages = normalizePages([]);
  assert.equal(movePage(pages, "cover", 1), pages);
  assert.equal(movePage(pages, "glance", -1), pages, "표지 앞으로는 못 간다");
  assert.equal(movePage(pages, "plan", 1), pages, "뒤표지 뒤로는 못 간다");
  const m = movePage(pages, "glance", 1);
  assert.deepEqual(m.slice(0, 3).map((p) => p.id), ["cover", "observation", "glance"]);
  assert.equal(canMovePage(pages, "observation", -1), true);
  assert.equal(togglePage(pages, "back"), pages);
  assert.equal(togglePage(pages, "scenes").find((p) => p.id === "scenes").hidden, true);
});

/* ── 서체 ── */

test("fontRoleOfPath", () => {
  assert.equal(fontRoleOfPath("glance.headline"), "heading");
  assert.equal(fontRoleOfPath("offer.lines.0.name"), "heading");
  assert.equal(fontRoleOfPath("cases.items.2.title"), "heading");
  assert.equal(fontRoleOfPath("observation.quote"), "heading");
  assert.equal(fontRoleOfPath("observation.body.1"), "body");
  assert.equal(fontRoleOfPath("glance.specs.0.1"), "body");
  assert.equal(fontRoleOfPath("pricing.tiers.1.total"), "body");
});

test("setOverride: 범위로 자르고, 빈 덮어쓰기는 키째 지운다", () => {
  let s = setOverride(DEFAULT_STYLE, "glance.lede", { scale: 2 });
  assert.deepEqual(s.overrides["glance.lede"], { scale: 1.4 });
  s = setOverride(s, "glance.lede", { font: "hahmlet" });
  assert.deepEqual(s.overrides["glance.lede"], { scale: 1.4, font: "hahmlet" });
  s = setOverride(s, "glance.lede", { scale: 1, font: undefined });
  assert.equal("glance.lede" in s.overrides, false);
  s = setOverride(setOverride(s, "a", { scale: 0.85 }), "a", null);
  assert.deepEqual(s.overrides, {});
  assert.deepEqual(DEFAULT_STYLE.overrides, {}, "원본 불변");
});

/* ── 빈칸 ── */

test("orderedTbd: 쪽 순서를 따르고 숨긴 쪽은 뺀다", () => {
  const c = {
    ...content,
    title: "[확인 필요: 표지]",
    plan: { ...content.plan, headline: "[확인 필요: 일정]" },
    glance: { ...content.glance, headline: "[확인 필요: 한눈]" },
  };
  let pages = normalizePages([]);
  pages = movePage(movePage(movePage(movePage(movePage(movePage(movePage(pages, "plan", -1), "plan", -1), "plan", -1), "plan", -1), "plan", -1), "plan", -1), "plan", -1);
  assert.equal(pages[1].id, "plan");
  const ordered = orderedTbd(listTbd(c), pages);
  const firstPages = [...new Set(ordered.map((h) => h.page))];
  assert.deepEqual(firstPages.slice(0, 3), ["cover", "plan", "glance"]);
  const hidden = orderedTbd(listTbd(c), togglePage(pages, "plan"));
  assert.ok(hidden.every((h) => h.page !== "plan"));
  const byPage = tbdCountByPage(listTbd(c));
  assert.ok(byPage.plan >= 1 && byPage.cover >= 1);
});

/* ── 넘침 ── */

test("isOverflowing", () => {
  assert.equal(isOverflowing({ scrollHeight: 800, clientHeight: 794, bottom: 794 }, []), true);
  assert.equal(isOverflowing({ scrollHeight: 794, clientHeight: 794, bottom: 900 }, [880, 900.5]), false);
  assert.equal(isOverflowing({ scrollHeight: 794, clientHeight: 794, bottom: 900 }, [903]), true);
});

/* ── 이미지 ── */

test("hasImage: 상대 파일명은 빈 칸으로 친다", () => {
  assert.equal(hasImage("cover.jpg"), false);
  assert.equal(hasImage(""), false);
  assert.equal(hasImage("https://x/y.jpg"), true);
  assert.equal(hasImage({ url: "/a.png", fit: "cover", zoom: 1, x: 50, y: 50 }), true);
});

test("patchImage/dragFocal: 범위 안으로 자른다", () => {
  assert.deepEqual(patchImage("https://x/a.jpg", { zoom: 5 }), { url: "https://x/a.jpg", fit: "cover", zoom: 3, x: 50, y: 50 });
  const start = patchImage("https://x/a.jpg", {});
  assert.deepEqual(dragFocal(start, 0.1, -0.2), { ...start, x: 40, y: 70 });
  assert.equal(dragFocal(start, -2, 0).x, 100);
});

test("carryImages: 사례 사진은 자리 번호가 아니라 기관+사례명이 같은 사례로만 옮긴다(공백 차이는 무시)", () => {
  const prev = structuredClone(content);
  prev.cases.items[0] = { org: "공주시", title: "흥미진진  공주 캐릭터", note: "", image: "https://x/gongju.jpg" };
  prev.cases.items[1] = { org: "경찰청", title: "포돌이 페이퍼토이", note: "", image: "https://x/police.jpg" };
  prev.cases.items[2] = { org: "[확인 필요: 기관]", title: "[확인 필요: 사례명]", note: "", image: "https://x/tbd.jpg" };

  const next = structuredClone(content);
  next.cases.items[0] = { org: "남산타워", title: "팝업북", note: "", image: "https://lib/namsan.jpg" };
  next.cases.items[1] = { org: " 공주시 ", title: "흥미진진 공주 캐릭터", note: "", image: "" };
  next.cases.items[2] = { org: "[확인 필요: 기관]", title: "[확인 필요: 사례명]", note: "", image: "" };

  const out = carryImages(next, prev);
  assert.equal(out.cases.items[0].image, "https://lib/namsan.jpg", "짝이 없으면 새 원고 사진 그대로 — 자리 0 의 공주시 사진을 붙이지 않는다");
  assert.equal(out.cases.items[1].image, "https://x/gongju.jpg", "자리가 바뀌어도 같은 사례면 따라간다");
  assert.equal(out.cases.items[2].image, "", "빈칸 표기끼리는 같은 사례가 아니다");
  assert.equal(caseKey({ org: "a", title: "" }), null);
  assert.equal(caseKey({ org: " a  b ", title: "c" }), caseKey({ org: "a b", title: "c" }));
});

test("carryImages: 편집기와 같은 hasImage 기준 — 상대 파일명은 빈 칸이라 새 원고를 덮지 않는다", () => {
  const prev = structuredClone(content);
  prev.cover = "cover.jpg"; // data.json 의 상대 파일명 = 아직 없는 그림
  prev.scenes.image = { url: "https://cdn.example.com/scene.jpg", fit: "contain", zoom: 2, x: 10, y: 20 };
  prev.designs.items[0].image = "/uploads/a.png";
  prev.designs.items[1].image = "design-b.png";
  prev.cases.items[0].image = { url: "case.jpg", fit: "cover", zoom: 1, x: 50, y: 50 };

  const next = structuredClone(content);
  next.cover = "";
  next.scenes.image = "";
  next.designs.items.forEach((d) => (d.image = ""));
  next.cases.items.forEach((d) => (d.image = ""));

  const out = carryImages(next, prev);
  assert.equal(out.cover, "", "상대 파일명은 옮기지 않는다");
  assert.deepEqual(out.scenes.image, prev.scenes.image);
  assert.equal(out.designs.items[0].image, "/uploads/a.png");
  assert.equal(out.designs.items[1].image, "", "상대 파일명은 옮기지 않는다");
  assert.equal(out.cases.items[0].image, "", "객체여도 url 이 상대 파일명이면 빈 칸");
  assert.equal(next.designs.items[0].image, "", "입력 원고는 건드리지 않는다");
  for (const [v, want] of [["cover.jpg", false], ["", false], ["/x.png", true], ["https://a/b.png", true]]) {
    assert.equal(hasImage(v), want, String(v));
  }
});
