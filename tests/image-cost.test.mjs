/**
 * Supabase 전송량 절감 가드 (node --test)
 *
 * 2026-09-22 Supabase 무료 플랜의 캐시 전송량(6.7/5GB)이 넘쳐 DB 까지 전면 차단됐다.
 * 원본 이미지를 방문자·크롤러·Vercel 최적화기가 Supabase 에서 자주 받아 간 것이 원인.
 * 여기 가드가 풀리면 같은 일이 다시 난다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { IMAGE_QUALITY, OG_IMAGE_WIDTH, canUseNextImage, isSupabasePublicImage, viaImageOptimizer } from "../src/lib/image-url.ts";

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8");
const SB = "https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/uploads/2059fef7-b689-4241-8999-0ad470766959.jpg";

test("Supabase 공개 이미지만 Vercel 최적화 주소로 바꾼다", () => {
  assert.equal(
    viaImageOptimizer(SB, "https://www.papercraft.kr"),
    `https://www.papercraft.kr/_next/image?url=${encodeURIComponent(SB)}&w=1200&q=75`,
  );
  // 주소 끝의 줄바꿈·슬래시 (운영 환경변수 사고) 를 견딘다
  assert.ok(viaImageOptimizer(SB, "https://www.papercraft.kr/\n").startsWith("https://www.papercraft.kr/_next/image?url="));
  // 사이트 주소 없이 쓰면 같은 사이트 상대 주소
  assert.ok(viaImageOptimizer(SB, "").startsWith("/_next/image?url="));
  // 우리 사이트·외부 이미지는 그대로
  for (const u of ["https://www.papercraft.kr/opengraph-image", "/home/studio-1.jpg", "https://image.pollinations.ai/x.png", "https://evil.supabase.co.attacker.io/storage/v1/object/public/a.png"]) {
    assert.equal(viaImageOptimizer(u, "https://www.papercraft.kr"), u);
  }
  assert.equal(isSupabasePublicImage(null), false);
  // 비공개(서명) 주소는 바꾸지 않는다 — 최적화기가 캐시해 버리면 안 된다
  assert.equal(isSupabasePublicImage("https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/sign/uploads/a.png?token=t"), false);
  // 다른 Supabase 프로젝트는 remotePatterns 밖 — 바꾸면 최적화기가 400
  assert.equal(isSupabasePublicImage("https://otherproject.supabase.co/storage/v1/object/public/uploads/a.png"), false);
});

test("next/image 로 그려도 되는 주소 — 우리 정적 파일·우리 Supabase 만", () => {
  assert.equal(canUseNextImage("/home/studio-1.jpg"), true);
  assert.equal(canUseNextImage(SB), true);
  assert.equal(canUseNextImage("//evil.example/a.png"), false);
  assert.equal(canUseNextImage("https://upload.wikimedia.org/a.png"), false);
  assert.equal(canUseNextImage(undefined), false);
});

test("next.config: 최적화 캐시 31일·WebP 한 가지·OG 폭과 품질이 허용 목록에 있다", () => {
  const cfg = src("next.config.ts");
  const ttl = Number(/minimumCacheTTL:\s*([\d_]+)/.exec(cfg)[1].replace(/_/g, ""));
  assert.ok(ttl >= 30 * 24 * 3600, `minimumCacheTTL ${ttl}s`);
  assert.match(cfg, /formats:\s*\["image\/webp"\]/);
  const device = /deviceSizes:\s*\[([^\]]+)\]/.exec(cfg)[1].split(",").map((n) => Number(n.trim()));
  assert.ok(device.includes(OG_IMAGE_WIDTH), "OG 폭이 deviceSizes 에 없으면 /_next/image 가 400");
  const q = /qualities:\s*\[([^\]]+)\]/.exec(cfg)[1].split(",").map((n) => Number(n.trim()));
  assert.ok(q.includes(IMAGE_QUALITY));
});

test("견적·제품 페이지 카탈로그와 포트폴리오 카드는 원본을 직접 받지 않는다 (next/image)", () => {
  const cat = src("src/components/ProductCatalogTabs.tsx");
  assert.ok(!/<img\b/.test(cat), "raw <img> 는 방문자마다 Supabase 원본을 받는다");
  assert.match(cat, /import Image from "next\/image"/);
  // /quote 는 ProductCatalogTabs 가 아니라 QuoteForm 이 같은 카탈로그를 그린다
  const qf = src("src/components/QuoteForm.tsx");
  assert.match(qf, /<Image\s+src=\{product\.image\}/);
  assert.match(qf, /<Image\s+src=\{usage\.image\}/);
  assert.ok(!/<img\s+src=\{(product|usage)\.image\}/.test(qf));
  const pg = src("src/components/PortfolioGallery.tsx");
  assert.match(pg, /if \(canUseNextImage\(src\)\)/);
  assert.ok(!/<img\s+src=\{item\.images/.test(pg));
});

test("블로그·포트폴리오의 OG·구조화 데이터·본문 이미지는 최적화 주소를 거친다", () => {
  const blog = src("src/app/blog/[slug]/page.tsx");
  assert.match(blog, /const ogImage = viaImageOptimizer\(/);
  assert.match(blog, /image: \[viaImageOptimizer\(/);
  // 에디터의 정렬·크기 class 를 버리지 않게 나머지 속성을 넘긴다
  assert.match(blog, /img: \(\{ node: _node, src, alt, \.\.\.rest \}\)[\s\S]{0,200}\{\.\.\.rest\}[\s\S]{0,120}viaImageOptimizer\(src, ""\)/);
  const pf = src("src/app/portfolio/[slug]/page.tsx");
  assert.match(pf, /const ogImage = item\.images\?\.\[0\] \? viaImageOptimizer\(/);
  assert.match(pf, /url: viaImageOptimizer\(u, SITE_URL\)/);
  assert.match(src("src/app/portfolio/page.tsx"), /image: it\.images\?\.\[0\] \? viaImageOptimizer\(/);
});

test("공개 콘텐츠 업로드는 1년 캐시, 고객 첨부는 캐시 없이 — 모두 덮어쓰기 없음 (긴 캐시가 안전한 전제)", () => {
  for (const f of ["src/app/api/upload/route.ts", "src/app/api/blog/publish/route.ts", "src/app/api/portfolio/sync/route.ts"]) {
    assert.match(src(f), /cacheControl: "31536000"/, f);
  }
  // 고객·작가 첨부는 공개 페이지에 안 나가 절감 효과가 없고, 지운 뒤에도 캐시에 오래 남는다
  for (const f of ["src/app/api/quote/upload/route.ts", "src/app/api/artist/upload/route.ts"]) {
    assert.ok(!/cacheControl: "31536000"/.test(src(f)), f);
  }
  for (const f of [
    "src/app/api/upload/route.ts",
    "src/app/api/quote/upload/route.ts",
    "src/app/api/artist/upload/route.ts",
    "src/app/api/blog/publish/route.ts",
    "src/app/api/portfolio/sync/route.ts",
  ]) {
    assert.ok(!/upsert:\s*true/.test(src(f)), `${f} 가 같은 이름을 덮어쓰면 31일 캐시가 낡은 그림을 내보낸다`);
  }
});

test("Supabase 호스트는 next.config 가 한 곳에서 서버·브라우저에 같이 넘긴다", () => {
  assert.match(src("next.config.ts"), /env: \{ NEXT_PUBLIC_SUPABASE_HOST: SUPABASE_HOST \}/);
  assert.match(src("src/lib/image-url.ts"), /process\.env\.NEXT_PUBLIC_SUPABASE_HOST/);
});
