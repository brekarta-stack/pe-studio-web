"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  PaperToyIcon,
  SparkleIcon,
  CheckIcon,
  ArrowRightIcon,
  BoxIcon,
  GearIcon,
  EducationIcon,
  PencilIcon,
  type IconKey,
} from "@/components/icons";

/* ──────────────── 데이터 모델 ──────────────── */

type UsageKey = "education" | "promotion" | "hobby";

interface Product {
  icon: IconKey;
  name: string;
  subtitle: string;
  /** 제작 문의(/quote) 폼의 product 값 — CTA 클릭 시 제품 선택을 건너뛰도록 전달 */
  quoteId: string;
  accent: string;
  bgGradient: string;
  highlight: string;
  description: string;
  features: string[];
  minOrder: string;
  leadTime: string;
  usages: UsageKey[];
  /** 카드 상단 영역 이미지 URL (없으면 기존 아이콘 fallback) */
  topImage?: string;
}

const USAGE_NAME: Record<UsageKey, string> = {
  education: "교육/교구",
  promotion: "홍보",
  hobby: "취미",
};

/**
 * 제작 문의 CTA href — 선택한 제품/용도 + 주문 형태(?type=)를 /quote 로 전달해
 * 폼에서 같은 선택을 반복하지 않게 한다. (게이트가 URL 에 반영한 type 을 마운트 시 1회 판독)
 */
function useQuoteHref() {
  const [ptype, setPtype] = useState("");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type");
    if (t === "blueprint" || t === "production") setPtype(t);
  }, []);
  return (productId: string) => `/quote?product=${productId}${ptype ? `&ptype=${ptype}` : ""}`;
}

const products: Product[] = [
  {
    icon: "paperToy",
    name: "Paper Craft",
    subtitle: "페이퍼 크래프트",
    quoteId: "papercraft",
    accent: "#06C6C8",
    bgGradient: "from-cyan-50 to-sky-50",
    highlight: "핵심 서비스",
    description:
      "도형·내각 원리를 이용해 종이만으로 입체 구조를 완성하는 특허 기반 페이퍼 크래프트. 치환·연결 원리를 응용해 무한한 형태 변주가 가능하며, 기관·기업 맞춤 대량 제작이 가능합니다.",
    features: [
      "도형·내각 원리 기반 입체 구조",
      "치환·연결 원리 응용 설계",
      "무게중심·중력 자동 기립",
      "기관·관공서·기업 맞춤 제작",
      "친환경 종이 소재",
      "OPP/벌크 포장 선택",
    ],
    minOrder: "1,000부",
    leadTime: "6주 이상",
    usages: ["education", "promotion", "hobby"],
    topImage: "https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/uploads/1780305681024.png",
  },
  {
    icon: "gear",
    name: "Action Paper Toy",
    subtitle: "액션 페이퍼 토이",
    quoteId: "action",
    accent: "#1E22B2",
    bgGradient: "from-blue-50 to-indigo-50",
    highlight: "특허 핵심 기술",
    description:
      "정교한 종이 메커니즘으로 다양하고 재미있게 움직이는 캐릭터를 만나보세요. 지기구조, 탄성력, 자기력, 기어, 크랭크, 레버, 오토마타 등 다양한 형태의 움직임 원리로 캐릭터에 생동감을 부여합니다.",
    features: [
      "지기구조·탄성력 메커니즘",
      "자기력·기어 활용",
      "크랭크·레버 시스템",
      "오토마타 원리 응용",
      "캐릭터 IP 활용 가능",
      "브랜드 굿즈·체험 키트",
    ],
    minOrder: "500부",
    leadTime: "약 4주",
    usages: ["education", "promotion"],
    topImage: "https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/uploads/action%20craft.png",
  },
  {
    icon: "sparkle",
    name: "Popup Book",
    subtitle: "팝업북",
    quoteId: "popup",
    accent: "#E91E8C",
    bgGradient: "from-pink-50 to-fuchsia-50",
    highlight: "선물·기념품 인기",
    description:
      "펼치면 살아 숨쉬는 다층 팝업 구조. 카드·북·포스터 등 다양한 형태로 제작 가능하며 고급 선물·기념품·기업 프로모션으로 최적입니다.",
    features: [
      "다층 팝업 구조 설계",
      "카드·북·포스터 형태",
      "고급 선물·기념품 제작",
      "기업 프로모션 활용",
      "커스텀 문구 삽입",
      "소량 맞춤 제작 가능",
    ],
    minOrder: "1부~",
    leadTime: "약 3주",
    usages: ["education", "promotion", "hobby"],
    topImage: "https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/uploads/23213213.jpeg",
  },
  {
    icon: "box",
    name: "Foamboard (Woodlock)",
    subtitle: "폼보드(우드락)",
    quoteId: "foamboard",
    accent: "#F5C518",
    bgGradient: "from-amber-50 to-yellow-50",
    highlight: "쉬운 조립 구조",
    description:
      "접착제가 필요 없이 끼워 만드는 형태로 다양한 구조물을 제작할 수 있습니다. 누구나 손쉽게 만들 수 있어 많은 사랑을 받는 제품입니다.",
    features: [
      "풀·접착제 불필요",
      "끼움식 간편 조립",
      "다양한 구조물 제작",
      "취미·만들기 키트 인기",
      "전시·행사 소품 활용",
      "경량 폼보드 소재",
    ],
    minOrder: "1,000부",
    leadTime: "6주 이상",
    usages: ["promotion", "hobby"],
    topImage: "https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/uploads/444444.png",
  },
];

interface UsageCategory {
  key: UsageKey;
  name: string;
  english: string;
  accent: string;
  bgGradient: string;
  icon: IconKey;
  tagline: string;
  description: string;
  /** 카드 상단 영역 이미지 URL (없으면 기존 아이콘 fallback) */
  topImage?: string;
}

const usageCategories: UsageCategory[] = [
  {
    key: "education",
    name: "교육/교구용",
    english: "Education",
    accent: "#06C6C8",
    bgGradient: "from-cyan-50 to-sky-50",
    icon: "education",
    tagline: "손으로 만들며 원리를 배우는 핸즈온 학습 도구",
    description:
      "어린이박물관 체험존·과학관 워크숍·평생학습관·학교 교구 등에 활용할 수 있습니다. 만드는 과정 자체가 학습이 되는 핸즈온 키트입니다.",
    topImage: "https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/uploads/5555555.png",
  },
  {
    key: "promotion",
    name: "홍보용",
    english: "Promotion",
    accent: "#E91E8C",
    bgGradient: "from-white to-white",
    icon: "sparkle",
    tagline: "캐릭터를 입체로, 브랜드를 손으로 만지는 굿즈",
    description:
      "기업 캐릭터 IP를 활용한 노벨티·전시 부스 굿즈·이벤트 프로모션 등 마케팅 도구로 적합합니다. 받는 순간 만들고 싶어지는 임팩트가 있습니다.",
    topImage: "https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/uploads/66666.png",
  },
  {
    key: "hobby",
    name: "취미용",
    english: "Hobby",
    accent: "#F5C518",
    bgGradient: "from-amber-50 to-yellow-50",
    icon: "pencil",
    tagline: "부담 없이 시작해 완성하는 만들기 경험",
    description:
      "가족·동호회·개인 제작자를 위한 키트. 풀이나 가위 없이도 완성할 수 있는 부담 없는 만들기 경험을 제공합니다.",
    topImage: "https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/uploads/7777777777.jpg",
  },
];

/* ──────────────── 카드 컴포넌트 ──────────────── */

function ProductIcon({ name, size = 48 }: { name: IconKey; size?: number }) {
  switch (name) {
    case "paperToy":  return <PaperToyIcon size={size} />;
    case "sparkle":   return <SparkleIcon size={size} />;
    case "gear":      return <GearIcon size={size} />;
    case "box":       return <BoxIcon size={size} />;
    case "education": return <EducationIcon size={size} />;
    case "pencil":    return <PencilIcon size={size} />;
    default:          return <PaperToyIcon size={size} />;
  }
}

function ProductCard({ p }: { p: Product }) {
  const quoteHref = useQuoteHref();
  return (
    <div className="pe-paper-lift group bg-white border border-slate-100 rounded-2xl overflow-hidden pe-paper-shadow">
      {/* ── 상단 헤더 영역: topImage 있으면 이미지, 없으면 기존 아이콘 ── */}
      <div className={`${p.topImage ? "" : `bg-gradient-to-br ${p.bgGradient}`} aspect-[2/1] flex items-center justify-center relative overflow-hidden`}>
        {p.topImage ? (
          // next/image — 원본을 방문자가 Supabase 에서 직접 받지 않게(전송량 한도) Vercel 에서 줄여 캐시해 내준다
          <Image
            src={p.topImage}
            alt={`${p.subtitle} 대표 이미지`}
            fill
            sizes="(min-width: 1280px) 600px, (min-width: 768px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center pe-paper-shadow"
            style={{ background: "white", color: p.accent }}
            aria-hidden
          >
            <ProductIcon name={p.icon} size={40} />
          </div>
        )}
        <span
          className="absolute top-4 right-4 z-10 text-xs px-2.5 py-1 bg-white/90 text-slate-700 font-semibold rounded-full border border-slate-200 backdrop-blur-sm"
          style={{ wordBreak: "keep-all" }}
        >
          {p.highlight}
        </span>
      </div>

      {/* ── 본문 영역 ── */}
      <div className="p-6 flex flex-col">
        {/* 제목/태그 — 항상 보임 */}
        <div className="flex items-start justify-between mb-3 gap-3">
          <div className="min-w-0">
            <div className="text-xs text-slate-400 font-medium mb-0.5">{p.name}</div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">{p.subtitle}</h3>
          </div>
          <div className="flex flex-wrap gap-1 justify-end flex-shrink-0">
            {p.usages.map((u) => (
              <span
                key={u}
                className="px-2 py-0.5 text-[11px] font-semibold rounded-full"
                style={{ background: p.accent + "18", color: p.accent }}
              >
                {USAGE_NAME[u]}
              </span>
            ))}
          </div>
        </div>

        {/* 설명/Features/Min·Lead */}
        <p className="text-slate-600 text-sm leading-relaxed mb-4" style={{ wordBreak: "keep-all" }}>
          {p.description}
        </p>
        <ul className="grid grid-cols-2 gap-1.5 mb-5">
          {p.features.map((f) => (
            <li key={f} className="text-xs text-slate-600 flex items-start gap-1.5">
              <CheckIcon size={14} className="flex-shrink-0 mt-0.5" style={{ color: p.accent }} />
              <span style={{ wordBreak: "keep-all" }}>{f}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-4 text-sm text-slate-500 mb-4 pb-4 border-b border-slate-100">
          <span>최소 <strong className="text-slate-800 pe-num">{p.minOrder}</strong></span>
          <span className="text-slate-300">·</span>
          <span>납기 <strong className="text-slate-800 pe-num">{p.leadTime}</strong></span>
        </div>

        {/* 견적 받기 버튼 — 선택 제품·주문 형태를 폼으로 전달 */}
        <Link
          href={quoteHref(p.quoteId)}
          className="group/btn block text-center py-2.5 text-white text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 relative z-10"
          style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.accent}cc)` }}
        >
          <span className="inline-flex items-center gap-1">
            이 서비스 견적 받기
            <ArrowRightIcon size={14} className="transition-transform group-hover/btn:translate-x-0.5" />
          </span>
        </Link>
      </div>
    </div>
  );
}

function UsageCard({ u }: { u: UsageCategory }) {
  const quoteHref = useQuoteHref();
  const matched = products.filter((p) => p.usages.includes(u.key));
  return (
    <div className="pe-paper-lift group bg-white border border-slate-100 rounded-2xl overflow-hidden pe-paper-shadow flex flex-col">
      {/* 상단 헤더 영역: topImage 있으면 이미지, 없으면 기존 아이콘 */}
      <div className={`bg-gradient-to-br ${u.bgGradient} aspect-square flex items-center justify-center relative overflow-hidden`}>
        {u.topImage ? (
          <Image
            src={u.topImage}
            alt={`${u.name} 대표 이미지`}
            fill
            sizes="(min-width: 1280px) 400px, (min-width: 768px) 33vw, 100vw"
            className="object-contain p-4 transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center pe-paper-shadow"
            style={{ background: "white", color: u.accent }}
            aria-hidden
          >
            <ProductIcon name={u.icon} size={40} />
          </div>
        )}
      </div>
      <div className="p-6 flex flex-col flex-1">
        <div className="mb-3">
          <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: u.accent }}>
            용도별
          </div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight">{u.name}</h3>
          <p className="text-sm font-medium mt-1" style={{ color: u.accent, wordBreak: "keep-all" }}>
            {u.tagline}
          </p>
        </div>
        <p className="text-slate-600 text-sm leading-relaxed mb-5" style={{ wordBreak: "keep-all" }}>
          {u.description}
        </p>
        <div className="mb-5 flex-1">
          <div className="text-xs font-semibold text-slate-500 mb-2">추천 제품</div>
          <ul className="space-y-1.5">
            {matched.map((p) => (
              <li key={p.subtitle} className="flex items-start gap-2 text-sm text-slate-700">
                <span
                  className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: p.accent }}
                />
                <div>
                  <span className="font-semibold text-slate-900">{p.subtitle}</span>
                  <span className="text-slate-500 text-xs ml-2 pe-num">최소 {p.minOrder} · 납기 {p.leadTime}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <Link
          href={quoteHref(u.key)}
          className="group block text-center py-2.5 text-white text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 mt-auto"
          style={{ background: `linear-gradient(135deg, ${u.accent}, ${u.accent}cc)` }}
        >
          <span className="inline-flex items-center gap-1">
            {u.name} 견적 받기
            <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      </div>
    </div>
  );
}

/* ──────────────── 메인 — 토글 + 두 가지 뷰 ──────────────── */

export default function ProductCatalogTabs() {
  const [view, setView] = useState<"product" | "usage">("product");

  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Segmented Toggle */}
        <div className="flex flex-col items-center mb-10 md:mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-slate-400">
            보기 방식
          </p>
          <div
            role="tablist"
            aria-label="제품 카테고리 보기 모드"
            className="inline-flex p-1.5 bg-slate-100 rounded-2xl"
          >
            <button
              role="tab"
              aria-selected={view === "product"}
              onClick={() => setView("product")}
              className={`px-5 md:px-8 py-2.5 text-sm md:text-base font-semibold rounded-xl transition-all ${
                view === "product"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              제품 종류별
            </button>
            <button
              role="tab"
              aria-selected={view === "usage"}
              onClick={() => setView("usage")}
              className={`px-5 md:px-8 py-2.5 text-sm md:text-base font-semibold rounded-xl transition-all ${
                view === "usage"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              용도별
            </button>
          </div>
          <p className="text-sm text-slate-500 mt-4 text-center" style={{ wordBreak: "keep-all" }}>
            {view === "product"
              ? "4종 제품을 종류별로 살펴보세요. 각 제품마다 적합한 용도가 함께 표시됩니다."
              : "원하시는 용도를 먼저 정해보세요. 해당 용도에 맞는 추천 제품을 확인할 수 있습니다."}
          </p>
        </div>

        {view === "product" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {products.map((p) => (
              <ProductCard key={p.subtitle} p={p} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {usageCategories.map((u) => (
              <UsageCard key={u.key} u={u} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
