import { notFound } from "next/navigation";
import { getPostBySlug, getPosts } from "@/lib/blog";

// ISR — 블로그 글은 요청별 데이터가 없어 정적 캐시 가능. 새 글/수정 5분 내 반영(TTFB·크롤 효율↑).
export const revalidate = 300;
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import Link from "next/link";
import type { Metadata } from "next";
import { SITE_NAME, SITE_URL, AUTHOR } from "@/lib/site";
import { BlogThumbnail, blogVariantFromTag } from "@/components/paper-art";
import { BlogCoverImage } from "@/components/BlogCoverImage";

/** 본문에서 마크다운·인라인 HTML을 걷어낸 순수 글자 수 기준 예상 읽기 시간(분). 한국어 분당 ~500자 */
function readingMinutes(content: string): number {
  const plain = content
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`~|_-]/g, "")
    .replace(/\s+/g, "");
  return Math.max(1, Math.round(plain.length / 500));
}

/** 소제목 텍스트 → 앵커 id (한글 유지, 공백은 하이픈) */
function headingId(text: string): string {
  return text.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}-]/gu, "");
}

/** 마크다운 본문에서 `## ` 소제목만 추출 (목차용) */
function extractHeadings(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, "").trim());
}

export async function generateStaticParams() {
  try {
    const posts = await getPosts();
    return posts.filter((p) => p.published).map((p) => ({ slug: p.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  const canonical = `/blog/${post.slug}`;
  // 글 커버 이미지를 OG/트위터 카드 이미지로 사용 (없으면 사이트 기본 OG)
  const ogImage = post.coverImage || `${SITE_URL}/opengraph-image`;
  return {
    // template 가 자동으로 ` | CES` 를 붙이므로 여기서 다시 붙이지 않음
    title: post.title,
    description: post.excerpt,
    ...(post.tag ? { keywords: [post.tag, "페이퍼 엔지니어링", "페이퍼크래프트"] } : {}),
    authors: [{ name: AUTHOR.name, url: AUTHOR.url }],
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt,
      url: canonical,
      images: [ogImage],
      publishedTime: post.createdAt,
      modifiedTime: post.updatedAt,
      ...(post.tag ? { tags: [post.tag] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      images: [ogImage],
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  // 관련 글(같은 태그 우선, 부족하면 최신글로 보충) — 내부링크로 크롤 깊이·체류 동선 강화
  const otherPosts = (await getPosts()).filter(
    (p) => p.published && p.slug !== post.slug,
  );
  const sameTag = otherPosts.filter((p) => p.tag === post.tag);
  const related = (
    sameTag.length >= 3
      ? sameTag
      : [...sameTag, ...otherPosts.filter((p) => p.tag !== post.tag)]
  ).slice(0, 3);

  const minutes = readingMinutes(post.content);
  const headings = extractHeadings(post.content);

  // 태그(독자층)에 맞춘 하단 CTA 문구 — 교육은 교구, 실무 태그는 견적으로
  const cta =
    post.tag === "교육"
      ? {
          title: "우리 학교·기관만의 교구를 고민 중이신가요?",
          desc: "수업·체험 프로그램에 맞춘 종이 교구를 설계해 드립니다.",
        }
      : post.tag === "사례 연구"
        ? {
            title: "비슷한 프로젝트를 검토하고 계신가요?",
            desc: "캐릭터·행사·굿즈, 어떤 형태든 사례 기준으로 상담해 드립니다.",
          }
        : {
            title: "이런 작업을 직접 의뢰하고 싶으신가요?",
            desc: "",
          };

  const tagColors: Record<string, string> = {
    "제작 과정": "bg-orange-100 text-orange-700",
    "교육": "bg-blue-100 text-blue-700",
    "이야기": "bg-amber-100 text-amber-700",
    "사례 연구": "bg-purple-100 text-purple-700",
    "소재": "bg-green-100 text-green-700",
    "디자인": "bg-pink-100 text-pink-700",
  };

  // BlogPosting JSON-LD
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    image: [post.coverImage || `${SITE_URL}/opengraph-image`],
    datePublished: post.createdAt,
    dateModified: post.updatedAt,
    inLanguage: "ko-KR",
    author: {
      "@type": "Person",
      name: AUTHOR.name,
      jobTitle: AUTHOR.title,
      description: AUTHOR.bio,
      url: AUTHOR.url,
      worksFor: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    },
    publisher: {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/opengraph-image` },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}/blog/${post.slug}`,
    },
    ...(post.tag ? { articleSection: post.tag } : {}),
  };

  // 빵부스러기(BreadcrumbList) — 홈 > 블로그 > 글
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "블로그", item: `${SITE_URL}/blog` },
      { "@type": "ListItem", position: 3, name: post.title, item: `${SITE_URL}/blog/${post.slug}` },
    ],
  };

  return (
    <article className="max-w-3xl mx-auto px-4 py-16">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <Link
        href="/blog"
        className="inline-flex items-center gap-1 text-slate-500 hover:text-orange-600 text-sm mb-8 transition-colors"
      >
        ← 블로그 목록
      </Link>

      <div className="mb-10">
        {/* 커버 이미지 우선, 없으면 이모지, 없으면 SVG 썸네일 */}
        {post.coverImage ? (
          <BlogCoverImage
            src={post.coverImage}
            alt={post.title}
            priority
            sizes="(min-width: 768px) 768px, 100vw"
            className="w-full aspect-[16/7] object-cover rounded-2xl mb-6 pe-paper-shadow"
            fallback={
              post.emoji
                ? <span className="text-6xl block mb-6" aria-hidden>{post.emoji}</span>
                : <div className="w-full aspect-[16/7] rounded-2xl overflow-hidden mb-6 pe-paper-shadow"><BlogThumbnail variant={blogVariantFromTag(post.tag)} className="w-full h-full" /></div>
            }
          />
        ) : post.emoji ? (
          <span className="text-6xl block mb-6" aria-hidden>{post.emoji}</span>
        ) : (
          <div className="w-full aspect-[16/7] rounded-2xl overflow-hidden mb-6 pe-paper-shadow">
            <BlogThumbnail variant={blogVariantFromTag(post.tag)} className="w-full h-full" />
          </div>
        )}
        <div className="flex items-center gap-3 mb-4">
          {post.tag && (
            <span
              className={`px-3 py-1 text-xs font-semibold rounded-full ${
                tagColors[post.tag] ?? "bg-slate-100 text-slate-600"
              }`}
            >
              {post.tag}
            </span>
          )}
          <span className="text-xs text-slate-400">
            {new Date(post.createdAt).toLocaleDateString("ko-KR", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
          <span className="text-xs text-slate-300" aria-hidden>·</span>
          <span className="text-xs text-slate-500">
            글쓴이 <span className="font-medium text-slate-700">{AUTHOR.name}</span> · {AUTHOR.title}
          </span>
          <span className="text-xs text-slate-300" aria-hidden>·</span>
          <span className="text-xs text-slate-400">약 {minutes}분</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4 leading-tight">
          {post.title}
        </h1>
        {post.excerpt && (
          <p className="text-lg text-slate-500 leading-relaxed">{post.excerpt}</p>
        )}
      </div>

      <div className="border-t border-slate-200 mb-10" />

      {/* 목차 — 소제목 3개 이상인 긴 글에만 */}
      {headings.length >= 3 && (
        <nav
          aria-label="목차"
          className="mb-10 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4"
        >
          <p className="text-xs font-semibold text-slate-400 mb-2">목차</p>
          <ol className="space-y-1.5">
            {headings.map((h) => (
              <li key={h}>
                <a
                  href={`#${headingId(h)}`}
                  className="text-sm text-slate-600 hover:text-orange-600 transition-colors"
                >
                  {h}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-a:text-orange-600 prose-img:rounded-xl">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            h2: ({ children }) => {
              const text = Array.isArray(children) ? children.join("") : String(children ?? "");
              return <h2 id={headingId(text)}>{children}</h2>;
            },
            a: ({ href, children }) => {
              const isExternal = !!href && /^https?:\/\//.test(href);
              return isExternal ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ) : (
                <a href={href}>{children}</a>
              );
            },
          }}
        >
          {post.content}
        </ReactMarkdown>
      </div>

      {/* 저자 소개 — E-E-A-T(전문성·신뢰) 강화 */}
      <div className="mt-14 flex items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
          style={{ background: "#1E22B2" }}
          aria-hidden
        >
          {AUTHOR.name.slice(0, 1)}
        </div>
        <div>
          <p className="font-semibold text-slate-900">
            {AUTHOR.name}{" "}
            <span className="text-slate-400 font-normal text-sm">· {AUTHOR.title}</span>
          </p>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">{AUTHOR.bio}</p>
          <Link
            href="/about"
            className="text-sm text-orange-600 hover:underline mt-2 inline-block"
          >
            회사·설계자 소개 →
          </Link>
        </div>
      </div>

      {/* 관련 글 — 내부링크(블로그 ↔ 블로그) */}
      {related.length > 0 && (
        <section className="mt-14 pt-10 border-t border-slate-200">
          <h2 className="text-lg font-bold text-slate-900 mb-5">함께 읽으면 좋은 글</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/blog/${r.slug}`}
                className="group block rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition"
              >
                {r.tag && (
                  <span className="text-xs font-semibold text-orange-600">{r.tag}</span>
                )}
                <p
                  className="mt-1 font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-[#1E22B2] transition-colors"
                  style={{ wordBreak: "keep-all" }}
                >
                  {r.title}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 전환 CTA — 블로그 → 제품/견적 내부링크 */}
      <div className="mt-12 rounded-2xl border border-slate-200 bg-[#F0F2FF] p-6 text-center">
        <p className="font-semibold text-slate-900" style={{ wordBreak: "keep-all" }}>
          {cta.title}
        </p>
        <p className="text-sm text-slate-500 mt-1" style={{ wordBreak: "keep-all" }}>
          {cta.desc && <>{cta.desc}{" "}</>}
          페이퍼 엔지니어링{" "}
          <Link href="/products" className="text-[#1E22B2] underline underline-offset-2">
            주문 제작 서비스
          </Link>
          를 살펴보거나, 바로 견적을 받아 보세요.
        </p>
        <Link
          href="/quote"
          className="mt-4 inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-bold text-sm shadow-lg shadow-pink-500/20 hover:-translate-y-0.5 transition-transform"
          style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
        >
          무료 견적 받기
        </Link>
      </div>

      <div className="mt-12 pt-8 border-t border-slate-200">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors text-sm"
        >
          ← 다른 글 보기
        </Link>
      </div>
    </article>
  );
}
