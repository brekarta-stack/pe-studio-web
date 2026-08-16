import type { Metadata } from "next";
import { Geist } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, COMPANY, PAGE_META, BRAND_TAGLINE_KR } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/**
 * Pretendard — 한글 본문 폰트 (self-host)
 * 기존 jsdelivr CDN 로드는 (1) 가용성 장애(503), (2) CSP font-src 차단으로
 * production에서 실패해 system 폰트로 대체되고 있었음. next/font/local 로
 * 빌드 시 자체 호스팅 → CDN 의존 제거 + font-display:swap + CSP 'self' 충족.
 */
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
  weight: "45 920",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // default 는 root 페이지에서 metadata 미지정 시 fallback
    default: `${SITE_NAME} | ${PAGE_META.home.title}`,
    // 하위 페이지 metadata.title (string) 에 자동으로 ` | CES` suffix 부여
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "페이퍼 엔지니어링",
    "페이퍼 엔지니어링 스튜디오",
    "Paper Engineering",
    "Paper Engineering Studio",
    "PE Studio",
    "페이퍼토이 제작",
    "페이퍼토이 외주",
    "페이퍼토이 업체",
    "페이퍼토이 주문제작",
    "기업 굿즈 종이",
    "지자체 캐릭터 굿즈",
    "STEAM 교구",
    "팝업카드 제작",
    "오토마타 제작",
    "현대백화점 페이퍼토이",
    "KAIST 페이퍼토이",
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: {
    canonical: "/",
    // RSS 자동 발견 링크는 여기(metadata)가 아니라 layout 의 <head> 에서 직접 렌더한다.
    // 이유는 그쪽 주석 참고 — 하위 페이지의 alternates 선언에 덮이지 않게 하기 위함.
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} | ${PAGE_META.home.title}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | ${PAGE_META.home.title}`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  verification: {
    // 인증 코드: 환경변수가 있으면 우선, 없으면 등록된 기본값 사용.
    //   GOOGLE_SITE_VERIFICATION : Google Search Console 'HTML 태그' content
    //     (구글은 이미 다른 방식으로 소유확인됨 → env 없으면 메타 미출력)
    //   NAVER_SITE_VERIFICATION  : 네이버 서치어드바이저 'HTML 태그' content
    //     (아래 기본값으로 커밋 — 공개 토큰이라 비밀 아님. 추후 env 로 옮겨 override 가능)
    ...(process.env.GOOGLE_SITE_VERIFICATION
      ? { google: process.env.GOOGLE_SITE_VERIFICATION }
      : {}),
    other: {
      "naver-site-verification":
        process.env.NAVER_SITE_VERIFICATION ??
        "3e4a169f69936bf3c12d2d335644d309d8306b3f",
    },
  },
};

/**
 * 사이트 전체 공통 Organization JSON-LD.
 * Schema.org Organization 으로 회사의 정체성을 검색엔진에 직접 알림.
 */
function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: COMPANY.name,
    legalName: COMPANY.legalName,
    alternateName: COMPANY.shortName,
    url: SITE_URL,
    // schema.org logo 는 홍보 배너가 아니라 로고 자체여야 한다 —
    // OG 배너(1200×630) 대신 정사각 브랜드 아이콘을 가리킨다.
    logo: `${SITE_URL}/brand/pe-studio-icon-512.png`,
    description: SITE_DESCRIPTION,
    slogan: BRAND_TAGLINE_KR,
    foundingDate: COMPANY.foundingYear,
    founder: { "@type": "Person", name: COMPANY.representative },
    foundingLocation: {
      "@type": "Place",
      name: `${COMPANY.address.region} ${COMPANY.address.locality}`,
    },
    award: "문화체육관광부 장관상 2회 수상",
    email: COMPANY.email,
    ...(COMPANY.phone ? { telephone: COMPANY.phone } : {}),
    address: {
      "@type": "PostalAddress",
      addressLocality: COMPANY.address.locality,
      addressRegion: COMPANY.address.region,
      addressCountry: COMPANY.address.country,
      ...(COMPANY.address.streetAddress
        ? { streetAddress: COMPANY.address.streetAddress }
        : {}),
    },
    sameAs: [
      COMPANY.social.instagram,
      COMPANY.social.youtube,
      COMPANY.social.community,
    ].filter(Boolean),
    knowsAbout: [
      "페이퍼토이",
      "페이퍼 모델 엔지니어링",
      "오토마타",
      "팝업카드",
      "STEAM 교육",
      "캐릭터 굿즈",
      "BI/CI 디자인",
    ],
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/**
 * WebSite JSON-LD (사이트 검색 sitelink 노출용).
 */
function WebSiteJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: "ko-KR",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/**
 * LocalBusiness(ProfessionalService) JSON-LD — 로컬/지역 검색 노출 강화.
 * Organization 과 별개로 주소·전화·영업 분야를 가진 '사업장' 엔티티를 명시해
 * Google 로컬 검색·지식패널에서의 인식 가능성을 높인다.
 * (네이버 지역 노출은 별도로 '네이버 플레이스' 등록 필요)
 */
function LocalBusinessJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${SITE_URL}/#localbusiness`,
    parentOrganization: { "@id": `${SITE_URL}/#organization` },
    name: COMPANY.name,
    alternateName: COMPANY.shortName,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    image: `${SITE_URL}/opengraph-image`,
    ...(COMPANY.phone ? { telephone: COMPANY.phone } : {}),
    email: COMPANY.email,
    priceRange: "₩₩",
    foundingDate: COMPANY.foundingYear,
    address: {
      "@type": "PostalAddress",
      streetAddress: COMPANY.address.streetAddress,
      addressLocality: COMPANY.address.locality,
      addressRegion: COMPANY.address.region,
      addressCountry: COMPANY.address.country,
    },
    areaServed: { "@type": "Country", name: "대한민국" },
    knowsLanguage: ["ko", "en"],
    sameAs: [
      COMPANY.social.instagram,
      COMPANY.social.youtube,
      COMPANY.social.community,
    ].filter(Boolean),
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${pretendard.variable}`}>
      <head>
        {/*
          RSS 자동 발견. metadata.alternates.types 로 넣으면 하위 페이지가
          alternates(canonical)를 자체 선언하는 순간 통째로 교체돼 사라진다
          — Next 의 metadata 는 필드 단위 병합이 아니다. 전 페이지에 남아야 하는
          링크라 여기서 직접 렌더한다.
        */}
        <link
          rel="alternate"
          type="application/rss+xml"
          title={`${SITE_NAME} 블로그`}
          href={`${SITE_URL}/rss.xml`}
        />
      </head>
      <body className="min-h-screen flex flex-col antialiased">
        <OrganizationJsonLd />
        <WebSiteJsonLd />
        <LocalBusinessJsonLd />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
