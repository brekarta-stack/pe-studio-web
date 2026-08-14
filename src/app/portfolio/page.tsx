import type { Metadata } from "next";
import { getItems, CATEGORIES } from "@/lib/portfolio";
import { deriveSlug, deriveSummary } from "@/lib/portfolio-meta";
import PortfolioGallery from "@/components/PortfolioGallery";
import PageHero from "@/components/PageHero";
import { PAGE_META, SITE_NAME, SITE_URL, OG_IMAGE } from "@/lib/site";
import { PaperNetBg } from "@/components/paper-art";
import { ArrowRightIcon } from "@/components/icons";

// SSR — 어드민 변경이 즉시 반영되도록 force-dynamic
// (ISR 5분 캐시는 어드민과의 sync 불일치 + Suspense 무한 fallback 문제 일으킴)
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: PAGE_META.portfolio.title,
  description: PAGE_META.portfolio.description,
  alternates: { canonical: "/portfolio" },
  openGraph: {
    images: [OG_IMAGE],
    title: PAGE_META.portfolio.title,
    description: PAGE_META.portfolio.description,
    url: "/portfolio",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_META.portfolio.title,
    description: PAGE_META.portfolio.description,
  },
};

/**
 * 포트폴리오 페이지 ItemList / CreativeWork JSON-LD.
 * 검색엔진이 어떤 사례들을 다루는지 파악하도록 ItemList 로 묶음.
 */
function PortfolioJsonLd({
  items,
}: {
  items: { title: string; slug?: string; description?: string; image?: string; client?: string }[];
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Paper Engineering Studio 작업 포트폴리오",
    url: `${SITE_URL}/portfolio`,
    numberOfItems: items.length,
    itemListElement: items.slice(0, 50).map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      url: item.slug ? `${SITE_URL}/portfolio/${item.slug}` : undefined,
      item: {
        "@type": "CreativeWork",
        name: item.title,
        headline: item.client ? `${item.client} · ${item.title}` : item.title,
        creator: { "@type": "Organization", name: SITE_NAME },
        ...(item.description ? { description: item.description } : {}),
        ...(item.slug ? { url: `${SITE_URL}/portfolio/${item.slug}` } : {}),
        ...(item.image ? { image: item.image } : {}),
      },
    })),
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default async function PortfolioPage() {
  // 빌드 시 Supabase env 없거나 일시 에러면 빈 배열로 안전 fallback (ISR 로 첫 요청 시 채워짐)
  const items = (await getItems().catch(() => [])).filter((i) => i.published);

  // JSON-LD 용 — slug / description / image 포함
  const jsonLdItems = items.map((it) => ({
    title: it.title,
    slug: deriveSlug(it),
    description: deriveSummary(it),
    image: it.images?.[0],
    client: it.client,
  }));

  // 클라이언트로 전달 — Gallery 컴포넌트에서 slug 로 상세 페이지 링크
  const itemsWithSlug = items.map((it) => ({ ...it, slug: deriveSlug(it) }));

  return (
    <>
      <PortfolioJsonLd items={jsonLdItems} />
      {/* Hero */}
      <PageHero
        eyebrow="작업 포트폴리오"
        title={<span className="pe-gradient-text">작업 포트폴리오</span>}
        subtitle="2013년부터 우리가 만들어 온 대표 작업들입니다."
      />

      {/* Gallery with filter */}
      <section className="py-16 md:py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PortfolioGallery items={itemsWithSlug} categories={[...CATEGORIES]} />
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 md:py-20 relative overflow-hidden" style={{ background: "#1E22B2" }}>
        <div className="absolute inset-0 pointer-events-none opacity-20 flex items-center justify-center">
          <div className="w-full max-w-2xl"><PaperNetBg className="w-full h-auto" /></div>
        </div>
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-4 tracking-tight">
            비슷한 작업을 의뢰하고 싶으신가요?
          </h2>
          <p className="text-blue-200 mb-8" style={{ wordBreak: "keep-all" }}>
            지기구조 전문 설계 페이퍼 엔지니어링 스튜디오에게 직접 문의해 보세요. 3영업일 이내 회신 드립니다.
          </p>
          <a
            href="/quote"
            className="group inline-flex items-center gap-2 px-8 py-4 font-bold rounded-xl text-white text-lg shadow-xl shadow-pink-500/30 hover:-translate-y-0.5 transition-all"
            style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
          >
            무료 견적 받기
            <ArrowRightIcon size={20} className="transition-transform group-hover:translate-x-1" />
          </a>
        </div>
      </section>
    </>
  );
}

