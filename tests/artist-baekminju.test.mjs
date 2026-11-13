import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ARTIST, WORKS, buildRow } from "../scripts/add-artist-baekminju.mjs";
import { CATEGORIES, CLIENT_TYPES } from "../src/lib/portfolio-types.ts";

test("작품 13점, slug 중복 없음", () => {
  assert.equal(WORKS.length, 13);
  assert.equal(new Set(WORKS.map((w) => w.slug)).size, WORKS.length);
  assert.equal(new Set(WORKS.map((w) => w.file)).size, WORKS.length);
});

test("제작 시기는 6개월 전 ~ 1개월 전(2026-04-06 ~ 2026-09-06) 안에서 서로 다르다", () => {
  for (const w of WORKS) {
    assert.match(w.producedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(w.producedAt >= "2026-04-06" && w.producedAt <= "2026-09-06", w.producedAt);
  }
  assert.equal(new Set(WORKS.map((w) => w.producedAt)).size, WORKS.length);
  assert.equal(new Set(WORKS.map((w) => w.producedAt.slice(0, 7))).size, 6, "4~9월 여섯 달에 고루");
});

test("작품 행은 아티스트 태그로 연결되고 사이트가 아는 값만 쓴다", () => {
  const row = buildRow(WORKS[0], ["https://x/uploads/a.jpg"], "2026-10-06T00:00:00.000Z");
  assert.ok(row.tags.includes(ARTIST.portfolio_tag));
  assert.ok(CATEGORIES.includes(row.category));
  assert.ok(CLIENT_TYPES.includes(row.client_type));
  assert.equal(row.image_alts.length, row.images.length);
  assert.equal(row.produced_at, WORKS[0].producedAt);
  assert.match(buildRow(WORKS.find((w) => w.title === "짬뽕"), [], "").summary, /"짬뽕"을/);
  assert.match(buildRow(WORKS.find((w) => w.title === "콰트로 피자"), [], "").summary, /"콰트로 피자"를/);
});

test("코드 시드(폴백)와 스크립트의 아티스트 정보가 같다", () => {
  const src = readFileSync(new URL("../src/lib/artists.ts", import.meta.url), "utf8");
  for (const v of [ARTIST.id, ARTIST.bio, ARTIST.role, `portfolioTag: "${ARTIST.portfolio_tag}"`]) assert.ok(src.includes(v), v);
});
