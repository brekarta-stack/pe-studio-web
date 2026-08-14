/**
 * RSS 피드 생성 규칙 테스트 (node --test)
 *   node --test tests/rss-feed.test.mjs
 *
 * 라우트는 Supabase 를 타므로 여기서는 피드를 만드는 순수 규칙 —
 * XML 이스케이프와 RFC-822 날짜 — 을 route 와 같은 구현으로 검증한다.
 * 이 둘이 깨지면 피드 전체가 리더에서 버려지기 때문에 회귀 감시 가치가 크다.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = readFileSync(path.join(ROOT, "src", "app", "rss.xml", "route.ts"), "utf-8");

// route.ts 와 동일한 구현 (아래 "구현 동기화" 테스트가 어긋남을 잡는다)
function xmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

test("XML 이스케이프: 피드를 깨뜨리는 5개 문자를 모두 치환", () => {
  assert.equal(xmlEscape("A & B"), "A &amp; B");
  assert.equal(xmlEscape("<script>"), "&lt;script&gt;");
  assert.equal(xmlEscape(`"인용"`), "&quot;인용&quot;");
  assert.equal(xmlEscape("it's"), "it&apos;s");
  // & 를 먼저 치환해야 이미 만든 엔티티를 다시 이스케이프하지 않는다
  assert.equal(xmlEscape("<a & b>"), "&lt;a &amp; b&gt;");
  assert.ok(!xmlEscape("<a & b>").includes("&amp;lt;"), "이중 이스케이프 발생");
});

test("XML 이스케이프: 한글·이모지는 그대로 통과", () => {
  assert.equal(xmlEscape("팝업북 제작"), "팝업북 제작");
  assert.equal(xmlEscape("종이 🎨 공예"), "종이 🎨 공예");
});

test("pubDate 는 RFC-822 (ISO-8601 아님)", () => {
  const out = rfc822("2026-08-11T14:40:07.145Z");
  assert.match(out, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/, `RFC-822 아님: ${out}`);
  // ISO-8601 잔재 검출 — "Tue" 처럼 요일에 T 가 들어가므로 날짜 패턴으로 본다
  assert.doesNotMatch(out, /\d{4}-\d{2}-\d{2}T/, "ISO 형식이 새어나옴");
});

test("pubDate: 잘못된 날짜는 예외 대신 현재 시각으로 대체", () => {
  const out = rfc822("날짜아님");
  assert.match(out, /GMT$/);
});

test("route.ts 필수 요소: RSS 2.0 채널 구조와 self 링크", () => {
  for (const needle of [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"',
    "xmlns:atom=",
    "<channel>",
    "<lastBuildDate>",
    'rel="self"',
    "<language>ko</language>",
    "application/rss+xml",
  ]) {
    assert.ok(SRC.includes(needle), `route.ts 에 ${needle} 없음`);
  }
});

test("route.ts: 공개된 글만 싣는다", () => {
  assert.match(SRC, /filter\(\(p\) => p\.published\)/, "published 필터 누락 — 비공개 글 유출");
});

test("구현 동기화: route.ts 의 이스케이프 대상 5종이 이 테스트와 일치", () => {
  for (const entity of ["&amp;", "&lt;", "&gt;", "&quot;", "&apos;"]) {
    assert.ok(SRC.includes(entity), `route.ts 에 ${entity} 치환 없음`);
  }
  assert.ok(SRC.includes("toUTCString"), "route.ts 가 RFC-822 변환을 쓰지 않음");
});
