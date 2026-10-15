import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import { PAGE_META, DOWNLOAD, SITE_URL, OG_IMAGE } from "@/lib/site";
import {
  ArrowRightIcon,
  CheckIcon,
  BoxIcon,
  SparkleIcon,
  PencilIcon,
  GeometryIcon,
  RocketIcon,
  GearIcon,
} from "@/components/icons";

export const metadata: Metadata = {
  title: PAGE_META.download.title,
  description: PAGE_META.download.description,
  alternates: { canonical: "/download" },
  openGraph: {
    images: [OG_IMAGE],
    title: PAGE_META.download.title,
    description: PAGE_META.download.description,
    url: "/download",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_META.download.title,
    description: PAGE_META.download.description,
  },
};

/** 프로그램 특징 */
const FEATURES = [
  {
    Icon: BoxIcon,
    title: "140종 내장 디자인",
    desc: "동물·공룡·탈것·세계/한국 건축물·캐릭터까지. 고르기만 하면 자르고 접을 도면이 바로 만들어져요.",
  },
  {
    Icon: SparkleIcon,
    title: "사진·3D·AI 입력",
    desc: "내 사진을 종이 스탠드로, 내 3D 파일(OBJ·STL·PLY·GLB)을 전개도로. 텍스트로 설명하면 AI가 3D를 만들어 줍니다.",
  },
  {
    Icon: PencilIcon,
    title: "도면 편집",
    desc: "색·글자·이미지 넣기, 선 숨김/색칠, 접착 날개 편집, 부품 자르기·잇기, 정렬·분배까지 화면에서 바로.",
  },
  {
    Icon: GeometryIcon,
    title: "쉬운 조립 · 2.5D 모드",
    desc: "복잡한 모형은 큰 평면 층으로 나눠 겹쳐 붙이는 2.5D로 — 작은 조각·풀칠 날개 없이 손으로 쉽게. 자르기·산접기·골접기는 색으로 구분해요.",
  },
  {
    Icon: RocketIcon,
    title: "실측 1:1 인쇄 PDF",
    desc: "A0~B6 종이에 맞춰 실제 크기로 여러 장에 나눠 인쇄. 조립 지도와 스케일바가 들어 있어요.",
  },
  {
    Icon: GearIcon,
    title: "커터용 SVG·DXF",
    desc: "크리컷·실루엣·레이저 커터용 벡터 출력. 칼선/오시선 레이어 분리, 도무송(따냄) 모드 지원.",
  },
];

/** 3단계 사용법 */
const STEPS = [
  {
    no: "1",
    title: "고르기",
    desc: "내장 디자인에서 만들고 싶은 모형을 고르거나, 사진·3D 파일·AI 텍스트로 입력해요.",
  },
  {
    no: "2",
    title: "인쇄하기",
    desc: "[전개도 생성] → PDF로 저장 → 100%(실제 크기)로 인쇄합니다.",
  },
  {
    no: "3",
    title: "조립하기",
    desc: "선을 따라 오리고, 번호대로 접고 붙이면 완성! 그림 사용설명서가 프로그램에 들어 있어요.",
  },
];

interface FAQItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    question: "정말 무료인가요?",
    answer:
      "네, 완전 무료입니다. 개인·가정·학교 교육 용도로 자유롭게 사용하세요. 설치 비용이나 결제, 회원가입이 없습니다.",
  },
  {
    question: "설치가 필요한가요?",
    answer:
      "아니요. 압축(zip)을 푼 뒤 PapercraftStudio.exe 를 더블클릭하면 바로 실행됩니다. 파이썬 등 별도 설치가 필요 없는 단독 실행 프로그램입니다.",
  },
  {
    question: "실행하면 ‘Windows의 PC 보호’ 파란 창이 떠요.",
    answer:
      "개인 개발 프로그램이라 아직 코드 서명 인증서가 없어 Windows SmartScreen이 경고를 띄웁니다. 안전하니 파란 창에서 ‘추가 정보’ → ‘실행’ 을 눌러 주세요.",
  },
  {
    question: "백신이 위험하다고 표시해요.",
    answer:
      "단독 실행 파일(PyInstaller)로 만든 프로그램은 백신이 드물게 오탐하는 경우가 있습니다. 악성 코드가 없는 안전한 프로그램이며, 오탐이 의심되면 예외 처리 후 사용하시거나 ask@papercraft.kr 로 문의해 주세요.",
  },
  {
    question: "맥(Mac)이나 모바일에서도 되나요?",
    answer:
      "현재는 Windows 10 / 11 (64비트) 전용입니다. macOS·모바일 지원은 검토 중입니다.",
  },
  {
    question: "어떤 종이에 인쇄하면 되나요?",
    answer:
      "A4 일반 용지로 충분합니다. 두께가 있는 모형은 120~180g 정도의 조금 두꺼운 종이를 쓰면 더 튼튼합니다. 인쇄 대화상자에서 반드시 ‘실제 크기 / 100% / 배율 맞춤 끄기’ 로 출력해야 치수가 정확합니다.",
  },
  {
    question: "만든 도안을 상업적으로 써도 되나요?",
    answer:
      "개인·교육 용도는 자유입니다. 판매·전시·브랜드 굿즈 등 상업적 활용이나 대량 제작이 필요하시면 ask@papercraft.kr 로 문의해 주세요. PE Studio가 전문 설계·생산까지 도와드립니다.",
  },
];

function JsonLd() {
  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: DOWNLOAD.appNameEn,
    alternateName: DOWNLOAD.appName,
    applicationCategory: "DesignApplication",
    operatingSystem: "Windows 10, Windows 11",
    softwareVersion: DOWNLOAD.version,
    downloadUrl: `${SITE_URL}${DOWNLOAD.href}`,
    description: PAGE_META.download.description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
    publisher: { "@type": "Organization", name: "Paper Engineering Studio", url: SITE_URL },
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(software) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
      />
    </>
  );
}

/**
 * 다운로드 버튼.
 *
 * href 는 벤더 URL 이 아니라 우리 도메인의 고정 경로(/download/app)다 — 호스팅을 옮겨도
 * 이 링크는 산다. rel=nofollow 는 크롤러가 따라가 126MB 전송을 태우는 걸 막는다
 * (robots.ts·route.ts 의 X-Robots-Tag 와 같은 목적).
 */
function DownloadButton({ large = false }: { large?: boolean }) {
  return (
    <a
      href={DOWNLOAD.href}
      download
      rel="nofollow"
      className={`group inline-flex items-center justify-center gap-2.5 font-bold rounded-xl text-white shadow-lg hover:-translate-y-0.5 transition-all ${
        large ? "px-9 py-4.5 text-lg" : "px-7 py-3.5 text-base"
      }`}
      style={{ background: "linear-gradient(135deg, #06C6C8, #1E22B2)" }}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
      Windows용 무료 다운로드
      <ArrowRightIcon size={18} className="transition-transform group-hover:translate-x-1" />
    </a>
  );
}

export default function DownloadPage() {
  return (
    <>
      <JsonLd />

      {/* Hero */}
      <PageHero
        eyebrow="다운로드"
        title={<span className="pe-gradient-text">페이퍼크래프트 스튜디오</span>}
        subtitle={
          <>
            내장 디자인·사진·3D 모델을 자르고 접어 만드는
            <br className="hidden sm:block" />
            종이공예 전개도로 바꿔 주는 무료 프로그램입니다.
          </>
        }
      />

      {/* Hero 다운로드 버튼 */}
      <section className="py-10 md:py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <DownloadButton large />
            <p className="text-slate-500 text-sm">
              {DOWNLOAD.version} 버전 · {DOWNLOAD.platform} · {DOWNLOAD.fileSize} · 설치 불필요
            </p>
          </div>
        </div>
      </section>

      {/* 특징 */}
      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4" style={{ color: "#1E22B2" }}>
              이런 걸 할 수 있어요
            </h2>
            <p className="text-slate-600 max-w-2xl mx-auto" style={{ wordBreak: "keep-all" }}>
              전문 전개도 도구 수준의 기능을, 초등학생도 따라 만들 수 있게 한글로 담았습니다.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ Icon, title, desc }) => (
              <div
                key={title}
                className="pe-paper-shadow rounded-2xl border border-slate-200 bg-white p-6 hover:-translate-y-1 transition-transform"
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: "#F0F2FF" }}
                >
                  <Icon size={26} className="text-[#1E22B2]" />
                </div>
                <h3 className="font-bold text-lg text-slate-900 mb-2">{title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed" style={{ wordBreak: "keep-all" }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3단계 사용법 */}
      <section className="py-16 md:py-24" style={{ background: "#F0F2FF" }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-14 text-center" style={{ color: "#1E22B2" }}>
            세 번이면 완성
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.no} className="text-center">
                <div
                  className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-white text-2xl font-extrabold mb-5 shadow-lg"
                  style={{ background: "linear-gradient(135deg, #06C6C8, #1E22B2)" }}
                >
                  {s.no}
                </div>
                <h3 className="font-bold text-xl text-slate-900 mb-2">{s.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed" style={{ wordBreak: "keep-all" }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 시스템 요구사항 + 설치 안내 */}
      <section className="py-16 md:py-20 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-7">
            <h2 className="text-xl font-bold text-slate-900 mb-5">받아서 쓰는 법 · 준비물</h2>
            <ul className="space-y-3 text-slate-700 text-sm">
              {[
                ["운영체제", DOWNLOAD.platform],
                ["설치", "압축을 풀고 PapercraftStudio.exe 더블클릭 (Python·별도 설치 불필요)"],
                ["인쇄", "A4 프린터 · PDF를 100%(실제 크기)로 출력"],
                ["가격", DOWNLOAD.price],
              ].map(([k, v]) => (
                <li key={k} className="flex items-start gap-3">
                  <CheckIcon size={18} className="text-[#06C6C8] flex-shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-900">{k}</strong> · {v}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" style={{ wordBreak: "keep-all" }}>
              <strong>처음 실행 시 안내</strong> — 코드 서명이 없는 개인 개발 프로그램이라
              &lsquo;Windows의 PC 보호&rsquo; 파란 창이 뜰 수 있어요. 안전하니{" "}
              <strong>&lsquo;추가 정보&rsquo; → &lsquo;실행&rsquo;</strong> 을 눌러 주세요.
            </div>
          </div>
          <div className="mt-8 text-center">
            <DownloadButton />
            <p className="text-slate-400 text-xs mt-3">
              {DOWNLOAD.fileName} · {DOWNLOAD.fileSize}
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 md:py-24" style={{ background: "#F0F2FF" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-10 text-center" style={{ color: "#1E22B2" }}>
            자주 묻는 질문
          </h2>
          <div className="space-y-4">
            {FAQ_ITEMS.map((item) => (
              <details
                key={item.question}
                className="group bg-white hover:bg-slate-50 rounded-2xl border border-slate-200 transition-colors"
              >
                <summary className="cursor-pointer p-5 font-semibold text-slate-900 flex items-start gap-3">
                  <span
                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-sm font-bold"
                    style={{ background: "#1E22B2" }}
                  >
                    Q
                  </span>
                  <span className="flex-1">{item.question}</span>
                  <span className="text-slate-400 group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <div className="px-5 pb-5 pl-14 text-slate-700 leading-relaxed" style={{ wordBreak: "keep-all" }}>
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4" style={{ color: "#1E22B2" }}>
            대량 제작·맞춤 굿즈가 필요하세요?
          </h2>
          <p className="text-slate-600 mb-8" style={{ wordBreak: "keep-all" }}>
            직접 만든 도안을 실제 제품으로 양산하거나, 브랜드 굿즈·교육 키트로 만들고 싶다면
            PE Studio가 설계부터 생산까지 도와드립니다.
          </p>
          <Link
            href="/quote"
            className="group inline-flex items-center justify-center gap-2 px-8 py-4 font-bold rounded-xl text-white text-lg shadow-lg hover:-translate-y-0.5 transition-all"
            style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
          >
            제작 문의하기
            <ArrowRightIcon size={20} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>
    </>
  );
}
