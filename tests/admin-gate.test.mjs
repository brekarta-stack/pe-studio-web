/**
 * 어드민/포털 경로 게이트 테스트 (node --test)
 *   node --test tests/admin-gate.test.mjs
 *
 * 왜 이런 방식인가:
 * 아티스트에게 관리자 대시보드가 열렸던 원인은 프록시 matcher 에 `/admin` 딱
 * 그 경로가 빠져 있었던 것이다. 하위 경로 패턴(`/admin/...`)만 있어서 루트가
 * 통째로 게이트 밖이었다.
 *
 * matcher 는 Next 가 빌드 타임에 정적 분석하므로 변수로 뽑아 import 할 수 없고
 * (그러면 무시된다), proxy.ts 는 next/server 를 import 해서 node 로 직접
 * 불러올 수도 없다. 그래서 소스에서 matcher 배열을 읽어 어떤 URL 이 게이트에
 * 걸리는지 검사한다 — "어떤 경로가 보호되는가"를 코드로 못 박아 둔다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf-8");

/** proxy.ts 의 config.matcher 배열에서 문자열 패턴만 뽑아낸다 */
function readMatchers() {
  const block = /matcher:\s*\[([\s\S]*?)\]/.exec(source);
  assert.ok(block, "config.matcher 배열을 찾지 못했습니다");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Next matcher 문법 → 정규식.
 * 이 프로젝트가 쓰는 두 가지만 다룬다: `:path*` 와 인라인 정규식 그룹.
 */
function toRegExp(pattern) {
  const body = pattern.replace(/\/:[A-Za-z]+\*/g, "(?:/.*)?");
  return new RegExp(`^${body}$`);
}

const matchers = readMatchers();
const gated = (pathname) => matchers.some((m) => toRegExp(m).test(pathname));

test("어드민 루트(/admin)가 게이트에 걸린다 — 이게 빠져서 대시보드가 열렸다", () => {
  assert.equal(gated("/admin"), true);
});

test("어드민 하위 경로가 모두 게이트에 걸린다", () => {
  for (const p of [
    "/admin/works",
    "/admin/quotes",
    "/admin/accounts",
    "/admin/setup",
    "/admin/analytics",
    "/admin/artists/artist-01/edit",
  ]) {
    assert.equal(gated(p), true, p);
  }
});

test("어드민 로그인만 게이트에서 빠진다 — 아니면 로그인으로 무한 리다이렉트", () => {
  assert.equal(gated("/admin/login"), false);
});

test("아티스트 포털이 게이트에 걸린다 (루트와 하위 모두)", () => {
  assert.equal(gated("/artist"), true);
  assert.equal(gated("/artist/settlements"), true);
  assert.equal(gated("/artist/works/abc-123"), true);
  // 포털의 공개 페이지도 matcher 에는 걸리고, 통과 여부는 proxy 함수가 정한다
  assert.equal(gated("/artist/login"), true);
});

test("공개 페이지는 게이트 밖이다", () => {
  for (const p of ["/", "/about", "/portfolio", "/blog", "/quote", "/products"]) {
    assert.equal(gated(p), false, p);
  }
});

test("스튜디오는 게이트에 걸린다 (관리자만 열람)", () => {
  assert.equal(gated("/studio"), true);
  assert.equal(gated("/studio/cube"), true);
});

/* ── 서버 쪽 관문 ──
 * 경로 패턴은 실수하기 쉬우니 레이아웃에서도 역할을 확인한다.
 * 그 관문이 사라지면 matcher 구멍이 곧바로 사고가 되므로 존재를 못 박아 둔다. */

test("어드민 레이아웃이 관리자가 아닌 세션을 돌려보낸다", () => {
  const layout = readFileSync(new URL("../src/app/admin/layout.tsx", import.meta.url), "utf-8");
  assert.match(layout, /role\s*!==\s*"admin"/, "레이아웃의 역할 확인이 사라졌습니다");
  assert.match(layout, /redirect\("\/artist"\)/, "아티스트를 포털로 돌려보내야 합니다");
});

test("어드민 API·서버 액션이 세션 유무가 아니라 역할을 본다", () => {
  // `if (!session)` 만으로 막으면 아티스트 세션이 전부 통과한다 — 그 패턴이
  // 되살아나지 않게 감시한다.
  const files = [
    "../src/app/api/admin/migrate/route.ts",
    "../src/app/api/upload/route.ts",
    "../src/app/api/blog/route.ts",
    "../src/app/api/portfolio/route.ts",
    "../src/app/api/artists/route.ts",
    "../src/app/api/quote/route.ts",
    "../src/app/admin/works/actions.ts",
    "../src/app/admin/quotes/actions.ts",
    "../src/app/admin/accounts/actions.ts",
  ];
  for (const rel of files) {
    const text = readFileSync(new URL(rel, import.meta.url), "utf-8");
    assert.doesNotMatch(text, /if \(!session\)/, `${rel} 에 세션 유무만 보는 가드가 남아 있습니다`);
    assert.match(
      text,
      /requireAdminApi|requireAdmin|isAdminSession|role !== "admin"/,
      `${rel} 에 관리자 확인이 없습니다`
    );
  }
});
