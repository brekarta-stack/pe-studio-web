"use client";

import { Suspense, useMemo, useState, useEffect, type CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { canUseNextImage } from "@/lib/image-url";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { PortfolioItem, Category } from "@/lib/portfolio-types";
import { deriveSlug, getImageAlt } from "@/lib/portfolio-meta";

const categoryColors: Record<string, { bg: string; text: string }> = {
  "자체 제작":      { bg: "#ECFDF5", text: "#0F766E" },
  "팝업북":         { bg: "#FFF0F6", text: "#E91E8C" },
  "페이퍼 크래프트": { bg: "#EEF0FF", text: "#1E22B2" },
  "액션 크래프트":  { bg: "#FFF3F9", text: "#E91E8C" },
  "우드락":         { bg: "#FFFBEB", text: "#B45309" },
  "모자/마스크":     { bg: "#E0F7FA", text: "#0E7490" },
  "기타":           { bg: "#F1F5F9", text: "#475569" },
};

interface Props {
  items: PortfolioItem[];
  categories: Category[];
}

/* ─── 카드 ─── */

/**
 * 카드 썸네일 — 우리 Supabase·정적 파일은 next/image 로(Vercel 이 줄여 캐시, 원본 직접 전송 없음),
 * 그 밖의 호스트는 remotePatterns 밖이라 예전처럼 그대로 그린다.
 */
function CardImage({ src, alt, className, style }: { src: string; alt: string; className: string; style: CSSProperties }) {
  if (canUseNextImage(src)) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(min-width: 1280px) 400px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        className={className}
        style={style}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" width={800} height={600} className={`absolute inset-0 w-full h-full ${className}`} style={style} />
  );
}

function PortfolioCard({ item }: { item: PortfolioItem }) {
  const [hovered, setHovered] = useState(false);
  const hasHoverImage = item.images.length > 1;
  const col = categoryColors[item.category] ?? { bg: "#F1F5F9", text: "#475569" };
  const slug = deriveSlug(item);

  return (
    <Link
      href={`/portfolio/${slug}`}
      className="bg-white rounded-2xl overflow-hidden border border-slate-200 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 group block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`${item.title} ${item.client ? `· ${item.client}` : ""} 상세 보기`}
    >
      {/* ── 썸네일 ── */}
      <div className="relative h-56 bg-slate-100 overflow-hidden">
        {item.images.length > 0 ? (
          <>
            <CardImage
              src={item.images[0]}
              alt={getImageAlt(item, 0)}
              className="object-cover transition-all duration-500"
              style={{
                opacity: hasHoverImage && hovered ? 0 : 1,
                transform: hasHoverImage ? "none" : hovered ? "scale(1.05)" : "scale(1)",
              }}
            />
            {hasHoverImage && (
              <CardImage
                src={item.images[1]}
                alt={getImageAlt(item, 1)}
                className="object-cover transition-opacity duration-500"
                style={{ opacity: hovered ? 1 : 0 }}
              />
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>

      {/* ── 정보 ── */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: col.bg, color: col.text }}
          >
            {item.category}
          </span>
          {item.client && <span className="text-xs text-slate-400">{item.client}</span>}
        </div>
        <h3
          className="font-bold text-slate-900 mb-1 transition-colors duration-200"
          style={{ color: hovered ? "#1E22B2" : undefined }}
        >
          {item.title}
        </h3>
        {item.summary || item.description ? (
          <p className="text-sm text-slate-500 line-clamp-2">{item.summary || item.description}</p>
        ) : null}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {item.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

/* ─── 메인 갤러리 (Inner — useSearchParams 사용) ─── */
function PortfolioGalleryInner({ items, categories }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tagParam = searchParams?.get("tag") ?? "";
  const catParam = searchParams?.get("c") ?? "";

  const [active, setActive] = useState<string>(catParam || "전체");
  const [activeTag, setActiveTag] = useState<string>(tagParam);

  // URL ↔ state 동기화 (뒤로가기 자연스럽게)
  useEffect(() => {
    setActiveTag(searchParams?.get("tag") ?? "");
    setActive(searchParams?.get("c") || "전체");
  }, [searchParams]);

  const tabs = ["전체", ...categories];

  // 사용 빈도 높은 태그 (실제 데이터에서 자동 추출)
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((it) => (it.tags ?? []).forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (active !== "전체" && i.category !== active) return false;
      if (activeTag && !(i.tags ?? []).includes(activeTag)) return false;
      return true;
    });
  }, [items, active, activeTag]);

  function updateUrl(next: { c?: string; tag?: string }) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next.c !== undefined) {
      if (next.c && next.c !== "전체") params.set("c", next.c);
      else params.delete("c");
    }
    if (next.tag !== undefined) {
      if (next.tag) params.set("tag", next.tag);
      else params.delete("tag");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function pickCategory(c: string) {
    setActive(c);
    updateUrl({ c });
  }

  function pickTag(t: string) {
    const next = activeTag === t ? "" : t;
    setActiveTag(next);
    updateUrl({ tag: next });
  }

  return (
    <>
      {/* 카테고리 탭 */}
      <div className="flex gap-2 flex-wrap mb-4">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => pickCategory(tab)}
            className="px-5 py-2 rounded-full text-sm font-semibold transition-all"
            style={
              active === tab
                ? { background: "#1E22B2", color: "#fff" }
                : { background: "#fff", color: "#475569", border: "1px solid #E2E8F0" }
            }
          >
            {tab}
          </button>
        ))}
      </div>

      {/* 인기 태그 */}
      {popularTags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-10 items-center">
          <span className="text-xs text-slate-400 mr-1 font-medium">태그</span>
          {popularTags.map((t) => {
            const on = activeTag === t;
            return (
              <button
                key={t}
                onClick={() => pickTag(t)}
                className="text-xs px-3 py-1 rounded-full transition-all border"
                style={
                  on
                    ? { background: "#06C6C8", color: "#fff", borderColor: "#06C6C8" }
                    : { background: "#fff", color: "#475569", borderColor: "#E2E8F0" }
                }
              >
                #{t}
              </button>
            );
          })}
          {activeTag && (
            <button
              onClick={() => pickTag(activeTag)}
              className="text-xs text-slate-400 hover:text-slate-700 ml-1 underline-offset-2 hover:underline"
            >
              태그 해제
            </button>
          )}
        </div>
      )}

      {/* 빈 상태 */}
      {filtered.length === 0 && (
        <div className="text-center py-24">
          <div className="text-6xl mb-4">🖼️</div>
          <p className="text-slate-500 text-lg">조건에 맞는 작품이 없습니다.</p>
          <p className="text-slate-400 text-sm mt-2">다른 카테고리/태그를 선택해 보세요.</p>
        </div>
      )}

      {/* 그리드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((item) => (
          <PortfolioCard key={item.id} item={item} />
        ))}
      </div>
    </>
  );
}

/* ─── 그리드만 먼저 렌더하는 fallback (useSearchParams 없이 동기 렌더 가능) ─── */
function PortfolioGridFallback({ items }: { items: PortfolioItem[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {items.map((item) => (
        <PortfolioCard key={item.id} item={item} />
      ))}
    </div>
  );
}

/* ─── 메인 export (Suspense 로 감싸 inner 의 useSearchParams 안전 처리) ─── */
export default function PortfolioGallery(props: Props) {
  return (
    <Suspense fallback={<PortfolioGridFallback items={props.items} />}>
      <PortfolioGalleryInner {...props} />
    </Suspense>
  );
}
