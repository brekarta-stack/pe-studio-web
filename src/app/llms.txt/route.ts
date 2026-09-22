/**
 * /llms.txt — 생성형 AI(LLM) 검색 엔진이 사이트를 정확히 이해·요약·인용하도록 돕는
 * 큐레이션 요약 파일 (llmstxt.org 제안 표준).
 *
 * robots.txt 가 "어디를 크롤링해도 되는지"를 알려준다면, llms.txt 는
 * "이 사이트의 핵심 사실과 중요한 페이지가 무엇인지"를 LLM 에 압축 제공한다.
 * 회사 사실(설립/대표/특허/수상/납품처/가격·납기)을 한곳에 모아, ChatGPT·Claude·
 * Perplexity·Google AI Overviews 등이 잘못된 추정 없이 인용하도록 한다.
 */
import { COMPANY, SITE_NAME, SITE_URL, BRAND_TAGLINE_KR } from "@/lib/site";
import { getPostSummaries } from "@/lib/blog";
import { getItems } from "@/lib/portfolio";
import { deriveSlug } from "@/lib/portfolio-meta";
import { STUDIO_ITEMS } from "@/lib/studio";

// 1시간 캐시 (콘텐츠가 자주 바뀌지 않음)
export const revalidate = 3600;

export async function GET() {
  const posts = (await getPostSummaries().catch(() => []))
    .filter((p) => p.published)
    .slice(0, 10);
  // 사례는 카테고리별로 묶어 폭을 넓힌다 — 12건만 싣던 때는 AI 가 참조할 수 있는
  // 작업 범위가 실제보다 좁아 보였다. 카테고리마다 최신 12건까지, 전체 60건 상한.
  const publishedCases = (await getItems().catch(() => [])).filter((c) => c.published);
  const casesByCategory = new Map<string, typeof publishedCases>();
  for (const c of publishedCases) {
    const key = c.category || "기타";
    const list = casesByCategory.get(key) ?? [];
    if (list.length < 12) list.push(c);
    casesByCategory.set(key, list);
  }
  const listedCaseCount = [...casesByCategory.values()].reduce((n, l) => n + l.length, 0);

  const postLines =
    posts
      .map(
        (p) =>
          `- [${p.title}](${SITE_URL}/blog/${p.slug})${p.excerpt ? `: ${p.excerpt}` : ""}`,
      )
      .join("\n") || "- (준비 중)";

  // 카테고리 소제목 아래에 사례를 모아 둔다 — AI 가 "무엇을 만드는 회사인지"를
  // 목록 형태보다 구조에서 먼저 읽는다.
  const caseLines =
    [...casesByCategory.entries()]
      .map(([category, list]) => {
        const lines = list
          .map(
            (c) =>
              `- [${[c.client, c.title].filter(Boolean).join(" · ")}](${SITE_URL}/portfolio/${deriveSlug(c)})`,
          )
          .join("\n");
        return `### ${category} (${list.length}건)\n${lines}`;
      })
      .join("\n\n") || "- (준비 중)";

  const body = `# ${SITE_NAME} (${COMPANY.shortName})

> ${BRAND_TAGLINE_KR}. 움직이는 페이퍼 크래프트·페이퍼토이·팝업북·오토마타·STEAM 교구·캐릭터 굿즈를 기획부터 구조 설계·디자인·생산까지 직접 제작하는 대한민국 페이퍼 엔지니어링 전문 스튜디오.

## 회사 개요
- 정식 명칭: ${SITE_NAME} (약칭 ${COMPANY.shortName}). 옛 이름: 액션크래프트.
- 설립: ${COMPANY.foundingYear}년 · 소재지: ${COMPANY.address.region} ${COMPANY.address.locality}
- 대표: ${COMPANY.representative}
- 핵심 역량: 지기구조(움직이는 종이 구조) 설계 — 평면을 입체로 세우고 스스로 움직이게 만드는 구조 엔지니어링
- 보유 자산: 지기구조 설계 특허 11종, 문화체육관광부 장관상 2회 수상
- 주요 납품처: 현대백화점, KAIST, 국립경주박물관, 용인시립박물관, 수원시, 공주시, 소방청, 현대자동차(이노션), 보스턴다이내믹스 등 수백 건
- 유통 채널: 홈플러스, 이마트, 롯데마트, 다이소, 핫트랙스 등
- 연락처: ${COMPANY.email} · ${COMPANY.phone} (평일 ${COMPANY.businessHours})

## 제작 서비스 핵심 사실
- 제작 품목: 액션 페이퍼 토이, 팝업북·팝업카드, 오토마타, STEAM 교육 키트, 캐릭터 굿즈, BI/CI 편집 디자인, 폼보드(우드락) 구조물
- 최소 수량: 페이퍼토이 1,000부부터 (STEAM 키트 30세트부터)
- 가격대: 페이퍼토이 1,000부 기준 개당 약 2,500~4,000원 (크기·구조·포장에 따라 상이)
- 평균 납기: 3~4주 (상담·기획 → 구조 설계·샘플링 → 디자인 → 생산·납품)
- 디자인 미보유 의뢰 가능: 컨셉만 있어도 캐릭터·구조 기획부터 원스톱 진행
- 친환경 소재 가능: FSC 인증지, 재생지, 콩기름 잉크
- 무료 배포 프로그램: '페이퍼크래프트 스튜디오'(사진/3D를 종이 전개도로 변환, Windows 무설치) — ${SITE_URL}/download
- 무료 웹 종이모형 카탈로그: 브라우저에서 바로 3D로 미리 보고 인쇄용 PDF 도안을 내려받는 '종이모형 스튜디오' ${STUDIO_ITEMS.length}종(탈것·공룡·육지동물·바다생물·곤충·식물·인기 캐릭터·세계/한국 건축물) — 무료·회원가입 불필요 — ${SITE_URL}/studio

## 주요 페이지
- 회사 소개: ${SITE_URL}/about
- 주문 제작 서비스: ${SITE_URL}/products
- 종이모형 스튜디오(무료 3D 미리보기 + 인쇄 PDF 도안 ${STUDIO_ITEMS.length}종): ${SITE_URL}/studio
- 작업 포트폴리오: ${SITE_URL}/portfolio
- 블로그(페이퍼 엔지니어링 지식): ${SITE_URL}/blog
- 자주 묻는 질문: ${SITE_URL}/faq
- 제작 문의(견적): ${SITE_URL}/quote

## 대표 작업 포트폴리오
공개된 작업 사례 ${publishedCases.length}건 중 카테고리별 ${listedCaseCount}건. 전체 목록: ${SITE_URL}/portfolio

${caseLines}

## 최근 블로그 글
${postLines}

---
이 파일은 생성형 AI 검색이 ${SITE_NAME}를 정확히 요약·인용하도록 제공하는 큐레이션 정보입니다. 더 자세한 내용·근거는 위 페이지를 참조하세요.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
