"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PostSummary } from "@/lib/blog";
import { BlogThumbnail, blogVariantFromTag } from "@/components/paper-art";
import { BlogCoverImage } from "@/components/BlogCoverImage";

/** 블로그 카테고리(태그) 노출 순서 */
const TAG_ORDER = ["사례 연구", "제작 과정", "교육", "소재", "디자인", "이야기"];

const tagColors: Record<string, string> = {
  "제작 과정": "bg-orange-100 text-orange-700",
  "교육": "bg-blue-100 text-blue-700",
  "이야기": "bg-amber-100 text-amber-700",
  "사례 연구": "bg-purple-100 text-purple-700",
  "소재": "bg-green-100 text-green-700",
  "디자인": "bg-pink-100 text-pink-700",
};

const tagGradients: Record<string, string> = {
  "제작 과정": "from-orange-100 to-orange-50",
  "교육": "from-blue-100 to-blue-50",
  "이야기": "from-amber-100 to-amber-50",
  "사례 연구": "from-purple-100 to-purple-50",
  "소재": "from-green-100 to-green-50",
  "디자인": "from-pink-100 to-pink-50",
};

function Thumb({ post, big = false }: { post: PostSummary; big?: boolean }) {
  const emojiSize = big ? "text-8xl" : "text-6xl";
  const fallback = post.emoji ? (
    <div className={`bg-gradient-to-br ${tagGradients[post.tag] ?? "from-slate-100 to-slate-50"} flex items-center justify-center h-full`}>
      <span className={emojiSize}>{post.emoji}</span>
    </div>
  ) : (
    <BlogThumbnail variant={blogVariantFromTag(post.tag)} className="w-full h-full" />
  );

  if (post.coverImage) {
    return (
      <BlogCoverImage
        src={post.coverImage}
        alt={post.title}
        className="w-full h-full object-cover"
        fallback={fallback}
      />
    );
  }
  return fallback;
}

export default function BlogList({ posts }: { posts: PostSummary[] }) {
  const tags = useMemo(
    () => ["전체", ...TAG_ORDER.filter((t) => posts.some((p) => p.tag === t))],
    [posts],
  );
  const [active, setActive] = useState("전체");

  const filtered = active === "전체" ? posts : posts.filter((p) => p.tag === active);
  const showFeatured = active === "전체" && filtered.length > 0;
  const featured = showFeatured ? filtered[0] : null;
  const rest = showFeatured ? filtered.slice(1) : filtered;

  return (
    <>
      {/* 카테고리 탭 */}
      <div className="flex flex-wrap justify-center gap-2 mb-10" role="tablist" aria-label="블로그 카테고리">
        {tags.map((t) => {
          const on = active === t;
          const count = t === "전체" ? posts.length : posts.filter((p) => p.tag === t).length;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t)}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                on
                  ? "text-white shadow-sm"
                  : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-900"
              }`}
              style={on ? { background: "#1E22B2" } : {}}
            >
              {t}
              <span className={`ml-1.5 text-xs ${on ? "text-white/60" : "text-slate-400"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* 추천 글 (전체 보기에서만) */}
      {featured && (
        <div className="mb-10">
          <Link
            href={`/blog/${featured.slug}`}
            className="group grid grid-cols-1 md:grid-cols-2 bg-white rounded-3xl overflow-hidden border border-slate-200 hover:shadow-xl transition-shadow"
          >
            <div className="relative h-64 md:h-auto md:min-h-[280px] group-hover:scale-[1.02] transition-transform overflow-hidden">
              <Thumb post={featured} big />
            </div>
            <div className="p-8 md:p-10 flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-4">
                <span className={`px-3 py-1 text-xs font-semibold rounded-full ${tagColors[featured.tag] ?? "bg-slate-100 text-slate-600"}`}>
                  {featured.tag}
                </span>
                <span className="text-xs text-slate-400 border border-slate-200 px-2 py-0.5 rounded-full">추천 글</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-3 group-hover:text-[#1E22B2] transition-colors">
                {featured.title}
              </h2>
              <p className="text-slate-600 leading-relaxed mb-6">{featured.excerpt}</p>
              <div className="text-sm text-slate-400">
                {new Date(featured.createdAt).toLocaleDateString("ko-KR")}
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* 글 그리드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {rest.map((post) => (
          <Link
            key={post.id}
            href={`/blog/${post.slug}`}
            className="group bg-white rounded-2xl overflow-hidden border border-slate-200 hover:shadow-lg transition-shadow flex flex-col"
          >
            <div className="h-44 overflow-hidden group-hover:scale-[1.02] transition-transform">
              <Thumb post={post} />
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <span className={`inline-block px-3 py-1 text-xs font-semibold rounded-full mb-3 self-start ${tagColors[post.tag] ?? "bg-slate-100 text-slate-600"}`}>
                {post.tag}
              </span>
              <h3 className="font-bold text-slate-900 mb-2 group-hover:text-[#1E22B2] transition-colors line-clamp-2 flex-1">
                {post.title}
              </h3>
              <p className="text-sm text-slate-500 line-clamp-2 mb-4">{post.excerpt}</p>
              <div className="text-xs text-slate-400">
                {new Date(post.createdAt).toLocaleDateString("ko-KR")}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
