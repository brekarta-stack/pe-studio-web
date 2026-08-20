/**
 * /studio 산출물 무결성 테스트 (node --test) — M1 릴리스 게이트.
 *   node --test tests/studio.test.mjs
 *
 * 검증: index.json 항목마다 공개 자산(thumb/glb/meta/preview SVG)이 실재하고,
 * 미리보기 SVG 에 워터마크가 구워져 있으며, PDF 는 public 이 아닌 비공개 폴더에만 있다.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const idx = JSON.parse(
  readFileSync(path.join(ROOT, "public", "studio", "v2.16.4", "index.json"), "utf-8"),
);
const VER = idx.engine;
const pub = (skey, f) => path.join(ROOT, "public", "studio", VER, skey, f);
const prv = (skey, f) => path.join(ROOT, "content-private", "studio", VER, skey, f);

test("index.json: 항목 수(큐레이션 20 이상)와 필수 필드", () => {
  assert.ok(idx.items.length >= 20, `items ${idx.items.length} < 20`);
  // 대규모 유실 감지 — 181→141 처럼 카탈로그가 통째로 줄어드는 사고를 잡는다.
  // 카테고리별 하한은 품질 게이트의 정상적인 제외와 구분되지 않으므로 총량으로 본다.
  // 180→160 (2026-08-20): 외톨이 조각 게이트(R4)·보류 씸 차단이 21종을 의도적으로
  // 제외했다(v2.16.0, 판다·고양이 등 스킨 회귀 포함). 유실 사고가 아니라 품질 게이트.
  assert.ok(idx.items.length >= 160,
    `카탈로그 ${idx.items.length}종 < 160 (대량 제외 의심)`);
  for (const it of idx.items) {
    for (const field of ["key", "skey", "name_ko", "category", "pieces", "pages",
                         "pdf_pages", "finished_mm", "stars", "est_minutes", "svg_sheets"]) {
      assert.ok(field in it, `${it.key ?? "?"}: ${field} 누락`);
    }
    assert.match(it.skey, /^[a-z0-9_]+$/, `skey 형식: ${it.skey}`);
  }
});

test("카테고리 택소노미: 동물 세분화 + 인기 캐릭터, '동물' 단일 카테고리 소멸", () => {
  const counts = {};
  for (const it of idx.items) counts[it.category] = (counts[it.category] ?? 0) + 1;
  // 세분화 이전의 뭉뚱그린 '동물'은 남아 있으면 안 된다
  assert.ok(!("동물" in counts), "'동물' 카테고리가 아직 남아 있음(세분화 미반영)");
  // 세분화 카테고리는 각각 8종 이상.
  // 15종이던 기준을 낮춘 이유: 손작업 절대 규칙 게이트(d781e49c)가 접착탭이
  // 물리적으로 안 붙는 도면을 buildable=False 로 제외하면서 곤충 6종·수련이
  // 빠졌다. 유실이 아니라 의도된 품질 개선이라 카테고리 하한으로는 못 막는다.
  // 대신 아래 총량 검사가 대규모 제외를 잡는다.
  for (const cat of ["바다생물", "육지동물", "곤충", "식물"]) {
    assert.ok((counts[cat] ?? 0) >= 8, `${cat} ${counts[cat] ?? 0} < 8`);
  }
  // 인기 캐릭터 신설(동물형 트렌디 캐릭터)
  assert.ok((counts["인기 캐릭터"] ?? 0) >= 8, `인기 캐릭터 ${counts["인기 캐릭터"] ?? 0} < 8`);
});

test("공개 자산 실재: thumb·glb·meta·preview SVG 전 장", () => {
  for (const it of idx.items) {
    for (const f of ["thumb.png", "model.glb", "meta.json"]) {
      assert.ok(existsSync(pub(it.skey, f)), `${it.skey}/${f} 없음`);
    }
    for (let n = 1; n <= it.svg_sheets; n++) {
      assert.ok(existsSync(pub(it.skey, `preview_p${n}.svg`)),
        `${it.skey}/preview_p${n}.svg 없음`);
    }
  }
});

test("미리보기 SVG 워터마크가 파일에 구워져 있음", () => {
  for (const it of idx.items) {
    const svg = readFileSync(pub(it.skey, "preview_p1.svg"), "utf-8");
    assert.ok(svg.includes(">papercraft.kr</text>"), `${it.skey}: 워터마크 없음`);
  }
});

test("PDF 는 비공개 폴더에만 (public 유출 금지)", () => {
  for (const it of idx.items) {
    assert.ok(existsSync(prv(it.skey, "print.pdf")), `${it.skey}: 비공개 PDF 없음`);
    assert.ok(!existsSync(pub(it.skey, "print.pdf")),
      `${it.skey}: PDF 가 public 에 유출됨!`);
  }
});

test("꾸미기 자산(클린 시트·net.json)은 비공개에만, 시트는 워터마크 없음", () => {
  for (const it of idx.items) {
    assert.ok(existsSync(prv(it.skey, "net.json")), `${it.skey}: net.json 없음`);
    for (let n = 1; n <= it.svg_sheets; n++) {
      assert.ok(existsSync(prv(it.skey, `sheet_p${n}.svg`)),
        `${it.skey}/sheet_p${n}.svg 없음`);
      assert.ok(!existsSync(pub(it.skey, `sheet_p${n}.svg`)),
        `${it.skey}: 클린 시트가 public 에 유출됨!`);
    }
    const clean = readFileSync(prv(it.skey, "sheet_p1.svg"), "utf-8");
    assert.ok(!clean.includes(">papercraft.kr</text>"),
      `${it.skey}: 클린 시트에 워터마크가 있음(잘못 복사)`);
  }
});
