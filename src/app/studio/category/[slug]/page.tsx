/**
 * /studio/category/[slug] — 카테고리별 색인 가능 랜딩 (SEO 롱테일).
 * 예: /studio/category/vehicles = "탈것 종이모형 도안 N종". 고유 title/description/
 * H1/canonical + CollectionPage/BreadcrumbList JSON-LD. 목록은 카탈로그 컴포넌트
 * 재사용(해당 카테고리 항목만) — 검색·난이도 필터는 그대로 쓸 수 있다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import StudioCatalog from "@/components/StudioCatalog";
import {
  CATEGORY_SLUG,
  categoryFromSlug,
} from "@/lib/studio";
import { getExposedItems } from "@/lib/studio-review";
import { SITE_NAME, SITE_URL, OG_IMAGE } from "@/lib/site";

export const revalidate = 300; // 검수 큐레이션 게이트 반영(ISR)

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return Object.values(CATEGORY_SLUG).map((slug) => ({ slug }));
}

/** 검수 게이트를 통과한 노출분 중 해당 카테고리 항목 */
async function itemsOf(category: string) {
  return (await getExposedItems()).filter((i) => i.category === category);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = categoryFromSlug(slug);
  if (!category) {
    return { title: "카테고리를 찾을 수 없습니다", robots: { index: false, follow: false } };
  }
  const n = (await itemsOf(category)).length;
  const title = `${category} 종이모형 도안 ${n}종`;
  const description =
    `${category} 종이모형 ${n}종 — 3D로 미리 돌려 보고, 무료 인쇄 PDF 도안을 내려받아 ` +
    `바로 만들어 보세요. 종이공예·페이퍼크래프트 전개도.`;
  return {
    title,
    description,
    alternates: { canonical: `/studio/category/${slug}` },
    openGraph: {
      images: [OG_IMAGE],
      title: `${title} | ${SITE_NAME}`,
      description,
      url: `/studio/category/${slug}`,
      type: "website",
    },
  };
}

export default async function StudioCategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = categoryFromSlug(slug);
  if (!category) notFound();
  const items = await itemsOf(category);
  if (items.length === 0) notFound();
  const n = items.length;

  const url = `${SITE_URL}/studio/category/${slug}`;
  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${category} 종이모형`,
    description: `${category} 종이공예 도안 ${n}종 — 3D 미리보기와 무료 인쇄 PDF.`,
    url,
    inLanguage: "ko-KR",
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_URL },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: n,
      itemListElement: items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: it.name_ko,
        url: `${SITE_URL}/studio/${it.skey}`,
      })),
    },
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "종이모형 스튜디오", item: `${SITE_URL}/studio` },
      { "@type": "ListItem", position: 3, name: category, item: url },
    ],
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <script type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collection) }} />
      <script type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      <nav className="mb-4 text-sm text-slate-500">
        <Link href="/studio" className="hover:underline">← 종이모형 스튜디오</Link>
      </nav>
      <header className="mb-6">
        <h1 className="text-3xl font-bold" style={{ wordBreak: "keep-all" }}>
          {category} 종이모형
          <span className="ml-2 align-middle text-base font-medium text-slate-400 tabular-nums">
            {n}종
          </span>
        </h1>
        <p className="mt-2 text-slate-600" style={{ wordBreak: "keep-all" }}>
          {category} 종이공예 도안을 3D로 미리 보고, 무료 인쇄 PDF로 내려받아 바로 만들어 보세요.
        </p>
      </header>

      <StudioCatalog items={items} />
    </main>
  );
}
