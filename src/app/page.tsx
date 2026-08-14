import type { Metadata } from "next";
import Link from "next/link";
import {
  PatentIcon,
  GlobeIcon,
  EducationIcon,
  LeafIcon,
  PaperToyIcon,
  GeometryIcon,
  CharacterIcon,
  PencilIcon,
  ArrowRightIcon,
  CheckIcon,
  BoxIcon,
  GearIcon,
  BuildingIcon,
  type IconKey,
} from "@/components/icons";
import { PortfolioPlaceholder, PatentBadge, PaperNetBg } from "@/components/paper-art";
import HeroShowcase from "@/components/HeroShowcase";
import PartnersMarquee from "@/components/PartnersMarquee";
import HomePortfolioGrid from "@/components/HomePortfolioGrid";
import StudioPhoto from "@/components/StudioPhoto";
import { PAGE_META, OG_IMAGE } from "@/lib/site";

export const metadata: Metadata = {
  title: PAGE_META.home.title,
  description: PAGE_META.home.description,
  alternates: { canonical: "/" },
  openGraph: {
    images: [OG_IMAGE],
    title: PAGE_META.home.title,
    description: PAGE_META.home.description,
    url: "/",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_META.home.title,
    description: PAGE_META.home.description,
  },
};

/* ────────────── 데이터 ────────────── */

const trustStats: { num: string; label: string; sub?: string; since?: string }[] = [
  { num: "11",     label: "지기구조 설계 특허",        sub: "종" },
  { num: "650+",   label: "누적 납품 프로젝트",         sub: "건", since: "2013년부터" },
  { num: "약 4주 내", label: "평균 납기" },
  { num: "지기구조", label: "전문 설계 스튜디오" },
];

const features: { icon: IconKey; title: string; desc: string; gradient: string }[] = [
  {
    icon: "patent",
    title: "지기구조 설계 특허 11종",
    desc: "움직이는 종이 구조를 직접 설계해 특허 11종으로 확보했습니다. 검증된 구조에서 시작해 완성도와 납기를 안정적으로 맞춥니다.",
    gradient: "from-cyan-400 to-blue-500",
  },
  {
    icon: "globe",
    title: "세계 페이퍼 엔지니어 네트워크",
    desc: "세계 각지의 페이퍼 엔지니어들과 협업하며 구조 설계 노하우를 넓혀 왔습니다. 입체를 전개도로 펴는 종이 구조 설계 교육도 운영합니다.",
    gradient: "from-amber-400 to-orange-500",
  },
  {
    icon: "science",
    title: "STEAM 교육 설계",
    desc: "도형·무게중심 같은 원리를 손으로 익히는 교구로 설계합니다. 박물관과 학교 현장에서 검증한 교육 콘텐츠를 제공합니다.",
    gradient: "from-pink-400 to-fuchsia-500",
  },
];

const services: { icon: IconKey; en: string; ko: string; desc: string; tags: string[]; accent: string }[] = [
  {
    icon: "paperToy",
    en: "Action Paper Toy",
    ko: "페이퍼 엔지니어링",
    desc: "캐릭터 구동 가능 플랫폼 제공 및 기관·기업 맞춤 제작",
    tags: ["움직이는 구조", "특허 기술", "친환경"],
    accent: "#06C6C8",
  },
  {
    icon: "geometry",
    en: "Education Kit",
    ko: "STEAM 교육 키트",
    desc: "방과 후 교육 프로그램, 업사이클링·코딩 전자 교육 키트",
    tags: ["STEAM 교육", "업사이클링", "키트 판매"],
    accent: "#F5C518",
  },
  {
    icon: "character",
    en: "Custom Character",
    ko: "캐릭터 & 굿즈",
    desc: "기관·관공서·기업 캐릭터 외주, 기념품·축제·체험 굿즈 제작",
    tags: ["캐릭터 개발", "대량 생산", "맞춤 제작"],
    accent: "#E91E8C",
  },
  {
    icon: "pencil",
    en: "Editorial Design",
    ko: "편집 디자인",
    desc: "BI/CI 개발, 브로셔·PPT 등 브랜드 아이덴티티 디자인",
    tags: ["BI/CI", "브로셔", "브랜딩"],
    accent: "#8B5CF6",
  },
];

const clients: { name: string; work: string; variant: "department" | "university" | "museum" | "city" | "character" | "generic" }[] = [
  { name: "현대백화점", work: "스마일리 페이퍼토이",     variant: "department" },
  { name: "KAIST",       work: "캐릭터 납육이",           variant: "university" },
  { name: "경주박물관",  work: "캐릭터 도토리",           variant: "museum" },
  { name: "수원시",      work: "캐릭터 수원이",           variant: "city" },
  { name: "공주시",      work: "고마곰과 공주",           variant: "character" },
  { name: "국립기관",    work: "다수 관공서 납품",         variant: "generic" },
];

const processSteps: { num: string; label: string; detail: string; period: string; icon: IconKey }[] = [
  { num: "01", label: "상담 및 기획",       detail: "생산 제품 종류 및 수량 결정",       period: "1주",  icon: "education" },
  { num: "02", label: "구조 설계 & 샘플링", detail: "컨셉 맞는 최적 움직임 설계",         period: "1주",  icon: "gear" },
  { num: "03", label: "디자인 작업",         detail: "고객사 피드백 반영 및 완성",         period: "1.5주", icon: "pencil" },
  { num: "04", label: "생산 및 납품",         detail: "공정 기반 생산, 패키징 후 납품",     period: "일정 협의", icon: "box" },
];

/* ────────────── 페이지 ────────────── */

export default function HomePage() {
  return (
    <>
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden" style={{ background: "#1E22B2" }}>
        {/* 배경: 영상이 있으면 영상, 없으면 기존 전개도 패턴 */}
        {process.env.NEXT_PUBLIC_HERO_VIDEO_URL ? (
          <>
            <video
              className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
              src={process.env.NEXT_PUBLIC_HERO_VIDEO_URL}
              poster={process.env.NEXT_PUBLIC_HERO_VIDEO_POSTER}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden
            />
            {/* 어두운 그라데이션 overlay — 텍스트 가독성 보장 */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(135deg, rgba(30,34,178,0.85) 0%, rgba(30,34,178,0.55) 50%, rgba(30,34,178,0.75) 100%)",
              }}
            />
          </>
        ) : (
          <div className="absolute inset-0 pointer-events-none select-none opacity-30">
            <div className="absolute -right-20 top-1/2 -translate-y-1/2 w-[80%] max-w-3xl -rotate-6">
              <PaperNetBg className="w-full h-auto" />
            </div>
          </div>
        )}

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left — Copy */}
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full mb-6 bg-white/10 text-white border border-white/15">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                지기구조 전문 설계 · 페이퍼 엔지니어링 스튜디오
              </span>

              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 leading-[1.2] tracking-tight">
                모든 종이 설계는<br />
                <span className="pe-gradient-text">P.E. 스튜디오</span>로 통합니다.
              </h1>
              <p className="text-lg md:text-xl text-blue-200 mb-4 leading-relaxed" style={{ wordBreak: "keep-all" }}>
                <strong className="text-white">지기구조 설계 특허 11종</strong>을 보유한
                {" "}<strong className="text-white">지기구조 전문 설계 스튜디오, 페이퍼 엔지니어링 스튜디오 (P.E Studio)</strong>입니다.
              </p>
              <blockquote
                className="border-l-2 pl-4 mb-4 text-blue-100/90 text-sm md:text-base leading-relaxed"
                style={{ borderColor: "#06C6C8", wordBreak: "keep-all" }}
              >
                2013년부터 종이의 구조와 움직임을 설계해 왔습니다.
              </blockquote>
              <p className="text-blue-200 mb-10" style={{ wordBreak: "keep-all" }}>
                그동안 기업과 공공기관, 박물관과 학교가 우리와 함께 일했습니다.
              </p>

              {/* CTA — Primary dominant + Secondary ghost */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/quote"
                  className="group inline-flex items-center justify-center gap-2 px-7 py-4 text-white font-bold rounded-xl text-base sm:text-lg shadow-lg shadow-pink-500/20 transition-all hover:shadow-xl hover:shadow-pink-500/30 hover:-translate-y-0.5"
                  style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
                >
                  무료 견적 받기
                  <ArrowRightIcon size={20} className="transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/products"
                  className="inline-flex items-center justify-center gap-2 px-7 py-4 text-white/90 hover:text-white font-semibold rounded-xl border border-white/20 hover:border-white/40 hover:bg-white/5 transition-colors text-base sm:text-lg"
                >
                  제품 살펴보기
                </Link>
              </div>
            </div>

            {/* Right — Hero showcase (브랜드 일러스트 ↔ 스튜디오 쇼룸 사진 cross-fade) */}
            <div className="hidden lg:block h-[540px]">
              <HeroShowcase className="w-full h-full" />
            </div>
          </div>
        </div>
      </section>

      {/* ─── Trust Bar (Stats) — 11종 dominant ─── */}
      <section className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-4">
            {trustStats.map((stat, i) => {
              const isHero = i === 0; // "특허 11종" 강조
              return (
                <div
                  key={stat.label}
                  className={`text-center ${isHero ? "md:col-span-1" : ""}`}
                >
                  <div
                    className="pe-num text-3xl md:text-5xl mb-1 flex items-baseline gap-1 justify-center"
                    style={{
                      color: isHero ? "#1E22B2" : "#475569",
                    }}
                  >
                    {stat.num}
                    {stat.sub && (
                      <span className="text-xl md:text-2xl text-slate-500 font-bold">{stat.sub}</span>
                    )}
                  </div>
                  <div className={`text-xs md:text-sm ${isHero ? "text-slate-700 font-semibold" : "text-slate-500"}`} style={{ wordBreak: "keep-all" }}>
                    {stat.label}
                  </div>
                  {stat.since && (
                    <div className="text-[11px] text-slate-400 mt-0.5">{stat.since}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 신뢰 배지 — 기관 납품·수상·특허 */}
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            {[
              { icon: "building", text: "국내외 주요 박물관·기관 납품" },
              { icon: "patent", text: "문화체육관광부 장관상 2회 수상" },
              { icon: "check", text: "특허청 등록 지기구조 설계 특허 11종" },
            ].map((b) => (
              <span
                key={b.text}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-slate-700 text-xs md:text-sm font-semibold"
              >
                <span className="text-[#1E22B2]" aria-hidden>
                  {b.icon === "building" && <BuildingIcon size={15} />}
                  {b.icon === "patent" && <PatentIcon size={15} />}
                  {b.icon === "check" && <CheckIcon size={15} />}
                </span>
                {b.text}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Social Proof — Partners Marquee (실제 로고 무한 슬라이드) ─── */}
      <section className="py-16 md:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* 스튜디오 쇼룸 사진 — '함께 일한 곳들' 위 */}
          <StudioPhoto
            src="/home/studio-1.jpg"
            alt="페이퍼 엔지니어링 스튜디오 쇼룸 — 건담·캐릭터 종이 모형 전시"
            caption="13년간 직접 설계해 만든 작업물들로 채운 스튜디오 쇼룸입니다."
            className="mb-12"
          />
          <div className="text-center mb-10">
            <p className="text-slate-500 text-xs font-semibold tracking-wide mb-2">함께 일한 곳</p>
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900">
              우리와 함께 일한 곳들
            </h2>
            <p className="text-sm text-slate-500 mt-3" style={{ wordBreak: "keep-all" }}>
              기업과 공공기관, 박물관과 교육기관이 우리와 함께 일했습니다.
            </p>
          </div>
          <PartnersMarquee />
          <p className="text-center text-xs text-slate-400 mt-6" style={{ wordBreak: "keep-all" }}>
            * 실제 작업물 사진은 작업 포트폴리오 페이지에서 확인하실 수 있습니다.
          </p>
        </div>
      </section>

      {/* ─── Gallery preview — Portfolio variants ─── */}
      <section className="py-16 md:py-24" style={{ background: "#F0F2FF" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold mb-3" style={{ color: "#1E22B2" }}>
                우리가 만든 것
              </h2>
              <p className="text-slate-500" style={{ wordBreak: "keep-all" }}>
                기관과 기업, 교육 현장에서 쓰인 작업들입니다.
              </p>
            </div>
            <Link
              href="/portfolio"
              className="inline-flex items-center gap-1 font-semibold whitespace-nowrap"
              style={{ color: "#1E22B2" }}
            >
              전체 작업물 보기
              <ArrowRightIcon size={18} />
            </Link>
          </div>
          <HomePortfolioGrid />
        </div>
      </section>

      {/* ─── Differentiation — Why PE Studio ─── */}
      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <p className="text-cyan-600 text-xs font-semibold tracking-wide mb-3">
              우리를 택하는 이유
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: "#1E22B2", wordBreak: "keep-all" }}>
              만들기 전에, 설계합니다
            </h2>
            <p className="text-slate-500" style={{ wordBreak: "keep-all" }}>
              특허로 검증한 구조 설계와 13년의 제작 경험을 바탕으로 작업합니다.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="pe-paper-lift bg-white rounded-2xl p-8 pe-paper-shadow border border-slate-100"
              >
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${f.gradient} text-white flex items-center justify-center mb-5 shadow-sm`}>
                  {f.icon === "patent" && <PatentIcon size={28} />}
                  {f.icon === "globe" && <GlobeIcon size={28} />}
                  {f.icon === "science" && <EducationIcon size={28} />}
                </div>
                <h3 className="text-xl font-bold mb-3 tracking-tight" style={{ color: "#1E22B2" }}>{f.title}</h3>
                <p className="text-slate-600 leading-relaxed text-sm" style={{ wordBreak: "keep-all" }}>{f.desc}</p>
              </div>
            ))}
          </div>

          {/* Patent badges row */}
          <div className="mt-12 pt-10 border-t border-slate-100">
            <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-400 mb-5">
              지기구조 설계 특허 11종 보유 (특허청 등록)
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <PatentBadge number="설계 특허" title="지기구조 페이퍼토이 설계 방법" />
              <PatentBadge number="구조 특허" title="탄성 메커니즘 종이 모형 구조" />
              <PatentBadge number="외 9종" title="지기구조 설계 특허군" />
            </div>
            <p className="text-center text-[11px] text-slate-400 mt-3">
              특허 등록증은 견적 상담 시 제공해 드립니다.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Services ─── */}
      <section className="py-16 md:py-24" style={{ background: "#F0F2FF" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#E91E8C" }}>
              제작 분야
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3" style={{ color: "#1E22B2" }}>
              우리가 만드는 것
            </h2>
            <p className="text-slate-500" style={{ wordBreak: "keep-all" }}>
              기획부터 납품까지, 종이로 만들 수 있는 모든 것.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {services.map((s) => (
              <Link
                key={s.ko}
                href="/products"
                className="pe-paper-lift group flex gap-5 p-6 rounded-2xl bg-white pe-paper-shadow border border-slate-100"
              >
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: s.accent + "18", color: s.accent }}
                  aria-hidden
                >
                  {s.icon === "paperToy" && <PaperToyIcon size={28} />}
                  {s.icon === "geometry" && <GeometryIcon size={28} />}
                  {s.icon === "character" && <CharacterIcon size={28} />}
                  {s.icon === "pencil" && <PencilIcon size={28} />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg mb-1 tracking-tight" style={{ color: "#1E22B2" }}>{s.ko}</h3>
                  <p className="text-sm text-slate-600 mb-3" style={{ wordBreak: "keep-all" }}>{s.desc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 text-slate-500"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Process ─── */}
      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#06C6C8" }}>
              제작 과정
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3" style={{ color: "#1E22B2" }}>
              주문은 이렇게 진행됩니다
            </h2>
            <p className="text-slate-500">
              대부분의 제품은 <strong style={{ color: "#1E22B2" }}>약 4주 내 납품</strong> 가능합니다.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {processSteps.map((s, i) => {
              const stepColors = ["#06C6C8", "#F5C518", "#E91E8C", "#1E22B2"];
              return (
                <div key={s.num} className="relative pe-paper-lift bg-white border border-slate-100 rounded-2xl p-6 pe-paper-shadow">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-12 h-12 rounded-xl text-white font-bold flex items-center justify-center pe-num text-lg flex-shrink-0"
                      style={{ background: stepColors[i] }}
                      aria-hidden
                    >
                      {s.num}
                    </div>
                    <div className="leading-tight">
                      {s.period !== "~" && (
                        <div className="text-xs font-semibold" style={{ color: stepColors[i] }}>{s.period}</div>
                      )}
                      <div className="font-bold text-slate-900">{s.label}</div>
                    </div>
                  </div>
                  <p className="text-sm text-slate-500" style={{ wordBreak: "keep-all" }}>{s.detail}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-10 p-5 bg-blue-50 rounded-2xl border border-blue-100 max-w-2xl mx-auto flex items-start gap-3">
            <CheckIcon size={20} className="text-blue-700 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-slate-700" style={{ wordBreak: "keep-all" }}>
              <strong style={{ color: "#1E22B2" }}>최소 수량 1,000부부터</strong> 제작 가능하며, 수량 증가 시 단가가 내려갑니다.
              포장(OPP/벌크), 형태(움직임/고정), 조립방식(점착/끼우기)을 선택할 수 있습니다.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="py-20 md:py-28 relative overflow-hidden" style={{ background: "#1E22B2" }}>
        <div className="absolute inset-0 pointer-events-none select-none opacity-20">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-full max-w-2xl"><PaperNetBg className="w-full h-auto" /></div>
          </div>
        </div>
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-amber-300 text-xs font-semibold uppercase tracking-widest mb-4">
            제작 의뢰
          </p>
          <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-5 leading-tight">
            종이의 움직임이 필요할 때,<br />
            <span className="pe-gradient-text">우리를 찾아 주세요</span>
          </h2>
          <p className="text-blue-200 text-lg mb-2" style={{ wordBreak: "keep-all" }}>
            지기구조 전문 설계 페이퍼 엔지니어링 스튜디오가 함께합니다.
          </p>
          <p className="text-blue-300 text-sm mb-10">
            제품 정보 입력 → 3영업일 이내 담당자 회신 · 최소 수량 1,000부 · 평균 납기 약 4주
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Link
              href="/quote"
              className="group inline-flex items-center justify-center gap-2 px-8 py-4 font-bold rounded-xl text-lg text-white shadow-xl shadow-pink-500/30 hover:shadow-2xl hover:-translate-y-0.5 transition-all"
              style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
            >
              무료 견적 받기
              <ArrowRightIcon size={20} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/faq"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/10 text-white font-semibold rounded-xl border border-white/20 hover:bg-white/20 transition-colors text-lg"
            >
              자주 묻는 질문
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
