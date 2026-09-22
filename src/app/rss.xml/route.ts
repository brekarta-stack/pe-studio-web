/**
 * /rss.xml — 블로그 RSS 2.0 피드.
 *
 * 사이트맵과 역할이 다르다. 사이트맵이 "이 사이트에 어떤 URL 이 있는지"의 전수 목록이라면
 * RSS 는 "무엇이 새로 올라왔는지"의 시간순 스트림이다. 네이버 서치어드바이저는 이 둘을
 * 별도 항목으로 받고, 신규 글 수집은 RSS 쪽이 빠르다. 블로그가 주 1회 자동 발행되므로
 * 발행 즉시 색인되도록 피드를 제공한다.
 *
 * 등록: 네이버 서치어드바이저 > 요청 > RSS 제출 에 https://www.papercraft.kr/rss.xml
 */
import { SITE_NAME, SITE_URL, BRAND_TAGLINE_KR } from "@/lib/site";
import { getPostSummaries } from "@/lib/blog";

// 1시간 캐시 — llms.txt·sitemap 과 같은 정책
export const revalidate = 3600;

/** 피드에 싣는 최근 글 수 — 리더가 훑기 좋은 분량 */
const FEED_LIMIT = 30;

/**
 * XML 텍스트 노드 이스케이프.
 * 제목·요약에 &, <, > 가 섞이면 피드 전체가 파싱 불가가 된다 — RSS 리더는
 * 관대하지 않아서 한 글자 때문에 피드가 통째로 버려진다.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RSS 2.0 의 pubDate 는 RFC-822 형식이어야 한다 (ISO-8601 이 아니다) */
function rfc822(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

export async function GET() {
  const posts = (await getPostSummaries().catch(() => []))
    .filter((p) => p.published)
    .slice(0, FEED_LIMIT);

  const lastBuild = posts.length ? rfc822(posts[0].updatedAt) : new Date().toUTCString();

  const items = posts
    .map((p) => {
      const url = `${SITE_URL}/blog/${p.slug}`;
      return `    <item>
      <title>${xmlEscape(p.title)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>
      <pubDate>${rfc822(p.createdAt)}</pubDate>
      <description>${xmlEscape(p.excerpt ?? "")}</description>${
        p.tag ? `\n      <category>${xmlEscape(p.tag)}</category>` : ""
      }
    </item>`;
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(`${SITE_NAME} 블로그`)}</title>
    <link>${xmlEscape(`${SITE_URL}/blog`)}</link>
    <description>${xmlEscape(
      `${BRAND_TAGLINE_KR} — 페이퍼 엔지니어링·팝업북·페이퍼토이 제작 지식과 사례`,
    )}</description>
    <language>ko</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${xmlEscape(`${SITE_URL}/rss.xml`)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
