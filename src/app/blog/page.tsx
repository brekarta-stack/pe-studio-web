import type { Metadata } from "next";
import Link from "next/link";
import { getPostSummaries } from "@/lib/blog";
import { PAGE_META, SITE_SHORT, BRAND_TAGLINE_KR, OG_IMAGE } from "@/lib/site";
import { PencilIcon, ArrowRightIcon } from "@/components/icons";
import { PaperNetBg } from "@/components/paper-art";
import BlogList from "@/components/BlogList";
import PageHero from "@/components/PageHero";

// ISR — 새 글 발행 시 5분 내 반영. 정적 캐시로 TTFB·크롤 효율 개선(요청별 데이터 없음).
export const revalidate = 300;

export const metadata: Metadata = {
  title: PAGE_META.blog.title,
  description: PAGE_META.blog.description,
  alternates: { canonical: "/blog" },
  openGraph: {
    images: [OG_IMAGE],
    title: PAGE_META.blog.title,
    description: PAGE_META.blog.description,
    url: "/blog",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_META.blog.title,
    description: PAGE_META.blog.description,
  },
};

export default async function BlogPage() {
  const allPosts = (await getPostSummaries()).filter((p) => p.published);

  return (
    <>
      {/* Hero */}
      <PageHero
        eyebrow={BRAND_TAGLINE_KR}
        title={<>{SITE_SHORT} <span className="pe-gradient-text">블로그</span></>}
        subtitle="페이퍼 엔지니어링 제작 과정, STEAM 교육 활용 사례, 종이공예 이야기를 담았습니다."
      />

      {/* Posts */}
      <section className="py-16 md:py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {allPosts.length === 0 ? (
            <div className="text-center py-20">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5 text-white" style={{ background: "#1E22B2" }} aria-hidden>
                <PencilIcon size={32} />
              </div>
              <p className="text-slate-700 text-lg font-semibold">아직 작성된 글이 없습니다.</p>
              <p className="text-slate-400 text-sm mt-2">곧 페이퍼 엔지니어링 관련 콘텐츠로 찾아오겠습니다.</p>
            </div>
          ) : (
            <BlogList posts={allPosts} />
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 md:py-20" style={{ background: "#F0F2FF" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-3 tracking-tight">
            페이퍼 엔지니어링 작업을 의뢰하고 싶으신가요
          </h2>
          <p className="text-slate-500 mb-8" style={{ wordBreak: "keep-all" }}>
            블로그에서 본 사례 같은 작업이 필요하시면, 견적 문의를 남겨 주세요.
          </p>
          <Link
            href="/quote"
            className="group inline-flex items-center gap-2 px-8 py-4 font-bold rounded-xl text-white text-lg shadow-lg shadow-pink-500/25 hover:-translate-y-0.5 transition-all"
            style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
          >
            무료 견적 받기
            <ArrowRightIcon size={20} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>
    </>
  );
}

