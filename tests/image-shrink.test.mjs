/**
 * 이미 올라간 원본 줄이기 + 목록 조회 경량화 (node --test)
 *   - 판단 규칙: 고객 첨부·납품물 폴더는 절대 건드리지 않는다, GIF·SVG·움직이는 이미지는 건너뛴다
 *   - 실제 sharp 처리: 1920 이하로 줄고, 형식이 그대로이고, EXIF 방향이 반영된다
 *   - 목록 화면은 본문 없는 글 목록을 쓴다
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import sharp from "sharp";

import {
  MAX_BATCH,
  MAX_EDGE,
  MIN_BYTES,
  SHRUNK_MARK,
  cacheSecondsOf,
  clampBatch,
  formatOf,
  isAlreadyExists,
  isAnimatedPng,
  isLosslessWebp,
  isOurShrunkCopy,
  planAfterMetadata,
  planObject,
  worthReplacing,
} from "../src/lib/image-shrink.ts";
import { shrinkBuffer } from "../src/lib/image-shrink-run.ts";

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8");

test("폴더 안 파일(고객 첨부·납품물)은 절대 다루지 않는다", () => {
  for (const name of ["quote/abc.png", "deliverable/artist-1/x.jpg", "a/b.webp"]) {
    assert.equal(planObject({ name, size: 5_000_000, contentType: "image/png" }).action, "skip", name);
  }
});

test("형식 판단 — JPEG/PNG/WebP 만, GIF·SVG·PDF 는 제외", () => {
  assert.equal(formatOf("a.jpg", "image/jpeg"), "jpeg");
  assert.equal(formatOf("a.png", null), "png");
  assert.equal(formatOf("a.webp", "application/octet-stream"), "webp");
  assert.equal(formatOf("a.gif", "image/gif"), null);
  assert.equal(formatOf("a.svg", "image/svg+xml"), null);
  assert.equal(formatOf("a.pdf", "application/pdf"), null);
  assert.equal(formatOf("a.png", "image/gif"), null); // 확장자보다 실제 형식을 믿는다
});

test("작은 파일·움직이는 이미지·이미 작은 해상도는 건너뛴다", () => {
  assert.equal(planObject({ name: "a.jpg", size: MIN_BYTES - 1, contentType: "image/jpeg" }).action, "skip");
  assert.deepEqual(planObject({ name: "a.jpg", size: MIN_BYTES, contentType: "image/jpeg" }), { action: "process", format: "jpeg" });
  assert.equal(planAfterMetadata({ width: 3000, height: 2000, pages: 5 }, 5_000_000)?.action, "skip");
  assert.equal(planAfterMetadata({ width: 1200, height: 800 }, MIN_BYTES + 1)?.action, "skip");
  assert.equal(planAfterMetadata({ width: 3000, height: 2000 }, 2_000_000), null);
  // 해상도는 작아도 파일이 아주 크면(무압축 PNG 등) 재압축한다
  assert.equal(planAfterMetadata({ width: 1500, height: 1000 }, MIN_BYTES * 3), null);
});

test("15% 이상 줄 때만 바꾼다 · 한 번에 처리하는 개수는 상한 안", () => {
  assert.equal(worthReplacing(1000, 850), true);
  assert.equal(worthReplacing(1000, 851), false);
  assert.equal(worthReplacing(1000, 0), false);
  assert.equal(clampBatch(100), MAX_BATCH);
  assert.equal(clampBatch(0), 1);
  assert.equal(clampBatch("x"), MAX_BATCH);
});

/** 압축이 잘 안 되는 큰 사진 흉내 — 무작위 잡음 */
function noise(width, height, channels = 3) {
  const raw = Buffer.alloc(width * height * channels);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width, height, channels } });
}

test("큰 JPEG → 폭 1920, JPEG 그대로, 비율 유지, 더 작아진다", async () => {
  const input = await noise(4000, 3000).jpeg({ quality: 95 }).toBuffer();
  const res = await shrinkBuffer(input, "jpeg", input.length);
  assert.ok("out" in res);
  const m = await sharp(res.out).metadata();
  assert.equal(m.format, "jpeg");
  assert.equal(m.width, MAX_EDGE);
  assert.equal(m.height, 1440);
  assert.ok(res.out.length < input.length, `${res.out.length} < ${input.length}`);
});

test("세로로 긴 그림(인포그래픽·전개도)은 높이로 묶지 않는다 — 폭이 뭉개지지 않게", async () => {
  // 폭 1200 이면 사이트가 쓰는 폭보다 작다 — 폭은 그대로, 높이도 그대로 (재압축만)
  const tall = await noise(1200, 6000).jpeg({ quality: 97 }).toBuffer();
  const res = await shrinkBuffer(tall, "jpeg");
  if ("out" in res) {
    const m = await sharp(res.out).metadata();
    assert.equal(m.width, 1200);
    assert.equal(m.height, 6000);
  }
  // 폭이 넓으면 폭만 1920 으로, 비율 그대로
  const wideTall = await noise(2400, 7200).jpeg({ quality: 95 }).toBuffer();
  const res2 = await shrinkBuffer(wideTall, "jpeg");
  assert.ok("out" in res2);
  const m2 = await sharp(res2.out).metadata();
  assert.equal(m2.width, MAX_EDGE);
  assert.equal(m2.height, 5760);
});

test("무손실 WebP·APNG·형식 불일치·잘린 파일·크기 불일치는 건드리지 않는다", async () => {
  const lossless = await noise(2600, 2000).webp({ lossless: true }).toBuffer();
  assert.equal(isLosslessWebp(lossless), true);
  assert.ok("skip" in (await shrinkBuffer(lossless, "webp")));
  const lossy = await noise(2600, 2000).webp({ quality: 95 }).toBuffer();
  assert.equal(isLosslessWebp(lossy), false);
  // ICC 가 붙은 무손실 WebP — 첫 청크가 VP8X 라 청크를 훑어야 보인다
  const losslessIcc = await noise(2600, 2000).webp({ lossless: true }).withIccProfile("p3").toBuffer();
  assert.equal(String.fromCharCode(...losslessIcc.subarray(12, 16)), "VP8X");
  assert.equal(isLosslessWebp(losslessIcc), true);
  assert.ok("skip" in (await shrinkBuffer(losslessIcc, "webp")));
  const lossyIcc = await noise(2600, 2000).webp({ quality: 95 }).withIccProfile("p3").toBuffer();
  assert.equal(isLosslessWebp(lossyIcc), false);
  assert.equal(isLosslessWebp(Buffer.from("not a webp at all, just bytes")), false);

  // APNG: acTL 청크가 IDAT 앞에 있으면 움직이는 PNG
  const png = await noise(64, 64).png().toBuffer();
  assert.equal(isAnimatedPng(png), false);
  const actl = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from("acTL"), Buffer.alloc(8), Buffer.alloc(4)]);
  const apng = Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)]); // 시그니처(8)+IHDR(25) 뒤
  assert.equal(isAnimatedPng(apng), true);
  assert.ok("skip" in (await shrinkBuffer(apng, "png")));

  // 이름·타입은 PNG 인데 내용은 JPEG — 형식을 바꿔 덮어쓰지 않는다
  const jpeg = await noise(3000, 2000).jpeg({ quality: 95 }).toBuffer();
  assert.ok("skip" in (await shrinkBuffer(jpeg, "png")));
  // 끝이 잘린 파일
  assert.ok("skip" in (await shrinkBuffer(jpeg.subarray(0, Math.floor(jpeg.length / 2)), "jpeg")));
  // 목록의 크기와 받은 크기가 다르면(받는 도중 끊김 등) 건드리지 않는다
  assert.ok("skip" in (await shrinkBuffer(jpeg, "jpeg", jpeg.length + 1)));
});

test("우리 판 판단은 표식 + 줄인 크기 · 캐시 시간은 원래 값 유지 · 이상한 이름은 건너뜀", () => {
  const meta = { shrunk: SHRUNK_MARK, originalBytes: 3_000_000, shrunkBytes: 420_000 };
  assert.equal(isOurShrunkCopy(meta, 420_000), true);
  // 대시보드로 같은 이름에 새 파일을 올리면 표식은 남고 크기가 달라진다 — 우리 판이 아니다
  assert.equal(isOurShrunkCopy(meta, 1_234_567), false);
  assert.equal(isOurShrunkCopy({ shrunk: SHRUNK_MARK }, 420_000), false); // 크기 기록 없음
  assert.equal(isOurShrunkCopy({ shrunk: "other" , shrunkBytes: 1 }, 1), false);
  assert.equal(isOurShrunkCopy(null, 1), false);
  assert.equal(cacheSecondsOf("max-age=3600"), "3600");
  assert.equal(cacheSecondsOf("public, max-age=86400"), "86400");
  assert.equal(cacheSecondsOf(undefined), "3600");
  for (const name of ["a?b.jpg", "a#b.png", "a%20b.webp"]) {
    assert.equal(planObject({ name, size: 5_000_000, contentType: "image/jpeg" }).action, "skip", name);
  }
});

test("이미 있음 판단은 상태 코드로", () => {
  assert.equal(isAlreadyExists({ statusCode: "409", message: "x" }), true);
  assert.equal(isAlreadyExists({ status: 409 }), true);
  assert.equal(isAlreadyExists({ message: "The resource already exists" }), true);
  assert.equal(isAlreadyExists({ status: 400, statusCode: "400", message: "Invalid key" }), false);
  assert.equal(isAlreadyExists(null), false);
});

test("투명 PNG → PNG 그대로, 알파 유지, 1920 이하", async () => {
  const input = await noise(2600, 2600, 4).png().toBuffer();
  const res = await shrinkBuffer(input, "png");
  assert.ok("out" in res);
  const m = await sharp(res.out).metadata();
  assert.equal(m.format, "png");
  assert.equal(m.hasAlpha, true);
  assert.ok(m.width <= MAX_EDGE && m.height <= MAX_EDGE);
});

test("EXIF 방향(세로 사진)이 픽셀에 반영돼 돌아가지 않는다", async () => {
  // 가로로 저장된 4000×2500 + orientation 6(90° 회전) → 실제 보이는 모양은 세로
  const input = await noise(4000, 2500).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
  const res = await shrinkBuffer(input, "jpeg");
  assert.ok("out" in res);
  const m = await sharp(res.out).metadata();
  assert.ok(m.height > m.width, `세로여야 한다: ${m.width}×${m.height}`);
  assert.equal(m.orientation ?? 1, 1);
});

test("CMYK JPEG 는 내장 프로파일로 sRGB 변환 — 기본 CMYK 로 바뀌어 색이 틀어지지 않게", async () => {
  const input = await noise(2600, 2000).toColourspace("cmyk").jpeg({ quality: 95 }).toBuffer();
  assert.equal((await sharp(input).metadata()).space, "cmyk");
  const res = await shrinkBuffer(input, "jpeg");
  assert.ok("out" in res);
  assert.equal((await sharp(res.out).metadata()).space, "srgb");
  assert.match(src("src/lib/image-shrink-run.ts"), /if \(meta\.space !== "cmyk"\) pipe = pipe\.keepIccProfile\(\);/);
});

test("해상도가 작으면 건너뛴다 (재압축만으로는 얻는 게 적다)", async () => {
  const input = await noise(800, 600).jpeg({ quality: 95 }).toBuffer();
  const res = await shrinkBuffer(input, "jpeg");
  assert.ok("skip" in res);
});

test("관리자 전용·원본 보관 후 덮어쓰기·표식·되돌리기 조건이 지켜진다", () => {
  const r = src("src/app/api/admin/maintenance/shrink-images/route.ts");
  assert.match(r, /const guard = await requireAdminApi\(\);\s*if \(guard\) return guard;/);
  const iBackup = r.indexOf(".upload(e.name, buf, { contentType, upsert: false");
  const iCompare = r.indexOf("sha256(kept) !== sha256(buf)");
  const iUpdate = r.indexOf(".from(SHRINK_BUCKET).update(e.name, res.out");
  assert.ok(iBackup > 0 && iCompare > iBackup && iUpdate > iCompare, "보관 → (이미 있으면 내용 비교) → 덮어쓰기 순서");
  const updateCall = r.slice(iUpdate, iUpdate + 300);
  assert.match(updateCall, /metadata: \{ shrunk: SHRUNK_MARK[^}]*shrunkBytes: res\.out\.length/, "줄인 파일에 표식과 줄인 크기를 남긴다");
  assert.match(updateCall, /cacheControl: e\.cacheSeconds/, "원래 캐시 시간을 유지한다");
  assert.ok(!/31536000/.test(r), "캐시 시간을 1년으로 바꾸지 않는다");
  assert.match(r, /upload\(e\.name, buf, \{ contentType, upsert: false, cacheControl: e\.cacheSeconds \}\)/, "보관본도 원래 캐시 시간으로");
  assert.match(r, /i > 0 && Date\.now\(\) - started > TIME_BUDGET_MS/, "첫 파일은 반드시 처리 — 같은 자리 무한 반복 방지");
  assert.ok(!/upsert: true/.test(r), "보관본을 덮어쓰지 않는다");
  assert.match(r, /if \(!e\.id\)/); // 폴더는 들어가지 않는다
  assert.match(r, /TIME_BUDGET_MS/);

  // 미리 보기는 내려받지 않는다 — 대상 판단 전에 candidate 로 끝나야 한다
  const iDry = r.indexOf('if (mode === "dry-run") {');
  const iFirstApplyDownload = r.indexOf("await download(SHRINK_BUCKET, e.name);", r.indexOf("const plan = planObject("));
  assert.ok(iDry > 0 && iFirstApplyDownload > iDry, "dry-run 이 내려받기보다 먼저 끝난다");
  assert.match(r.slice(iDry, iDry + 200), /action: "candidate"[\s\S]*continue;/);

  // 되돌리기: 표식이 있거나 내용이 우리 판과 같을 때만, 원본 자리에 없으면 되살리지 않는다
  const restore = r.slice(r.indexOf('if (mode === "restore") {'), r.indexOf("const plan = planObject("));
  assert.match(restore, /mark === "missing"/);
  assert.match(restore, /mark === "restored"[\s\S]*?이미 되돌림/);
  assert.match(restore, /let ours = mark === "ours"/);
  assert.match(r, /isOurShrunkCopy\(d\.metadata, size\)/, "표식만이 아니라 크기까지 본다");
  assert.match(restore, /if \(!ours\) \{\s*results\.push\(\{[^}]*action: "skip"/);
  assert.ok(restore.indexOf("if (!ours) {\n          results.push") < restore.indexOf(".update(e.name, original"));
  assert.equal(SHRUNK_MARK, "shrink-images/v1");
});

test("목록 화면은 본문 없는 글 목록을 쓴다 (글마다 모든 본문을 받지 않게)", () => {
  const blog = src("src/lib/blog.ts");
  const cols = /const SUMMARY_COLUMNS =\s*"([^"]+)"/.exec(blog)[1];
  assert.ok(!/\bcontent\b/.test(cols), "요약 칸에 본문이 들어가면 안 된다");
  // 뒤에 마이그레이션으로 붙은 칸은 없는 DB 가 있다 — 없으면 목록 전체가 시드 글로 떨어진다
  assert.ok(!/queued|auto_published_at/.test(cols), "선택 칸(queued·auto_published_at)을 목록 조회에 넣지 않는다");
  for (const f of ["src/app/blog/page.tsx", "src/app/blog/[slug]/page.tsx", "src/app/sitemap.ts", "src/app/rss.xml/route.ts", "src/app/llms.txt/route.ts"]) {
    const t = src(f);
    assert.match(t, /getPostSummaries\(/, f);
    assert.ok(!/\bgetPosts\(/.test(t), `${f} 가 본문 포함 전체 목록을 부른다`);
  }
});

test("포트폴리오 case- 주소는 id 만 받아 찾는다 · 관리자 썸네일은 작은 판", () => {
  const pf = src("src/lib/portfolio.ts");
  assert.ok(!/from\("portfolio_items"\)\.select\("\*"\);/.test(pf), "전체 행(*)을 조건 없이 받지 않는다");
  assert.match(pf, /select\("id"\)/);
  for (const f of ["src/components/admin/AdminArtistList.tsx", "src/components/admin/AdminPortfolioList.tsx"]) {
    assert.match(src(f), /viaImageOptimizer\([^)]*, "", 256\)/, f);
  }
  // 256 은 next.config imageSizes 에 있어야 400 이 안 난다
  assert.match(src("next.config.ts"), /imageSizes:\s*\[[^\]]*\b256\b/);
});
