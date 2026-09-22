import type { NextConfig } from "next";

/**
 * Supabase host — 환경변수에서 추출 (없으면 알려진 호스트로 fallback).
 * NEXT_PUBLIC_SUPABASE_URL 은 빌드 시 inline 되므로 클라이언트 코드에서도 동일.
 */
const SUPABASE_HOST = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!url) return "syrfoqwvsciicfbeemqv.supabase.co";
  try {
    return new URL(url).host;
  } catch {
    return "syrfoqwvsciicfbeemqv.supabase.co";
  }
})();

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * HTTP 보안 헤더
 * - X-Frame-Options: 클릭재킹 방지
 * - X-Content-Type-Options: MIME 스니핑 방지
 * - Referrer-Policy: 외부 이동 시 referrer 제한
 * - Content-Security-Policy: XSS / 인라인 스크립트 제한
 * - Strict-Transport-Security: HTTPS 강제 (Vercel 이 자체 설정하지만 명시)
 *
 * 프로덕션에서는 'unsafe-eval' 제외 (Next.js dev/turbopack 용도만 필요).
 */
const scriptSrc = IS_PROD
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options",        value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      scriptSrc,
      // Tailwind 인라인 스타일
      "style-src 'self' 'unsafe-inline'",
      // Supabase Storage + Wikimedia Commons (파트너 로고) + Pollinations(어드민 AI 커버 생성) + data/blob.
      // 외부 스톡 사진(Unsplash)은 블로그 커버를 실제 납품 사례 사진으로 바꾸면서 제거했다 —
      // 다시 허용하면 "남의 사진"이 슬그머니 돌아온다. docs/blog-content-guide.md 참고.
      `img-src 'self' data: blob: https://${SUPABASE_HOST} https://upload.wikimedia.org https://image.pollinations.ai`,
      // Supabase API + Google OAuth
      `connect-src 'self' https://${SUPABASE_HOST} https://accounts.google.com https://oauth2.googleapis.com`,
      // 폰트
      "font-src 'self' data:",
      // iframe 완전 차단
      "frame-src 'none'",
      "frame-ancestors 'none'",
      // <object> / <embed> 차단
      "object-src 'none'",
      // base tag href 제한
      "base-uri 'self'",
      // form action 제한
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  /* remotePatterns 와 같은 Supabase 호스트를 브라우저 코드에도 넘긴다 — src/lib/image-url.ts 가
     서버·브라우저에서 같은 판정을 하게 (다르면 PortfolioGallery 가 hydration 불일치를 낸다) */
  env: { NEXT_PUBLIC_SUPABASE_HOST: SUPABASE_HOST },

  /**
   * 종이모형 스튜디오(/studio) — 인쇄용 PDF 는 유료 대상이라 public/ 이 아닌
   * content-private/ 에 두고 /api/studio/pdf/[key] 라우트가 서빙한다.
   * Vercel 서버리스 번들에 그 폴더가 포함되도록 라우트 글롭으로 명시.
   */
  outputFileTracingIncludes: {
    "/api/studio/pdf/[key]": ["./content-private/studio/**/*"],
    "/api/studio/sheet/[key]/[n]": ["./content-private/studio/**/*"],
    "/api/studio/net/[key]": ["./content-private/studio/**/*"],
    "/api/studio/class/pdf": ["./content-private/studio/**/*"],
    // DB 셋업 페이지가 누락 테이블별 SQL(schema.sql·migrations/*)을 런타임에 읽는다
    "/admin/setup": ["./supabase/**/*"],
    // 마이그레이션 실행 API 도 같은 SQL 파일을 읽어 Management API 로 보낸다.
    // 여기 빠뜨리면 번들에 .sql 이 없어 "파일을 읽을 수 없습니다" 로 실패한다.
    "/api/admin/migrate": ["./supabase/**/*"],
    // OG 이미지가 브랜드 마크 PNG 를 읽어 data URI 로 인라인한다.
    // public/ 은 함수 번들에 자동 포함되지 않으므로 명시해야 한다.
    "/opengraph-image": ["./public/brand/pe-studio-mark-512.png"],
  },

  /**
   * 이미지 최적화 — next/image 가 원본(Supabase Storage·Pollinations)을
   * WebP 로 자동 변환·리사이즈해 LCP/총 전송 바이트를 줄인다.
   * (Wikimedia 파트너 로고는 SVG 라 next/image 미적용 → 여기 미등록)
   */
  images: {
    /* Supabase 전송량 절감 (2026-09-22 무료 한도 초과로 DB 전면 차단 뒤).
       최적화 결과가 만료되면 Vercel 이 Supabase 에서 원본(1~3MB)을 다시 받아 간다 — 형식·폭마다 따로.
       · minimumCacheTTL 31일: 기본 4시간 → 원본 재요청이 약 180분의 1. 업로드 파일은 UUID 이름에
         upsert 금지라 같은 주소의 내용이 바뀌지 않으므로 오래 캐시해도 낡은 그림이 나가지 않는다.
       · WebP 한 가지: 형식마다 원본을 따로 받아 가므로 AVIF 를 빼면 첫 요청이 절반.
       · 폭 5단계: 기본 8단계(최대 3840)에서 줄였다. 1200 은 OG 이미지(src/lib/image-url.ts)가 쓴다.
       주의: 카탈로그 이미지(1780305681024.png 등)는 대시보드에서 손으로 올린 파일이다. 같은 이름으로
       교체하면 최대 31일 옛 그림이 나간다 — 새 이름으로 올리고 코드의 주소를 바꾸거나, Vercel
       대시보드에서 이미지 캐시를 지운다. */
    formats: ["image/webp"],
    minimumCacheTTL: 2_678_400,
    deviceSizes: [640, 828, 1080, 1200, 1920],
    imageSizes: [32, 48, 64, 96, 128, 256, 384],
    qualities: [75],
    remotePatterns: [
      { protocol: "https", hostname: SUPABASE_HOST },
      { protocol: "https", hostname: "image.pollinations.ai" },
    ],
  },

  /**
   * 도메인 통합 — actioncraft.co.kr (+www) → https://www.papercraft.kr 영구(308) 리다이렉트.
   *
   * 동일 콘텐츠를 두 도메인으로 서비스하면 검색 신호(링크 권위)가 분산되고 중복 콘텐츠로
   * 정본 판별이 흐려진다. 정본 도메인(papercraft.kr)으로 301/308 통합하면:
   *   · actioncraft.co.kr 에 쌓인 권위가 손실 없이 papercraft.kr 로 이전
   *   · 검색 색인·광고/분석 유입이 한 도메인으로 일원화
   * permanent:true → 308(검색엔진이 영구 캐시). 경로·쿼리(UTM/gclid)는 자동 보존된다.
   * (host 매칭이므로 papercraft.kr 요청에는 영향 없음)
   */
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "^(www\\.)?actioncraft\\.co\\.kr$" }],
        destination: "https://www.papercraft.kr/:path*",
        permanent: true,
      },
      // 무료도면(/studio) 비공개 게이트는 정적 redirect 로는 관리자까지 홈으로
      // 돌려보내 관리자 열람이 막혔다 → src/proxy.ts 로 이관(세션 보고 갈라줌).
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
