import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * 블로그 스타일 가이드(docs/blog-content-guide.md)의 코퍼스 수준 규칙을
 * 시드 글에 대해 상시 검사한다. AI 티가 나는 패턴이 다시 쌓이면 여기서 걸린다.
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, "src/lib/blog-seed.ts"), "utf8");

const titles = [...src.matchAll(/title: "(.*?)"/g)].map((m) => m[1]);
const excerpts = [...src.matchAll(/excerpt:\s*\n?\s*"(.*?)"/g)].map((m) => m[1]);
const createdAts = [...src.matchAll(/createdAt: "([^"]+)"/g)].map((m) => m[1]);
const slugs = [...src.matchAll(/slug: "([^"]+)"/g)].map((m) => m[1]);

test("시드 글이 존재한다", () => {
  assert.ok(titles.length >= 30, `글 수: ${titles.length}`);
});

test("대시(—) 제목은 전체의 25% 이하", () => {
  const dashed = titles.filter((t) => t.includes("—"));
  assert.ok(
    dashed.length <= Math.ceil(titles.length * 0.25),
    `대시 제목 ${dashed.length}/${titles.length}: ${dashed.join(" | ")}`
  );
});

test("'정리했다/들여다봤다/적었다' 류 발췌 종결은 30% 이하", () => {
  const patterned = excerpts.filter((e) =>
    /(정리했다|들여다봤다|적었다|이야기)\.?$/.test(e)
  );
  assert.ok(
    patterned.length <= Math.ceil(excerpts.length * 0.3),
    `패턴 종결 ${patterned.length}/${excerpts.length}`
  );
});

test("발행 시각이 정각(:00분·12시 고정)으로 몰려 있지 않다", () => {
  const noon = createdAts.filter((d) => d.includes("T12:00:00"));
  assert.ok(noon.length <= 2, `12:00 정각 발행 ${noon.length}건`);
  const uniqueTimes = new Set(createdAts.map((d) => d.slice(11, 16)));
  assert.ok(uniqueTimes.size >= createdAts.length * 0.8, "발행 시각 다양성 부족");
});

test("클리셰 어휘 상한 — '결국' 총 8회 이하", () => {
  const count = (src.match(/결국/g) ?? []).length;
  assert.ok(count <= 8, `'결국' ${count}회`);
});

test("slug 는 중복이 없다", () => {
  assert.equal(new Set(slugs).size, slugs.length);
});

test("해요체 실용 글이 최소 4편 존재한다 (문체 편차 유지)", () => {
  const contents = [...src.matchAll(/content: `([\s\S]*?)`,\n\s*\}/g)].map((m) => m[1]);
  const polite = contents.filter((c) => /(이에요|예요|합니다|해요|드릴게요|보세요)/.test(c.slice(0, 400)));
  assert.ok(polite.length >= 4, `해요체 글 ${polite.length}편`);
});
