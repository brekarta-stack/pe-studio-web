import type { Metadata } from "next";
import Link from "next/link";
import { PAGE_META, OG_IMAGE } from "@/lib/site";
import { ArrowRightIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: PAGE_META.faq.title,
  description: PAGE_META.faq.description,
  alternates: { canonical: "/faq" },
  openGraph: {
    images: [OG_IMAGE],
    title: PAGE_META.faq.title,
    description: PAGE_META.faq.description,
    url: "/faq",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_META.faq.title,
    description: PAGE_META.faq.description,
  },
};

interface FAQItem {
  category: string;
  question: string;
  answer: string;
}

/**
 * FAQ 항목.
 * 검색엔진의 FAQPage 리치 스니펫에 노출되도록 JSON-LD 와 동기화됨.
 */
const FAQ_ITEMS: FAQItem[] = [
  // 견적·수량
  {
    category: "견적·수량",
    question: "최소 주문 수량은 어떻게 되나요?",
    answer:
      "Action Paper Toy 기준 최소 1,000부부터 제작 가능합니다. STEAM 교육 키트는 30세트, 캐릭터 굿즈는 제품에 따라 다르며, 수량이 증가할수록 단가가 내려갑니다.",
  },
  {
    category: "견적·수량",
    question: "대략적인 가격대를 알려주실 수 있나요?",
    answer:
      "제품의 크기·움직임 구조·포장 형태(OPP/벌크)·조립 방식(점착/끼우기)에 따라 단가가 달라집니다. 참고로 페이퍼토이는 1,000부 기준 개당 약 2,500~4,000원대에서 형성되며, 제작 문의 페이지에 수량·옵션을 남겨주시면 3영업일 이내 담당자가 정확한 맞춤 견적을 회신드립니다.",
  },
  {
    category: "견적·수량",
    question: "디자인을 보유하고 있지 않아도 의뢰 가능한가요?",
    answer:
      "네, 가능합니다. PE Studio는 BI/CI 편집 디자인 서비스도 제공하므로, 컨셉만 있어도 기획·설계·디자인까지 원스톱으로 진행 가능합니다. 캐릭터와 구조를 처음부터 함께 설계해 드립니다.",
  },

  // 납기·생산
  {
    category: "납기·생산",
    question: "평균 납기는 얼마나 걸리나요?",
    answer:
      "대부분의 제품은 3~4주 내 납품 가능합니다. ①상담·기획(1주) → ②구조 설계 및 샘플링(1주) → ③디자인 작업(1.5주) → ④생산·납품 순서로 진행됩니다.",
  },
  {
    category: "납기·생산",
    question: "급한 일정이면 단축 가능한가요?",
    answer:
      "기존 설계가 있는 경우, 또는 구조 변경 없이 그래픽만 변경하는 경우에는 2주 이내 납품도 가능합니다. 견적 요청 시 희망 납기를 함께 알려주세요.",
  },
  {
    category: "납기·생산",
    question: "샘플을 먼저 받아볼 수 있나요?",
    answer:
      "네, 본 생산 전 디자인·움직임을 확인할 수 있도록 샘플 작업을 진행합니다. 샘플 비용은 별도이며 견적서에 명시됩니다.",
  },

  // 기관·지자체
  {
    category: "기관·지자체",
    question: "지자체 입찰 또는 관공서 납품이 가능한가요?",
    answer:
      "네, 가능합니다. 수원시, 공주시, 경주박물관, 국립기관 등 다수의 지자체·공공기관 납품 경험이 있습니다. 나라장터·G2B 등록 업체로 등록 가능 여부는 요청 시 안내드립니다.",
  },
  {
    category: "기관·지자체",
    question: "캐릭터 IP가 없어도 굿즈 제작이 가능한가요?",
    answer:
      "네, 기관·지자체의 컨셉(역사·문화·관광 자원 등)을 토대로 캐릭터를 새로 개발해 드립니다. 수원이, 고마곰, 도토리 등 다수 사례가 있습니다.",
  },

  // 제품·기술
  {
    category: "제품·기술",
    question: "어떻게 종이가 스스로 움직이나요?",
    answer:
      "PE Studio는 지기구조 설계 특허 11종을 기반으로 ①도형·내각 원리, ②무게중심·중력, ③탄성력 등을 활용해 평면이 입체로 변하거나 누워있던 물체가 스스로 일어나는 구조를 설계합니다.",
  },
  {
    category: "제품·기술",
    question: "친환경 소재로 제작 가능한가요?",
    answer:
      "네, FSC 인증지, 재생지, 콩기름 잉크 등 친환경 소재 선택이 가능합니다. 업사이클링 컨셉의 캐릭터 키트도 별도로 운영하고 있습니다.",
  },
  {
    category: "제품·기술",
    question: "교육용 STEAM 키트는 어떻게 다른가요?",
    answer:
      "수학(도형의 내각·전개도), 과학(무게중심·탄성력), 공학(메커니즘 설계)을 캐릭터로 자연스럽게 학습할 수 있도록 설계된 교육 키트입니다. 방과 후 교육 프로그램과 연계 가능합니다.",
  },

  // 협업·기타
  {
    category: "협업·기타",
    question: "해외 발송도 가능한가요?",
    answer:
      "국내 생산 후 해외 발송이 가능하며, 별도 운송비가 발생합니다. 글로벌 페이퍼 엔지니어 네트워크와 해외 전시를 통해 협업 경험도 보유하고 있습니다.",
  },
  {
    category: "협업·기타",
    question: "교육 강의·워크숍 운영도 가능한가요?",
    answer:
      "네, 페이퍼토이 만들기 워크숍, STEAM 교육 강의, 입체 전개도 설계 교육 등을 운영하고 있습니다. 기업·학교·기관 단위 출강 가능합니다.",
  },
];

function FAQJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
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

export default function FaqPage() {
  // 카테고리별 그룹핑
  const categories = Array.from(new Set(FAQ_ITEMS.map((i) => i.category)));

  return (
    <>
      <FAQJsonLd />

      {/* Hero */}
      <section className="relative py-20 md:py-28 overflow-hidden" style={{ background: "#1E22B2" }}>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full mb-6 bg-white/10 text-white border border-white/15">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            도움말
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight leading-[1.1]">
            <span className="pe-gradient-text">자주 묻는 질문</span>
          </h1>
          <p className="text-blue-200 text-lg max-w-2xl mx-auto" style={{ wordBreak: "keep-all" }}>
            제작 문의 전 자주 묻는 질문을 확인해 보세요.
            <br />
            답변에 없는 내용은 자동 견적 페이지에서 문의해 주시면 빠르게 회신드립니다.
          </p>
        </div>
      </section>

      {/* FAQ List */}
      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          {categories.map((category) => {
            const items = FAQ_ITEMS.filter((i) => i.category === category);
            return (
              <div key={category} className="mb-12">
                <h2
                  className="text-2xl font-bold mb-6 pb-3 border-b-2"
                  style={{ color: "#1E22B2", borderColor: "#1E22B2" }}
                >
                  {category}
                </h2>
                <div className="space-y-4">
                  {items.map((item) => (
                    <details
                      key={item.question}
                      className="group bg-slate-50 hover:bg-slate-100 rounded-2xl border border-slate-200 transition-colors"
                    >
                      <summary className="cursor-pointer p-5 font-semibold text-slate-900 flex items-start gap-3">
                        <span
                          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-sm font-bold"
                          style={{ background: "#1E22B2" }}
                        >
                          Q
                        </span>
                        <span className="flex-1">{item.question}</span>
                        <span className="text-slate-400 group-open:rotate-180 transition-transform">
                          ▾
                        </span>
                      </summary>
                      <div className="px-5 pb-5 pl-14 text-slate-700 leading-relaxed">
                        {item.answer}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16" style={{ background: "#F0F2FF" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4" style={{ color: "#1E22B2" }}>
            궁금증이 해결되지 않으셨나요?
          </h2>
          <p className="text-slate-600 mb-8">
            자동 견적 페이지에서 제품 정보를 입력하시면, 3영업일 이내
            담당자가 회신 드립니다.
          </p>
          <Link
            href="/quote"
            className="group inline-flex items-center justify-center gap-2 px-8 py-4 font-bold rounded-xl text-white text-lg shadow-lg shadow-pink-500/25 hover:-translate-y-0.5 transition-all"
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
