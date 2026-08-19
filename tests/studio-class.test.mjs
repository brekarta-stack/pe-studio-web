/**
 * 학급 세트(M4) 테스트 — node --test tests/studio-class.test.mjs
 * ① 공유 링크 인코딩/디코딩 계약(쓰레기 거부·중복 합산·상한)
 * ② pdf-lib 실병합: 실제 비공개 PDF 두 종을 수량만큼 이어붙여 장수 검증
 *    (API 라우트와 같은 라이브러리·같은 호출 — 병합 수학이 맞는지 확인)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  CLASS_MAX_ITEMS,
  CLASS_MAX_QTY,
  decodeClassItems,
  encodeClassItems,
  totalSheets,
} from "../src/lib/studio-class-shared.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const idx = JSON.parse(
  readFileSync(path.join(ROOT, "public", "studio", "v2.16.0", "index.json"), "utf-8"),
);
const prv = (skey, f) =>
  path.join(ROOT, "content-private", "studio", idx.engine, skey, f);

test("공유 링크 왕복 — 인코딩→디코딩 동일, 쓰레기·중복·상한 처리", () => {
  const rows = [{ skey: "d_car", qty: 5 }, { skey: "d_dog", qty: 7 }];
  assert.equal(encodeClassItems(rows), "d_car:5,d_dog:7");
  assert.deepEqual(decodeClassItems("d_car:5,d_dog:7"), rows);

  assert.deepEqual(decodeClassItems("../etc:2,d_car:3,<x>:1"), [{ skey: "d_car", qty: 3 }]);
  assert.deepEqual(decodeClassItems("d_car:3,d_car:4"), [{ skey: "d_car", qty: 7 }]);
  assert.deepEqual(decodeClassItems(`d_car:${CLASS_MAX_QTY + 99}`),
    [{ skey: "d_car", qty: CLASS_MAX_QTY }]);
  assert.deepEqual(decodeClassItems(""), []);
  assert.deepEqual(decodeClassItems(null), []);

  const many = Array.from({ length: 30 }, (_, i) => `k${i}:1`).join(",");
  assert.equal(decodeClassItems(many).length, CLASS_MAX_ITEMS);
});

test("총 장수 계산 — UI 합계와 서버 상한이 같은 식", () => {
  const pages = { d_car: 2, d_dog: 1 };
  assert.equal(totalSheets([{ skey: "d_car", qty: 5 }, { skey: "d_dog", qty: 7 }], pages),
    2 * 5 + 1 * 7);
  assert.equal(totalSheets([{ skey: "ghost", qty: 9 }], pages), 0);
});

test("pdf-lib 실병합 — 두 모형 × 수량 = 페이지 수 정확", async () => {
  const a = idx.items.find((i) => i.skey === "d_car") ?? idx.items[0];
  const b = idx.items.find((i) => i.skey === "d_dog") ?? idx.items[1];
  const qa = 3, qb = 2;

  const merged = await PDFDocument.create();
  for (const [it, qty] of [[a, qa], [b, qb]]) {
    const src = await PDFDocument.load(readFileSync(prv(it.skey, "print.pdf")));
    assert.equal(src.getPageCount(), it.pdf_pages,
      `${it.skey}: index.json pdf_pages(${it.pdf_pages}) ≠ 실제 PDF(${src.getPageCount()})`);
    const indices = src.getPageIndices();
    for (let c = 0; c < qty; c++) {
      const pages = await merged.copyPages(src, indices);
      for (const p of pages) merged.addPage(p);
    }
  }
  assert.equal(merged.getPageCount(), a.pdf_pages * qa + b.pdf_pages * qb);
  const bytes = await merged.save();
  assert.ok(bytes.byteLength > 1000, "병합 PDF 저장 실패");
});
