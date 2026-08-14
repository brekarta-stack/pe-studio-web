import type { Metadata } from "next";
import Link from "next/link";
import { PAGE_META, SITE_URL, SITE_NAME, BRAND_TAGLINE_KR, OG_IMAGE } from "@/lib/site";
import {
  ArrowRightIcon,
  type IconKey,
} from "@/components/icons";
import { PaperNetBg } from "@/components/paper-art";
import ProductCatalogTabs from "@/components/ProductCatalogTabs";
import ProductionTypeGate from "@/components/ProductionTypeGate";
import PageHero from "@/components/PageHero";

export const metadata: Metadata = {
  title: PAGE_META.products.title,
  description: PAGE_META.products.description,
  alternates: { canonical: "/products" },
  openGraph: {
    images: [OG_IMAGE],
    title: PAGE_META.products.title,
    description: PAGE_META.products.description,
    url: "/products",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_META.products.title,
    description: PAGE_META.products.description,
  },
};

/**
 * /products 페이지용 Service JSON-LD.
 */
function ProductsServiceJsonLd() {
  const services = [
    {
      name: "페이퍼 크래프트 주문 제작",
      description: "특허 기반 도형·내각 원리 지기구조 설계 페이퍼 크래프트 외주 제작",
    },
    {
      name: "액션 페이퍼 토이 주문 제작",
      description:
        "지기구조·탄성력·자기력·기어·크랭크·레버·오토마타 등 다양한 메커니즘으로 움직이는 캐릭터 페이퍼 토이 제작",
    },
    {
      name: "팝업북 주문 제작",
      description: "다층 팝업 구조 카드·북·포스터 형태의 팝업북 제작",
    },
    {
      name: "폼보드(우드락) 제작",
      description: "접착제 없이 끼움식으로 조립하는 폼보드·우드락 입체 구조물 제작",
    },
  ];

  const data = services.map((s) => ({
    "@context": "https://schema.org",
    "@type": "Service",
    name: s.name,
    description: s.description,
    provider: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    areaServed: "KR",
    serviceType: "주문 제작",
  }));

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/* ────────────── 데이터 ────────────── */

const processSteps: { num: string; icon: IconKey; label: string; detail: string; period: string; color: string }[] = [
  { num: "01", icon: "education", label: "상담 및 기획",       detail: "생산할 제품 종류 및 수량 결정",       period: "약 1주",    color: "#06C6C8" },
  { num: "02", icon: "gear",      label: "구조 설계 & 샘플링", detail: "컨셉에 맞는 최적 움직임 설계 및 샘플링", period: "약 1주",    color: "#F5C518" },
  { num: "03", icon: "pencil",    label: "디자인 작업",         detail: "고객사 피드백 반영 및 완성",           period: "약 1.5주",  color: "#E91E8C" },
  { num: "04", icon: "box",       label: "생산 및 납품",         detail: "공정 기반 생산, 패키징 및 검수 후 납품", period: "일정 협의", color: "#1E22B2" },
];

const orderOptions = [
  { category: "포장방식", options: ["OPP 포장", "벌크 포장"] },
  { category: "형태",       options: ["움직임형", "고정형"] },
  { category: "조립방식",   options: ["점착 (풀 필요)", "끼우기 (풀 없이)"] },
];

export default function ProductsPage() {
  return (
    <>
      <ProductsServiceJsonLd />

      {/* Hero */}
      <PageHero
        eyebrow={BRAND_TAGLINE_KR}
        title={<span className="pe-gradient-text">주문 제작</span>}
        subtitle={
          <>
            페이퍼 엔지니어링 · 교육 프로그램 · 편집 디자인
            <br />
            <span className="text-blue-300 text-base">특허 기술 기반, 기획부터 납품까지 원스톱 제작.</span>
          </>
        }
      />

      {/* Step 1: 주문 제작 형태 선택 게이트
          — 도면만 의뢰/제품 생산 선택 시 아래 카탈로그 노출, 완제품은 상담 안내 */}
      <ProductionTypeGate>
        {/* Catalog — 제품 종류별 / 용도별 토글 */}
        <ProductCatalogTabs />
      </ProductionTypeGate>

      {/* Process */}
      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#E91E8C" }}>
              제작 과정
            </p>
            <h2 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">
              주문은 이렇게 진행됩니다
            </h2>
            <p className="text-slate-500">
              제품에 따라 <strong style={{ color: "#1E22B2" }}>3주~6주</strong> 내 납품됩니다. (팝업북 약 3주 · 페이퍼 크래프트 6주 이상)
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 mb-12">
            {processSteps.map((s) => (
              <div key={s.num} className="pe-paper-lift bg-white border border-slate-100 rounded-2xl p-6 pe-paper-shadow">
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white pe-num text-lg flex-shrink-0"
                    style={{ background: s.color }}
                    aria-hidden
                  >
                    {s.num}
                  </div>
                  <div className="leading-tight">
                    <div className="text-xs font-semibold" style={{ color: s.color }}>{s.period}</div>
                    <div className="font-bold text-slate-900">{s.label}</div>
                  </div>
                </div>
                <p className="text-sm text-slate-500" style={{ wordBreak: "keep-all" }}>{s.detail}</p>
              </div>
            ))}
          </div>

          {/* Order Options */}
          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
            <h3 className="font-bold text-slate-900 mb-5 text-center tracking-tight">
              주문 제작 시 선택 사항
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {orderOptions.map((opt) => (
                <div key={opt.category} className="bg-white rounded-xl p-4 border border-slate-200">
                  <div className="text-sm font-semibold text-slate-700 mb-3">{opt.category}</div>
                  <div className="flex flex-wrap gap-2">
                    {opt.options.map((o) => (
                      <span
                        key={o}
                        className="text-xs px-3 py-1.5 rounded-lg border"
                        style={{ background: "#F0F2FF", color: "#1E22B2", borderColor: "#dee1ff" }}
                      >
                        {o}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 text-center mt-4" style={{ wordBreak: "keep-all" }}>
              움직임 선택 시 조립에 풀이 필요하며, 고정형은 풀 없이 끼우는 방식으로 제작 가능합니다.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 md:py-20 relative overflow-hidden" style={{ background: "#1E22B2" }}>
        <div className="absolute inset-0 pointer-events-none opacity-20">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-full max-w-2xl"><PaperNetBg className="w-full h-auto" /></div>
          </div>
        </div>
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-3 tracking-tight">만들고 싶은 것이 있으신가요</h2>
          <p className="text-blue-200 mb-2" style={{ wordBreak: "keep-all" }}>
            팝업북은 1부부터, 대량 제작까지 — 제품별 맞춤 견적으로 진행합니다.
          </p>
          <p className="text-blue-300 text-sm mb-8">견적 문의를 남겨 주시면 빠르게 회신드립니다.</p>
          <Link
            href="/quote"
            className="group inline-flex items-center justify-center gap-2 px-10 py-4 font-bold rounded-xl text-white text-lg shadow-xl shadow-pink-500/30 hover:-translate-y-0.5 transition-all"
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
