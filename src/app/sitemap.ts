import type { MetadataRoute } from "next";
import { getPostSummaries } from "@/lib/blog";
import { getItems } from "@/lib/portfolio";
import { deriveSlug } from "@/lib/portfolio-meta";
import { SITE_URL } from "@/lib/site";
// 무료도면(/studio)은 품질 정비 전까지 비공개 — 사이트맵에서 제외(2026-07-11).

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE_URL;
  // 정적 페이지 신선도 신호 — 배포 시각 기준(크롤러 재방문 효율).
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, priority: 1.0, changeFrequency: "weekly" },
    { url: `${base}/about`, lastModified: now, priority: 0.8, changeFrequency: "monthly" },
    { url: `${base}/products`, lastModified: now, priority: 0.9, changeFrequency: "monthly" },
    { url: `${base}/portfolio`, lastModified: now, priority: 0.9, changeFrequency: "weekly" },
    { url: `${base}/blog`, lastModified: now, priority: 0.9, changeFrequency: "weekly" },
    { url: `${base}/quote`, lastModified: now, priority: 0.8, changeFrequency: "monthly" },
    { url: `${base}/faq`, lastModified: now, priority: 0.7, changeFrequency: "monthly" },
    { url: `${base}/download`, lastModified: now, priority: 0.7, changeFrequency: "monthly" },
    { url: `${base}/legal/privacy`, lastModified: now, priority: 0.3, changeFrequency: "yearly" },
    { url: `${base}/legal/terms`, lastModified: now, priority: 0.3, changeFrequency: "yearly" },
  ];

  const allPosts = await getPostSummaries().catch(() => []);
  const blogPages: MetadataRoute.Sitemap = allPosts
    .filter((p) => p.published)
    .map((p) => ({
      url: `${base}/blog/${p.slug}`,
      lastModified: new Date(p.updatedAt),
      priority: 0.7,
      changeFrequency: "monthly" as const,
    }));

  // 무료도면(/studio)은 비공개 처리로 사이트맵에서 제외(복구 시 되돌린다).

  const allCases = await getItems().catch(() => []);
  const portfolioPages: MetadataRoute.Sitemap = allCases
    .filter((c) => c.published)
    .map((c) => ({
      url: `${base}/portfolio/${deriveSlug(c)}`,
      lastModified: new Date(c.updatedAt),
      priority: 0.8,
      changeFrequency: "monthly" as const,
    }));

  return [...staticPages, ...blogPages, ...portfolioPages];
}
