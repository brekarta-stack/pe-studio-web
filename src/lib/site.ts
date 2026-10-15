/**
 * 사이트 전역 설정 - 메타데이터, 구조화 데이터, sitemap, robots 등에서 공통 사용.
 *
 * NEXT_PUBLIC_SITE_URL 환경변수가 있으면 그것을 사용, 없으면 papercraft.kr.
 * (NEXTAUTH_URL 은 인증 콜백용이므로 분리)
 */

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.papercraft.kr";

/**
 * 브랜드 네이밍 가이드
 *
 * - 정식 명칭: Paper Engineering Studio
 * - 약칭: PE Studio
 * - 한글 슬로건: "지기구조 전문 설계 스튜디오, 페이퍼 엔지니어링 스튜디오 (P.E Studio)" (검색어 자산 확보용 반복 키워드)
 */
export const SITE_NAME = "Paper Engineering Studio";
export const SITE_SHORT = "PE Studio";
export const BRAND_TAGLINE_KR = "지기구조 전문 설계 스튜디오";
export const BRAND_TAGLINE_EN = "Specialist Paper Engineering Studio";

export const SITE_DESCRIPTION =
  "Paper Engineering Studio(PE Studio)는 지기구조 설계 특허 11종을 보유한 지기구조 전문 설계 스튜디오, 페이퍼 엔지니어링 스튜디오 (P.E Studio)입니다. 움직이는 페이퍼 크래프트·액션 페이퍼 토이·팝업북·폼보드(우드락)를 주문 제작합니다. 2013년 창업, 현대백화점·KAIST 등 650건 이상 납품 실적.";

/**
 * 회사 정보 (Schema.org Organization, 푸터, 연락처 등에서 공통 사용)
 *
 * TODO: 사용자 확인 필요 항목 - placeholder 로 유지
 * - businessNumber: 사업자등록번호
 * - phone: 실제 연락처 (또는 카카오톡 채널 URL)
 * - kakaoChannel: 카카오톡 채널 URL
 * - addressDetail: 구체 주소
 * - foundingYear: 정확한 설립 연도
 */
interface CompanyInfo {
  name: string;
  shortName: string;
  legalName: string;
  representative: string;
  email: string;
  phone: string;
  /** 운영 시간 (예: 월 ~ 금, 10:00 ~ 19:00) */
  businessHours: string;
  kakaoChannel: string;
  address: {
    locality: string;
    region: string;
    country: string;
    streetAddress: string;
  };
  foundingYear: string;
  businessNumber: string;
  social: {
    instagram: string;
    youtube: string;
    community: string;
  };
}

export const COMPANY: CompanyInfo = {
  name: SITE_NAME,
  shortName: SITE_SHORT,
  legalName: "페이퍼 엔지니어링 스튜디오",
  representative: "오세기",
  email: "ask@papercraft.kr",
  phone: "+82-10-4075-2661",
  businessHours: "월 ~ 금, 10:00 ~ 19:00",
  kakaoChannel: "",
  address: {
    locality: "서울",
    region: "서울특별시",
    country: "KR",
    streetAddress: "강남구 언주로 563 원에디션 102동-408호",
  },
  foundingYear: "2013",
  businessNumber: "제2014-울산동구-00006호",
  social: {
    instagram: "",
    youtube: "",
    community: "https://finalpaper.net",
  },
};

/**
 * 콘텐츠 대표 저자 — 검색·AI 의 E-E-A-T(경험·전문성·권위·신뢰) 신호용.
 * 스튜디오 성격상 대표(오세기)를 블로그 글의 전문 저자로 명시한다.
 * (JSON-LD Person / 메타 authors / 글 하단 저자 소개에서 공통 사용)
 */
export const AUTHOR = {
  name: COMPANY.representative, // 오세기
  title: `${SITE_SHORT} 대표`, // PE Studio 대표
  bio: "2013년 Paper Engineering Studio(구 액션크래프트)를 설립해 지기구조 설계 특허 11종을 보유하고 문화체육관광부 장관상을 2회 수상했습니다. 페이퍼토이·팝업북·오토마타 등 움직이는 종이 구조를 직접 설계합니다.",
  url: `${SITE_URL}/about`,
} as const;

/**
 * 페이지별 메타데이터 사전 정의
 * - title 은 layout.tsx 의 template "%s | PE Studio" 가 자동으로 붙이므로 suffix 없이 작성
 * - "페이퍼 엔지니어링" 키워드를 핵심 페이지에 반복 노출
 */
export const PAGE_META = {
  home: {
    title: "페이퍼토이·팝업북·액션페이퍼 제작 외주",
    description:
      "Paper Engineering Studio — 지기구조 설계 특허 11종을 보유한 지기구조 전문 설계 스튜디오, 페이퍼 엔지니어링 스튜디오 (P.E Studio). 페이퍼 크래프트·액션 페이퍼 토이·팝업북·폼보드(우드락)를 주문 제작합니다. 2013년 창업, 현대백화점·KAIST 등 650건 이상 납품.",
  },
  about: {
    title: "회사소개 — 지기구조 전문 설계 페이퍼 엔지니어링 스튜디오",
    description:
      "PE Studio(Paper Engineering Studio)는 지기구조 설계 특허 11종을 보유한 지기구조 전문 설계 스튜디오, 페이퍼 엔지니어링 스튜디오 (P.E Studio)입니다. 글로벌 페이퍼 엔지니어 네트워크와 STEAM 교육 전문성을 갖췄습니다.",
  },
  products: {
    title: "페이퍼 엔지니어링 주문 제작 서비스",
    description:
      "Action Paper Toy, STEAM 교육 키트, 캐릭터 굿즈, BI/CI 편집 디자인. 페이퍼 엔지니어링 기술로 최소 1,000부부터 평균 3~4주 납기로 페이퍼토이 외주 제작이 가능합니다.",
  },
  portfolio: {
    title: "현대백화점·KAIST 페이퍼 엔지니어링 작업 포트폴리오",
    description:
      "현대백화점 스마일리, KAIST 납육이, 경주박물관 도토리, 수원시 수원이 등 PE Studio가 페이퍼 엔지니어링 기술로 제작한 페이퍼토이·캐릭터 굿즈 사례.",
  },
  blog: {
    title: "페이퍼 엔지니어링 원리·STEAM 교육 블로그",
    description:
      "오토마타 원리, 팝업카드 설계법, STEAM 교육 활용 사례, 브랜드 굿즈 제작 비하인드 등 페이퍼 엔지니어링 콘텐츠.",
  },
  quote: {
    title: "1분 제작 문의 — 페이퍼 엔지니어링 제작 비용",
    description:
      "수량·옵션·납기만 입력하면 1분이면 끝. 3영업일 이내 담당자가 맞춤 견적을 회신드립니다. 페이퍼 크래프트·액션 페이퍼 토이·팝업북·폼보드(우드락) 제작.",
  },
  faq: {
    title: "자주 묻는 질문 — 페이퍼 엔지니어링 제작 FAQ",
    description:
      "최소 수량, 평균 납기, 디자인 보유 여부, 지자체 입찰, 가격대 등 페이퍼 엔지니어링 외주 제작 시 자주 묻는 질문.",
  },
  download: {
    title: "무료 다운로드 — 페이퍼크래프트 스튜디오 (종이접기 전개도 프로그램)",
    description:
      "PE Studio가 만든 무료 데스크톱 프로그램. 동물·공룡·탈것·건축물 등 내장 디자인이나 내 사진·3D 파일을 자르고 접어 만드는 종이공예 전개도(페이퍼크래프트)로 바꿔, 실측 1:1 인쇄 PDF·커터용 SVG/DXF로 내보냅니다. Windows 무설치.",
  },
} as const;

/**
 * 무료 배포 프로그램 — 페이퍼크래프트 스튜디오 (Papercraft Studio)
 *
 * ## 이 파일에 원본 URL을 직접 박지 말 것
 *
 * 126MB 바이너리의 호스팅이 지금까지 두 번 죽었다. 두 번 다 "버튼이 404/403" 으로 발견됐고,
 * 그 사이 유입은 통째로 날아갔다.
 *   · 2026-08-25 — GitHub 계정(brekarta-stack)이 플래그돼 비로그인 사용자에게 404.
 *     릴리스 직링크 전멸 → Vercel Blob 으로 이관.
 *   · 2026-09-15 — 그 Vercel Blob 스토어가 Hobby 무료 전송량 한도 초과로 정지
 *     (limits-exceeded-suspended) → 403. 126MB × 약 80회면 월 한도가 찬다.
 *
 * 그래서 대외에 노출되는 주소는 항상 우리 도메인의 `href`(/download/app) 하나로 고정한다.
 * 블로그·SNS·QR에 퍼진 링크가 호스팅 이전 때문에 깨지지 않게 하려는 것이다.
 * 실제 파일 위치(`url`)는 이 상수 또는 DOWNLOAD_FILE_URL 환경변수로만 갈아 끼운다.
 *
 * ## 새 버전 배포 절차
 *   1. `npm run publish:download -- <zip 경로> <버전>`
 *      (업로드 → 공개 설정 → 익명 다운로드 검증까지 한다. 필요한 자격증명은 그 파일 주석에)
 *   2. 스크립트가 출력한 URL 로 아래 기본값과 version / fileSize 갱신
 *   3. `node --test tests/download.test.mjs` 로 링크 생존 확인
 */

/**
 * 배포 파일의 실제 위치. 환경변수가 있으면 그쪽이 이긴다 —
 * 호스팅이 또 죽었을 때 코드 수정·리뷰 없이 Vercel 환경변수만 바꿔 되살리기 위한 비상구다.
 * 모듈 최상위라 서버 프로세스가 뜰 때(콜드 스타트) 한 번 평가된다 — 번들에 값이
 * 구워지지 않으므로 재빌드는 필요 없지만, Vercel 은 환경변수를 배포에 주입하는 구조라
 * 대시보드에서 값을 바꾼 뒤 재배포(Redeploy)를 눌러야 반영된다.
 */
const DOWNLOAD_FILE_URL =
  process.env.DOWNLOAD_FILE_URL ??
  "https://pub-REPLACE_ME.r2.dev/downloads/v1.3/PapercraftStudio-windows-x64.zip";

export const DOWNLOAD = {
  appName: "페이퍼크래프트 스튜디오",
  appNameEn: "Papercraft Studio",
  version: "1.3",
  platform: "Windows 10 / 11 (64-bit)",
  fileName: "PapercraftStudio-windows-x64.zip",
  fileSize: "약 126 MB",
  /** 대외 노출용 고정 주소. 버튼·JSON-LD·외부 공유 링크는 전부 이걸 쓴다. */
  href: "/download/app",
  /** 원본 파일 위치. `/download/app` 라우트가 여기로 302 한다. 직접 링크하지 말 것. */
  url: DOWNLOAD_FILE_URL,
  price: "무료",
} as const;

/**
 * 페이지 공용 오픈그래프 대표 이미지.
 *
 * app/opengraph-image.tsx 는 파일이 놓인 세그먼트(=홈)에만 적용되고 하위 라우트로
 * 상속되지 않는다. 게다가 페이지가 metadata.openGraph 를 자체 선언하면 그 객체가
 * 통째로 교체돼 이미지가 사라진다 — 실제로 /about·/products·/faq·/quote·/download·
 * /blog·/portfolio·/studio 에서 og:image 가 비어 있었다(네이버 URL 검사 지적).
 *
 * 그래서 openGraph 를 선언하는 페이지는 반드시 `images: [OG_IMAGE]` 를 함께 넣는다.
 */
/**
 * OG 이미지 버전. 이미지 내용이 바뀌어도 URL 이 그대로면 카카오톡·페이스북·네이버가
 * 캐시된 옛 썸네일을 계속 보여준다. 디자인을 바꿀 때마다 이 값을 올려 URL 을 갈아 준다.
 * (2 = 2026-08 만세 인형 로고 적용)
 */
const OG_VERSION = "2";

export const OG_IMAGE = {
  url: `${SITE_URL}/opengraph-image?v=${OG_VERSION}`,
  width: 1200,
  height: 630,
  alt: `${SITE_NAME} — ${BRAND_TAGLINE_KR}`,
} as const;
