/**
 * /studio — 종이모형 스튜디오 카탈로그 (조용한 베타, 로드맵 M1→M2 트랙A)
 *
 * 사전 생성 산출물(index.json)을 읽되, 공개 목록은 검수 큐레이션 게이트
 * (studio-review.getExposedItems — 기본: 반려만 숨김, STUDIO_CURATION_STRICT=1
 * 이면 통과만 노출)를 거친다. ISR(revalidate)+검수 API 의 revalidatePath 로 갱신.
 * 검색·분류·난이도 필터는 클라이언트(StudioCatalog)에서 즉시 처리(요청 없음).
 */

import type { Metadata } from "next";
import Link from "next/link";
import StudioCatalog from "@/components/StudioCatalog";
import { categoryLandings, type StudioItem } from "@/lib/studio";
import { getExposedItems } from "@/lib/studio-review";
import { SITE_NAME, SITE_URL, OG_IMAGE } from "@/lib/site";

export const revalidate = 300; // 검수 상태 반영(ISR) — 검수 API 가 즉시 revalidatePath 도 한다

export async function generateMetadata(): Promise<Metadata> {
  const items = await getExposedItems();
  return {
    title: "종이모형 스튜디오 (베타) — 만들어 볼 종이모형 도안",
    description:
      `자동차·공룡·동물(바다·육지·곤충)·식물·인기 캐릭터·세계 건축물 종이모형 ${items.length}종. ` +
      "3D로 미리 돌려 보고, 도면을 확인하고, 인쇄용 PDF를 내려받아 바로 만들어 보세요.",
    alternates: { canonical: "/studio" },
    openGraph: {
      images: [OG_IMAGE],
      title: `종이모형 스튜디오 (베타) | ${SITE_NAME}`,
      description: "3D로 미리 보고 인쇄해서 만드는 종이모형 도안.",
      url: "/studio",
      type: "website",
    },
  };
}

/** 목록 구조화 데이터 — CollectionPage + ItemList(노출 모형 URL). 카탈로그 색인/GEO용. */
function StudioListJsonLd({ items }: { items: StudioItem[] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "종이모형 스튜디오",
    description: `종이공예 도안 ${items.length}종 — 3D 미리보기와 무료 인쇄 PDF.`,
    url: `${SITE_URL}/studio`,
    inLanguage: "ko-KR",
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_URL },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: it.name_ko,
        url: `${SITE_URL}/studio/${it.skey}`,
      })),
    },
  };
  return (
    <script type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}

export default async function StudioPage() {
  const items = await getExposedItems();
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <StudioListJsonLd items={items} />
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold" style={{ wordBreak: "keep-all" }}>
            종이모형 스튜디오
          </h1>
          <span className="rounded-full bg-amber-100 text-amber-800 text-xs font-semibold px-2.5 py-1">
            베타
          </span>
        </div>
      </header>

      <StudioCatalog items={items} />

      {/* 카테고리별 랜딩으로의 크롤 가능한 내부 링크(SEO 롱테일 진입점) */}
      <nav className="mt-10 border-t border-slate-200 pt-6" aria-label="카테고리별 종이모형">
        <h2 className="text-sm font-semibold text-slate-500 mb-3">카테고리별 도안</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {categoryLandings(items).map((c) => (
            <li key={c.slug}>
              <Link href={`/studio/category/${c.slug}`}
                    className="text-slate-600 hover:text-[#1E22B2] hover:underline"
                    style={{ wordBreak: "keep-all" }}>
                {c.category} 종이모형
                <span className="ml-1 text-slate-400 tabular-nums">({c.count})</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <footer className="mt-10 text-xs text-slate-400" style={{ wordBreak: "keep-all" }}>
        도안은 Papercraft Studio 2 엔진이 생성했습니다. 미리보기 도면에는 papercraft.kr
        워터마크가 표시되며, 내려받은 PDF에는 표시되지 않습니다.
      </footer>
    </main>
  );
}
