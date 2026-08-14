import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getItemBySlug, getItems } from "@/lib/portfolio";
import { deriveSlug, deriveSummary, getAllKeywords, getImageAlt } from "@/lib/portfolio-meta";
import { derivePortfolioFaq } from "@/lib/portfolio-faq";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { ArrowRightIcon } from "@/components/icons";
import { PaperNetBg } from "@/components/paper-art";

// ISR: 5분 캐시, 새 사례 추가 시 자동 갱신
export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string }>;
}

/** 빌드 시점에 알려진 모든 사례를 prerender → 검색엔진 크롤링 효율 ↑ */
export async function generateStaticParams() {
  try {
    const items = (await getItems()).filter((i) => i.published);
    return items.map((it) => ({ slug: deriveSlug(it) }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = await getItemBySlug(slug);
  if (!item || !item.published) {
    return {
      title: "사례를 찾을 수 없습니다",
      robots: { index: false, follow: false },
    };
  }

  const summary = deriveSummary(item);
  const keywords = getAllKeywords(item);
  const ogImage = item.images?.[0];
  const titleSuffix = item.client ? `${item.client} · ${item.title}` : item.title;

  return {
    title: titleSuffix,
    description: summary,
    keywords,
    alternates: { canonical: `/portfolio/${deriveSlug(item)}` },
    openGraph: {
      title: `${titleSuffix} | ${SITE_NAME}`,
      description: summary,
      url: `/portfolio/${deriveSlug(item)}`,
      type: "article",
      images: ogImage
        ? [{ url: ogImage, alt: getImageAlt(item, 0), width: 1200, height: 800 }]
        : undefined,
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: titleSuffix,
      description: summary,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

function PortfolioItemJsonLd({ item, slug }: { item: Awaited<ReturnType<typeof getItemBySlug>>; slug: string }) {
  if (!item) return null;
  const url = `${SITE_URL}/portfolio/${slug}`;
  const data = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": url,
    name: item.title,
    headline: item.client ? `${item.client} · ${item.title}` : item.title,
    description: deriveSummary(item),
    keywords: getAllKeywords(item).join(", "),
    inLanguage: "ko-KR",
    url,
    image: item.images?.length
      ? item.images.map((u, i) => ({ "@type": "ImageObject", url: u, caption: getImageAlt(item, i) }))
      : undefined,
    creator: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
    about: item.category,
    audience: item.clientType
      ? { "@type": "Audience", audienceType: item.clientType }
      : undefined,
    dateCreated: item.createdAt,
    dateModified: item.updatedAt,
    isPartOf: {
      "@type": "CollectionPage",
      name: "Paper Engineering Studio 작업 포트폴리오",
      url: `${SITE_URL}/portfolio`,
    },
  };

  // BreadcrumbList 도 함께
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "작업 포트폴리오", item: `${SITE_URL}/portfolio` },
      { "@type": "ListItem", position: 3, name: item.title, item: url },
    ],
  };

  // 사례별 FAQ — 본문에 실제로 보이는 Q&A 와 같은 내용이어야 한다(구글 정책)
  const faq = derivePortfolioFaq(item);
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
    </>
  );
}

export default async function PortfolioDetailPage({ params }: Props) {
  const { slug } = await params;
  const item = await getItemBySlug(slug);
  if (!item || !item.published) notFound();

  const summary = deriveSummary(item);
  const heroImage = item.images?.[0];
  const otherImages = (item.images ?? []).slice(1);
  const tags = item.tags ?? [];
  const canonicalSlug = deriveSlug(item);
  const faq = derivePortfolioFaq(item);

  return (
    <>
      <PortfolioItemJsonLd item={item} slug={canonicalSlug} />

      {/* Hero */}
      <section className="relative py-16 md:py-24 overflow-hidden" style={{ background: "#1E22B2" }}>
        <div className="absolute inset-0 pointer-events-none opacity-20">
          <div className="absolute -right-32 top-1/4 w-[70%] max-w-3xl rotate-6">
            <PaperNetBg className="w-full h-auto" />
          </div>
        </div>
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="mb-6 text-sm text-blue-200/80">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href="/" className="hover:text-white">홈</Link>
              </li>
              <li className="text-blue-300/50">/</li>
              <li>
                <Link href="/portfolio" className="hover:text-white">작업 포트폴리오</Link>
              </li>
              <li className="text-blue-300/50">/</li>
              <li className="text-white font-medium truncate max-w-[60vw]" aria-current="page">
                {item.title}
              </li>
            </ol>
          </nav>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs px-3 py-1 rounded-full bg-white/10 text-white border border-white/15 font-semibold">
              {item.category}
            </span>
            {item.client && (
              <span className="text-xs px-3 py-1 rounded-full bg-white/10 text-white border border-white/15">
                Client · {item.client}
              </span>
            )}
            {item.clientType && (
              <span className="text-xs px-3 py-1 rounded-full bg-amber-400/15 text-amber-100 border border-amber-300/30">
                {item.clientType}
              </span>
            )}
          </div>

          <h1
            className="text-3xl md:text-5xl font-extrabold text-white tracking-tight leading-[1.15] mb-4"
            style={{ wordBreak: "keep-all" }}
          >
            {item.title}
          </h1>
          <p className="text-blue-100/90 text-lg max-w-3xl" style={{ wordBreak: "keep-all" }}>
            {summary}
          </p>
        </div>
      </section>

      {/* Hero image */}
      {heroImage && (
        <section className="bg-slate-50 py-10 md:py-14">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
              <Image
                src={heroImage}
                alt={getImageAlt(item, 0)}
                width={1600}
                height={1067}
                priority
                sizes="(min-width: 1024px) 960px, 100vw"
                className="w-full h-auto object-cover"
              />
            </div>
          </div>
        </section>
      )}

      {/* Description + meta */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Body */}
          <div className="lg:col-span-2">
            <h2 className="text-2xl font-bold text-slate-900 mb-4 tracking-tight">사례 소개</h2>
            {item.description ? (
              <div className="prose prose-slate max-w-none">
                {item.description.split(/\n\n+/).map((para, i) => (
                  <p key={i} className="text-slate-700 leading-relaxed" style={{ wordBreak: "keep-all" }}>
                    {para}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-slate-500" style={{ wordBreak: "keep-all" }}>
                {summary}
              </p>
            )}

            {tags.length > 0 && (
              <div className="mt-8">
                <div className="text-xs font-semibold text-slate-500 mb-2 tracking-wide">태그</div>
                <div className="flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <Link
                      key={t}
                      href={`/portfolio?tag=${encodeURIComponent(t)}`}
                      className="text-sm px-3 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition-colors"
                    >
                      #{t}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 사례별 자주 묻는 질문 — JSON-LD(FAQPage)와 같은 내용을 본문에도 노출한다 */}
            {faq.length > 0 && (
              <section className="mt-12">
                <h2 className="text-2xl font-bold text-slate-900 mb-4 tracking-tight">
                  이 작업에 대해 자주 묻는 질문
                </h2>
                <dl className="divide-y divide-slate-200 border-t border-slate-200">
                  {faq.map((f) => (
                    <div key={f.question} className="py-5">
                      <dt
                        className="text-base font-semibold text-slate-900 mb-2"
                        style={{ wordBreak: "keep-all" }}
                      >
                        {f.question}
                      </dt>
                      <dd
                        className="text-slate-700 leading-relaxed"
                        style={{ wordBreak: "keep-all" }}
                      >
                        {f.answer}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>

          {/* Sidebar */}
          <aside className="lg:col-span-1">
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 mb-4 tracking-tight">프로젝트 정보</h3>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500 text-xs mb-0.5">제품 종류</dt>
                  <dd className="text-slate-900 font-medium">{item.category}</dd>
                </div>
                {item.client && (
                  <div>
                    <dt className="text-slate-500 text-xs mb-0.5">클라이언트</dt>
                    <dd className="text-slate-900 font-medium">{item.client}</dd>
                  </div>
                )}
                {item.clientType && (
                  <div>
                    <dt className="text-slate-500 text-xs mb-0.5">분야</dt>
                    <dd className="text-slate-900 font-medium">{item.clientType}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-slate-500 text-xs mb-0.5">제작 시기</dt>
                  <dd className="text-slate-900 font-medium pe-num">
                    {new Date(item.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long" })}
                  </dd>
                </div>
              </dl>

              <Link
                href="/quote"
                className="group mt-6 block text-center py-3 text-white text-sm font-semibold rounded-xl transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
              >
                <span className="inline-flex items-center gap-1">
                  비슷한 작업 견적 받기
                  <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </div>
          </aside>
        </div>
      </section>

      {/* Other images */}
      {otherImages.length > 0 && (
        <section className="py-12 md:py-16 bg-slate-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 tracking-tight">다른 컷</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {otherImages.map((url, i) => (
                <div key={url} className="rounded-2xl overflow-hidden border border-slate-200 bg-white">
                  <Image
                    src={url}
                    alt={getImageAlt(item, i + 1)}
                    width={1200}
                    height={800}
                    sizes="(min-width: 640px) 50vw, 100vw"
                    className="w-full h-auto object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-14 md:py-18 relative overflow-hidden" style={{ background: "#1E22B2" }}>
        <div className="absolute inset-0 pointer-events-none opacity-20 flex items-center justify-center">
          <div className="w-full max-w-2xl"><PaperNetBg className="w-full h-auto" /></div>
        </div>
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3 tracking-tight">
            {item.client || "이런 작업"}처럼 만들고 싶으신가요
          </h2>
          <p className="text-blue-200 mb-8" style={{ wordBreak: "keep-all" }}>
            지기구조 전문 설계 페이퍼 엔지니어링 스튜디오에 직접 의뢰해 보세요. 3영업일 이내 회신 드립니다.
          </p>
          <Link
            href="/quote"
            className="group inline-flex items-center gap-2 px-8 py-4 font-bold rounded-xl text-white text-lg shadow-xl shadow-pink-500/30 hover:-translate-y-0.5 transition-all"
            style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
          >
            무료 견적 받기
            <ArrowRightIcon size={20} className="transition-transform group-hover:translate-x-1" />
          </Link>
          <div className="mt-6">
            <Link href="/portfolio" className="text-blue-200 hover:text-white text-sm">
              ← 전체 작업 포트폴리오 보기
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
