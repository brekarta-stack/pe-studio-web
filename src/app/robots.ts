import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * 생성형 AI(LLM) 검색·학습 크롤러 — 검색 답변에 인용되도록 명시적으로 허용한다 (GEO).
 * (관리/내부 API 경로는 일반 봇과 동일하게 차단)
 */
const AI_BOTS = [
  "GPTBot", // OpenAI 학습
  "OAI-SearchBot", // ChatGPT Search
  "ChatGPT-User", // ChatGPT 브라우징
  "ClaudeBot", // Anthropic 학습
  "Claude-User", // Claude 브라우징
  "anthropic-ai", // Anthropic
  "PerplexityBot", // Perplexity 색인
  "Perplexity-User", // Perplexity 브라우징
  "Google-Extended", // Google Gemini / AI Overviews
  "Applebot-Extended", // Apple Intelligence
  "CCBot", // Common Crawl (다수 LLM 학습 데이터)
];

/**
 * 일반 검색 크롤러 중 명시가 필요한 것.
 * Yeti(네이버)는 `User-Agent: *` 로도 수집되지만, 네이버 서치어드바이저 가이드가
 * 자사 봇 이름으로의 명시적 허용을 권장한다 — 국내 검색 유입이 큰 만큼 명시해 둔다.
 */
const SEARCH_BOTS = [
  "Yeti", // 네이버
  "Daumoa", // 다음(카카오)
];

export default function robots(): MetadataRoute.Robots {
  // /studio 는 품질 정비 전까지 비공개 — 크롤 차단(복구 시 이 항목 삭제, 2026-07-11)
  //
  // /download/app 은 126MB zip 으로 가는 302 다. 봇이 이걸 따라가면 다운로드 한 번당
  // 전송량이 그대로 나간다 — 2026-09-15 에 Vercel Blob 스토어를 무료 한도 초과로
  // 정지시킨 바로 그 비용이다. 사람이 버튼을 눌렀을 때만 나가야 한다.
  // (/download 페이지 자체는 색인 대상이므로 여기 넣지 않는다)
  const disallow = ["/admin/", "/api/", "/studio", "/download/app"];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...SEARCH_BOTS.map((userAgent) => ({ userAgent, allow: "/", disallow })),
      ...AI_BOTS.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
