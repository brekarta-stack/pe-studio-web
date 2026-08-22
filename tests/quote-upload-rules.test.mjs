/**
 * 제작 문의 첨부 규칙 테스트 (node --test)
 *   node --test tests/quote-upload-rules.test.mjs
 *
 * 폼에서 고를 수 있는 형식과 서버가 받는 형식이 어긋나면, 고객은 파일을 고를 수는
 * 있는데 업로드만 실패한다 — 원인을 알 수 없는 오류가 된다. 두 목록이 한 곳에서
 * 나오는지, 그리고 아이폰 사진(.heic)·로고 원본(.ai)이 막히지 않는지 못 박는다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  LOGO_ACCEPT,
  UPLOAD_ACCEPT,
  UPLOAD_EXT_MIME,
  UPLOAD_MAX_BYTES,
  fileExt,
  magicOk,
} from "../src/lib/upload-rules.ts";

test("폼이 고를 수 있는 형식 = 서버가 받는 형식", () => {
  for (const ext of UPLOAD_ACCEPT.split(",")) {
    assert.ok(UPLOAD_EXT_MIME[ext], `accept 에는 있는데 서버가 안 받는다: ${ext}`);
  }
});

test("로고 accept 도 전부 서버가 받는 형식이다", () => {
  for (const ext of LOGO_ACCEPT.split(",")) {
    assert.ok(UPLOAD_EXT_MIME[ext], `로고 accept 에만 있는 형식: ${ext}`);
  }
});

test("아이폰 사진(.heic)을 받는다 — 예전에는 '허용되지 않는 파일 형식'", () => {
  assert.equal(UPLOAD_EXT_MIME[".heic"], "image/heic");
  assert.equal(UPLOAD_EXT_MIME[".heif"], "image/heif");
  // ISO-BMFF 헤더: 4바이트 박스 길이 + 'ftyp'
  const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  assert.equal(magicOk(".heic", heic), true);
  assert.equal(magicOk(".heic", new Uint8Array(12)), false, "ftyp 가 없으면 거절");
});

test("로고 원본(.ai)·인쇄용 PDF 가 용량으로 막히지 않는다", () => {
  // 예전 상한 4MB 는 대부분의 .ai 로고를 막았다. Vercel 본문 한도는 이제 100MB.
  assert.ok(UPLOAD_MAX_BYTES >= 20 * 1024 * 1024, "20MB 이상이어야 한다");
  assert.ok(UPLOAD_MAX_BYTES <= 100 * 1024 * 1024, "플랫폼 본문 한도 안쪽이어야 한다");
});

test("확장자만 바꿔 올린 파일은 매직 바이트에서 걸린다", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(magicOk(".png", png), true);
  assert.equal(magicOk(".png", new Uint8Array([0xff, 0xd8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
  assert.equal(magicOk(".jpg", new Uint8Array([0xff, 0xd8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(magicOk(".pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(magicOk(".exe", new Uint8Array(12)), false, "모르는 확장자는 거절");
});

test("확장자 추출 — 경로·대문자·숨김파일", () => {
  assert.equal(fileExt("로고.AI"), ".ai");
  assert.equal(fileExt("C:\\\\Users\\\\me\\\\사진.HEIC"), ".heic");
  assert.equal(fileExt("/tmp/a/b.png"), ".png");
  assert.equal(fileExt(".gitignore"), "", "숨김파일은 확장자가 아니다");
  assert.equal(fileExt("확장자없음"), "");
  assert.equal(fileExt(undefined), "");
});

test("폼과 라우트가 상수를 직접 적어 두지 않는다", async () => {
  const form = await readFile(new URL("../src/components/QuoteForm.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../src/app/api/quote/upload/route.ts", import.meta.url), "utf8");
  assert.ok(form.includes("accept={UPLOAD_ACCEPT}"), "폼 accept 는 공용 상수를 써야 한다");
  assert.ok(form.includes("accept={LOGO_ACCEPT}"));
  assert.ok(!/accept="\.[a-z]/.test(form), "하드코딩된 accept 가 남아 있으면 서버와 어긋난다");
  assert.ok(route.includes("UPLOAD_EXT_MIME"), "라우트도 같은 목록을 써야 한다");
  assert.ok(!route.includes("const EXT_MIME"), "라우트에 사본이 남으면 안 된다");
});
