/**
 * 제안서 편집기 순수 모듈 테스트 (node --test)
 *   node --test tests/proposal-book.test.mjs
 *
 * 원고 형식(schema)·표기 파서(markup)·대체 원고(fallback)·서체 주소(fonts)를 못 박는다.
 * 대체 원고는 AI 가 실패했을 때 열리는 초안이라, 옛 금액이 새거나 한도를 넘거나 던지면
 * 편집기가 열리지 않거나 틀린 견적이 나간다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  bookContentSchema,
  bookContentStrictSchema,
  bookStyleSchema,
  checkLimits,
  conformContent,
  defaultPages,
  DEFAULT_STYLE,
  emptyContent,
  getAt,
  LIMITS,
  normalizeImage,
  normalizePages,
  normalizeStyle,
  PAGE_DEFS,
  setAt,
} from "../src/lib/proposal-book/schema.ts";
import { countTbd, listTbd, plainText, renderInline } from "../src/lib/proposal-book/markup.ts";
import { buildFallback, clipText } from "../src/lib/proposal-book/fallback.ts";
import { fontStack, fontStylesheetUrls, HEADING_FONTS, BODY_FONTS } from "../src/lib/proposal-book/fonts.ts";

const sample = JSON.parse(readFileSync(new URL("./fixtures/proposal-sample.json", import.meta.url), "utf8"));
const oldBody = readFileSync(new URL("./fixtures/proposal-old-body.md", import.meta.url), "utf8");

/** 대체 원고가 지켜야 할 공통 조건 */
function assertValidFallback(c) {
  assert.equal(bookContentSchema.safeParse(c).success, true, "모양이 스키마와 맞아야 한다");
  const r = bookContentStrictSchema.safeParse(c);
  assert.equal(r.success, true, `개수 한도 안이어야 한다: ${r.success ? "" : JSON.stringify(r.error.issues)}`);
  assert.deepEqual(checkLimits(c), [], "글자 수 한도까지 지켜야 한다");
  for (const t of c.pricing.tiers) {
    assert.match(t.total, /^\[확인 필요: 단가\]$/, "견적 총액은 언제나 빈칸");
    assert.match(t.unit, /^\[확인 필요: 단가\]$/, "개당 단가도 빈칸");
  }
  assert.equal(c.pricing.tiers.filter((t) => t.pick).length, 1);
  // 옛 금액대가 어느 칸으로도 새지 않는다
  assert.doesNotMatch(JSON.stringify(c), /690만|1,220만|370만|320만/);
}

/* ── schema ─────────────────────────────────────────────────── */

test("견본 원고(통영)는 스키마와 엄격 스키마를 통과한다", () => {
  assert.equal(bookContentSchema.safeParse(sample).success, true);
  const strict = bookContentStrictSchema.safeParse(sample);
  assert.equal(strict.success, true, JSON.stringify(strict.error?.issues));
});

test("엄격 스키마는 개수 한도와 추천 구간 하나를 막는다", () => {
  const twoScenes = setAt(sample, "scenes.items", [...sample.scenes.items, { title: "셋", body: "" }]);
  assert.equal(bookContentStrictSchema.safeParse(twoScenes).success, false);
  const noPick = setAt(sample, "pricing.tiers.1.pick", false);
  assert.equal(bookContentStrictSchema.safeParse(noPick).success, false);
  // 모양만 보는 스키마는 편집 중의 한도 밖 상태를 받아 준다
  assert.equal(bookContentSchema.safeParse(twoScenes).success, true);
});

test("이미지 칸은 문자열과 {url,fit,zoom,x,y} 둘 다 받는다", () => {
  const withObj = setAt(sample, "cover", { url: "https://x/y.jpg", fit: "contain", zoom: 2, x: 30, y: 70 });
  assert.equal(bookContentSchema.safeParse(withObj).success, true);
  const bad = setAt(sample, "cover", { url: "https://x/y.jpg", fit: "contain", zoom: 9, x: 30, y: 70 });
  assert.equal(bookContentSchema.safeParse(bad).success, false);
});

test("normalizeImage — 문자열·객체·쓰레기 모두 한 모양으로, 범위 밖은 잘라 넣는다", () => {
  assert.deepEqual(normalizeImage(" a.jpg "), { url: "a.jpg", fit: "cover", zoom: 1, x: 50, y: 50 });
  assert.deepEqual(normalizeImage({ url: "u", fit: "contain", zoom: 5, x: -3, y: 140 }), {
    url: "u", fit: "contain", zoom: 3, x: 0, y: 100,
  });
  assert.deepEqual(normalizeImage(null), { url: "", fit: "cover", zoom: 1, x: 50, y: 50 });
  assert.deepEqual(normalizeImage({ fit: "weird", zoom: "x" }), { url: "", fit: "cover", zoom: 1, x: 50, y: 50 });
});

test("getAt / setAt — 점 경로, 숫자는 배열 인덱스, 원본은 그대로", () => {
  const before = JSON.stringify(sample);
  assert.equal(getAt(sample, "offer.lines.0.name"), "체험 워크숍 키트");
  assert.equal(getAt(sample, "glance.specs.1.0"), "크기");
  assert.equal(getAt(sample, "nope.deep.path"), undefined);

  const next = setAt(sample, "observation.body.2", "바뀐 문단");
  assert.equal(getAt(next, "observation.body.2"), "바뀐 문단");
  assert.equal(JSON.stringify(sample), before, "원본은 바뀌지 않는다");
  assert.ok(Array.isArray(next.observation.body));
  // 경로 위만 새 객체, 옆 가지는 같은 참조 (React 가 바뀐 칸만 다시 그리게)
  assert.notEqual(next.observation, sample.observation);
  assert.equal(next.offer, sample.offer);
  assert.equal(next.observation.sources, sample.observation.sources);

  // 없는 중간 마디는 다음 마디를 보고 배열/객체를 만든다
  const made = setAt({}, "a.0.b", 1);
  assert.deepEqual(made, { a: [{ b: 1 }] });
});

test("스타일·쪽 구성 기본값과 정규화", () => {
  assert.equal(bookStyleSchema.safeParse(DEFAULT_STYLE).success, true);
  assert.equal(DEFAULT_STYLE.keyColor, "#1E22B2");
  assert.deepEqual(normalizeStyle({}), DEFAULT_STYLE);
  assert.equal(normalizeStyle({ keyColor: "red" }).keyColor, "#1E22B2");
  assert.deepEqual(normalizeStyle({ overrides: { "glance.headline": { scale: 1.2 }, bad: { scale: 9 } } }).overrides, {
    "glance.headline": { scale: 1.2 },
  });

  assert.equal(PAGE_DEFS.length, 10);
  assert.deepEqual(PAGE_DEFS.filter((p) => p.fixed).map((p) => p.id), ["cover", "back"]);
  assert.deepEqual(normalizePages([]), defaultPages());
  // 순서·숨김은 지키고, 표지·뒤표지는 양끝 고정, 중복·모르는 쪽은 버린다
  const pages = normalizePages([
    { id: "back", hidden: true },
    { id: "plan", hidden: true },
    { id: "glance" },
    { id: "plan" },
    { id: "zzz" },
  ]);
  assert.equal(pages[0].id, "cover");
  assert.equal(pages.at(-1).id, "back");
  assert.equal(pages.at(-1).hidden, false);
  assert.deepEqual(pages.slice(1, 3), [{ id: "plan", hidden: true }, { id: "glance", hidden: false }]);
  assert.equal(pages.length, 10);
});

test("emptyContent 는 한도를 만족하고 conformContent 는 깨진 저장본을 틀에 맞춘다", () => {
  const e = emptyContent("국립해양박물관");
  assert.equal(bookContentStrictSchema.safeParse(e).success, true);
  assert.deepEqual(checkLimits(e), []);
  const fixed = conformContent({ org: "A", glance: { specs: [["k", 3]] }, cover: { url: "u", fit: "cover", zoom: 1, x: 1, y: 2 } }, e);
  assert.equal(fixed.org, "A");
  assert.deepEqual(fixed.glance.specs, [["k", "3"]]);
  assert.equal(fixed.cover.url, "u", "이미지 객체는 템플릿 문자열로 덮이지 않는다");
  assert.equal(fixed.title, e.title);
  assert.deepEqual(conformContent("garbage", e), e);
});

/* ── markup ─────────────────────────────────────────────────── */

test("renderInline — 굵게·각주·빈칸 조각", () => {
  assert.deepEqual(renderInline("누적 **1,700만 명**[^1] 입니다"), [
    { type: "text", value: "누적 " },
    { type: "bold", value: "1,700만 명" },
    { type: "fn", value: "1" },
    { type: "text", value: " 입니다" },
  ]);
  assert.deepEqual(renderInline("부서는 [확인 필요: 담당 부서] 입니다"), [
    { type: "text", value: "부서는 " },
    { type: "tbd", value: "확인 필요: 담당 부서" },
    { type: "text", value: " 입니다" },
  ]);
  // 흔들린 표기도 같은 빈칸으로
  assert.deepEqual(renderInline("[확인필요]"), [{ type: "tbd", value: "확인 필요" }]);
  assert.deepEqual(renderInline("[ 확인 필요 :  출처 ]"), [{ type: "tbd", value: "확인 필요: 출처" }]);
  // 굵게 안의 빈칸은 형광펜으로 쪼갠다
  assert.deepEqual(renderInline("**가 [확인 필요: 나] 다**"), [
    { type: "bold", value: "가 " },
    { type: "tbd", value: "확인 필요: 나" },
    { type: "bold", value: " 다" },
  ]);
  assert.deepEqual(renderInline(""), []);
  assert.deepEqual(renderInline(null), []);
  assert.equal(plainText("**굵게**[^2] 끝"), "굵게 끝");
});

test("countTbd / listTbd — 깊이 훑고, 흔들린 표기·닫히지 않은 표기도 센다", () => {
  const c = {
    a: "[확인 필요: 하나] 와 [확인필요]",
    b: { c: ["x", "[ 확인 필요 : 셋]"], d: "닫히지 않은 [확인 필요: 넷" },
    observation: { body: ["[확인 필요: 다섯]"] },
  };
  assert.equal(countTbd(c), 5);
  const list = listTbd(c);
  assert.deepEqual(list.map((h) => h.path), ["a", "a", "b.c.1", "b.d", "observation.body.0"]);
  assert.equal(list[0].text, "[확인 필요: 하나]");
  assert.equal(list[3].text, "[확인 필요: 넷");
  assert.equal(list[4].page, "observation");
  // 견본 원고에는 빈칸이 실제로 남아 있다(부서·누적 탑승·출처 링크…)
  assert.ok(countTbd(sample) >= 5);
  assert.equal(countTbd({}), 0);
});

/* ── fallback ───────────────────────────────────────────────── */

test("buildFallback — 옛 제안서 본문을 칸에 나눠 앉힌다", () => {
  const c = buildFallback({
    org: "통영시",
    name: "관광과",
    email: "tour@tongyeong.go.kr",
    outreach: { subject: "[papercraft.kr] 통영시 한려수도·케이블카 종이 기념품 제작 제안", body_text: oldBody },
  });
  assertValidFallback(c);
  assert.equal(c.org, "통영시");
  assert.equal(c.title, "통영시 한려수도·케이블카 종이 기념품 제작 제안");
  assert.deepEqual(c.contact, { dept: "관광과", email: "tour@tongyeong.go.kr" });
  // 한눈 요약 "키 _ 값" → specs, 금액이 든 "구성 산식" 줄은 거른다
  assert.deepEqual(c.glance.specs[0], ["대상", "케이블카 탑승객·관광기념품 매대·통영국제음악제 및 한산대첩축제 방문객"]);
  assert.ok(!c.glance.specs.some(([k]) => k.includes("산식")));
  // 관찰 — 제목은 기관 현황 타이틀, 인용은 제안 배경 타이틀, 본문은 문단당 3문장 이하
  assert.ok(c.observation.headline.startsWith("미륵산 케이블카와 한려수도는"));
  assert.ok(c.observation.quote.startsWith("지자체 기념품은"));
  assert.ok(c.observation.body.length >= 1 && c.observation.body.length <= 4);
  for (const p of c.observation.body) assert.ok(p.split(/(?<=[.!?])\s+/).length <= 3);
  assert.deepEqual(c.observation.sources, [{ label: "[확인 필요: 출처]", url: "" }]);
  // 제안 라인업 — "**이름 _ 쓰임** — 설명"
  assert.equal(c.offer.lines.length, 3);
  assert.equal(c.offer.lines[0].name, "체험 워크숍 키트");
  assert.equal(c.offer.lines[0].use, "케이블카 탑승장·축제 체험존용");
  assert.ok(c.offer.lines[0].body.length <= 2);
  // 사례 — 번호 목록 두 개 + 빈칸 하나, 기관은 괄호에서
  assert.equal(c.cases.items[0].title, "남산타워 팝업북");
  assert.equal(c.cases.items[0].org, "이노션 · 현대");
  assert.equal(c.cases.items[1].org, "공주시");
  assert.match(c.cases.items[2].title, /확인 필요/);
  assert.ok(c.cases.items.every((x) => x.image === ""));
  // 활용 장면 — 기대 효과 첫 두 문장
  assert.ok(c.scenes.items[0].body.startsWith("케이블카 탑승 프로그램"));
  assert.ok(c.scenes.items[1].body.startsWith("관광기념품 매대에는"));
  assert.equal(c.plan.headline, "샘플 확인부터 납품까지, 총 약 4주입니다.");
});

test("buildFallback — 빈 입력·쓰레기 입력에도 던지지 않고 빈칸 원고를 낸다", () => {
  for (const input of [null, undefined, {}, { outreach: null }, { outreach: { body_text: 42 } }, { org: 7, outreach: { body_text: "## 한눈 요약\n**\n- _ \n## 제안 솔루션\n- ** ** —" } }]) {
    const c = buildFallback(input);
    assertValidFallback(c);
  }
  const c = buildFallback({});
  assert.match(c.org, /확인 필요/);
  assert.match(c.contact.dept, /확인 필요/);
  assert.ok(countTbd(c) > 10);
});

test("buildFallback — 사례가 모자라면 matched_cases 로 채운다(중복 제외)", () => {
  const c = buildFallback({
    org: "X",
    outreach: { body_text: "## 비슷한 유형 매칭 사례\n1. 가 사례(기관A) — 설명.", matched_cases: ["가 사례(기관A)", "나 사례(기관B)"] },
  });
  assert.deepEqual(c.cases.items.map((x) => x.title).slice(0, 2), ["가 사례", "나 사례"]);
  assertValidFallback(c);
});

test("clipText — 한도 안이면 그대로, 넘으면 어절에서 끊고 … (… 포함 한도)", () => {
  assert.equal(clipText("짧은 글", 10), "짧은 글");
  const long = "미륵산 케이블카와 한려수도는 통영의 대표 관광자산이지만, 관람 이후 손에 남는 것은 아직 부족합니다.";
  const out = clipText(long, LIMITS.chars.headline);
  assert.ok(Array.from(out).length <= LIMITS.chars.headline);
  assert.ok(out.endsWith("…"));
});

/* ── fonts ──────────────────────────────────────────────────── */

test("서체 목록과 Google Fonts 주소", () => {
  assert.equal(HEADING_FONTS.length, 6);
  assert.equal(BODY_FONTS.length, 5);
  // 기본 스타일 = 명조(Google) + Pretendard(자체 호스팅) → Google 주소 하나에 Noto Serif KR 만
  const urls = fontStylesheetUrls(DEFAULT_STYLE);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/fonts\.googleapis\.com\/css2\?family=Noto\+Serif\+KR:wght@400;600;700;900&display=swap$/);
  // 칸별 덮어쓰기 서체도 함께 받는다, 같은 서체는 한 번만
  const u2 = fontStylesheetUrls({ headingFont: "gowun-batang", bodyFont: "noto-sans-kr", overrides: { a: { font: "noto-sans-kr" }, b: { font: "hahmlet" } } })[0];
  assert.match(u2, /family=Gowun\+Batang:wght@400;700/);
  assert.equal(u2.match(/Noto\+Sans\+KR/g).length, 1);
  assert.match(u2, /family=Hahmlet/);
  // Google 서체를 하나도 안 쓰면 외부 주소가 없다
  assert.deepEqual(fontStylesheetUrls({ headingFont: "pretendard", bodyFont: "pretendard", overrides: {} }), []);
  // 모르는 id 는 기본 서체로
  assert.equal(fontStack("nope", "heading"), HEADING_FONTS[0].stack);
  assert.match(fontStack("pretendard", "body"), /--font-pretendard/);
});
