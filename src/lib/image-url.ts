/**
 * Supabase 공개 이미지 주소 → Vercel 이미지 최적화 주소.
 *
 * 2026-09-22 Supabase 무료 플랜의 "캐시 전송량"(6.7/5GB)이 넘쳐 DB 까지 통째로 막혔다.
 * 원본(1~3MB)을 방문자·크롤러가 Supabase 에서 직접 받아 가는 곳이 원인이었다 —
 * OG 이미지(카카오·슬랙·페이스북 미리보기), 구조화 데이터의 image(구글 이미지 수집) 같은 곳.
 *
 * 이 주소를 쓰면 Vercel 이 한 번 줄여서 캐시해 두고(next.config 의 minimumCacheTTL) 계속
 * 내준다. Supabase 에서는 크기·형식별로 한 달에 한 번만 원본을 받아 간다.
 * 폭(w)·품질(q)은 next.config 의 deviceSizes·qualities 에 있는 값이어야 한다 — 없으면 400.
 */

/** 오픈그래프 권장 폭 — next.config deviceSizes 에 반드시 포함돼 있어야 한다 */
export const OG_IMAGE_WIDTH = 1200;
/** next.config qualities 에 포함된 값 */
export const IMAGE_QUALITY = 75;

/**
 * 우리 Supabase 호스트 — next.config 의 remotePatterns 와 같은 값이어야 한다.
 * 다른 프로젝트 주소까지 바꾸면 최적화기가 400 을 낸다.
 */
const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_HOST || "syrfoqwvsciicfbeemqv.supabase.co";

export function isSupabasePublicImage(src: string | null | undefined): src is string {
  if (typeof src !== "string") return false;
  try {
    const u = new URL(src);
    return u.protocol === "https:" && u.host === SUPABASE_HOST && u.pathname.startsWith("/storage/v1/object/public/");
  } catch {
    return false;
  }
}

/** next/image 로 그려도 되는 주소인가 — 우리 사이트 정적 파일이거나 우리 Supabase 공개 객체 */
export function canUseNextImage(src: string | null | undefined): src is string {
  // "//host/…" 는 다른 사이트 주소다 — 정적 파일로 착각하지 않게 뺀다
  return typeof src === "string" && ((src.startsWith("/") && !src.startsWith("//")) || isSupabasePublicImage(src));
}

/**
 * Supabase 공개 객체면 Vercel 이미지 최적화 주소로 바꾼다. 그 밖의 주소(우리 사이트 정적 파일,
 * /opengraph-image 등)는 그대로 둔다. OG·JSON-LD 는 절대 주소여야 하므로 사이트 주소를 붙인다.
 */
export function viaImageOptimizer(src: string, siteUrl: string, width: number = OG_IMAGE_WIDTH): string {
  if (!isSupabasePublicImage(src)) return src;
  const base = siteUrl.trim().replace(/\/+$/, "");
  return `${base}/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${IMAGE_QUALITY}`;
}
