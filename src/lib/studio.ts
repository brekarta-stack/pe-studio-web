/**
 * 종이모형 스튜디오(/studio) — 사전 생성 카탈로그 데이터.
 *
 * 데이터 원천: papercraft-studio 레포의 결정적 엔진이 빌드 타임에 만든 산출물을
 * tools/web_publish.py 가 이 레포로 복사한다(로드맵 M0/M1).
 *   public/studio/<엔진버전>/index.json          — 큐레이션 목록(이 파일이 단일 소스)
 *   public/studio/<엔진버전>/<skey>/…            — thumb.png · model.glb · preview_p*.svg(워터마크)
 *   content-private/studio/<엔진버전>/<skey>/print.pdf — 인쇄 원본(공개 금지, 인증 라우트 전용)
 *
 * index.json 을 정적 import 하므로 런타임 fs 접근이 없고, 키 검증(getItem)이
 * 곧 화이트리스트라 경로 조작이 원천 차단된다.
 */

import catalog from "../../public/studio/v2.16.11/index.json";

export interface StudioItem {
  key: string;        // 엔진 카탈로그 키 (예: "d:taj")
  skey: string;       // URL/폴더 안전 키 (예: "d_taj")
  name_ko: string;
  category: string;
  pieces: number;
  pages: number;      // 도면 시트 수 (미리보기 페이저와 일치)
  pdf_pages: number;  // 실제 인쇄 장수 = PDF 페이지 수 (도면 + 조립 안내)
  finished_mm: number;
  stars: number;      // 난이도 1~5
  est_minutes: number;
  svg_sheets: number; // 미리보기 SVG 장수
}

export const STUDIO_VER: string = catalog.engine;      // "v2.15.0"
export const STUDIO_PAPER: string = catalog.paper;     // "A4"
export const STUDIO_ITEMS: StudioItem[] = catalog.items as StudioItem[];

/**
 * 카테고리 표시 순서 — 카탈로그·상세·학급세트 전 화면의 단일 소스.
 * 아동·학부모가 선호하는 순(탈것·공룡·동물류)을 앞에, 추상 도형을 맨 뒤에.
 * 2026-07 동물 세분화(바다생물·육지동물·곤충·식물) + 인기 캐릭터 신설 반영.
 */
export const CATEGORY_ORDER = [
  "탈것",
  "공룡",
  "게임 캐릭터",
  "인기 캐릭터",
  "육지동물",
  "바다생물",
  "곤충",
  "식물",
  "세계 건축물",
  "한국 건축물",
  "캐릭터·오브젝트",
  "도형",
];

/** items 에 실제 존재하는 카테고리를 CATEGORY_ORDER 순으로(모르는 건 뒤에) 반환 */
export function orderedCategories(items: StudioItem[]): string[] {
  const present = new Set(items.map((i) => i.category));
  const known = CATEGORY_ORDER.filter((c) => present.has(c));
  const rest = Array.from(present).filter((c) => !CATEGORY_ORDER.includes(c));
  return [...known, ...rest];
}

export function itemsByCategory(): Array<{ category: string; items: StudioItem[] }> {
  return orderedCategories(STUDIO_ITEMS).map((category) => ({
    category,
    items: STUDIO_ITEMS.filter((i) => i.category === category),
  }));
}

/**
 * 카테고리 ↔ ASCII 슬러그 (색인 가능한 카테고리 랜딩 URL /studio/category/<slug>).
 * 한국어 카테고리명은 공백·가운뎃점이 있어 URL 로 부적합 → 고정 슬러그로 매핑.
 */
export const CATEGORY_SLUG: Record<string, string> = {
  "탈것": "vehicles",
  "공룡": "dinosaurs",
  "게임 캐릭터": "game-characters",
  "인기 캐릭터": "characters",
  "육지동물": "land-animals",
  "바다생물": "sea-animals",
  "곤충": "insects",
  "식물": "plants",
  "세계 건축물": "world-landmarks",
  "한국 건축물": "korea-landmarks",
  "캐릭터·오브젝트": "objects",
  "도형": "shapes",
};
const SLUG_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_SLUG).map(([k, v]) => [v, k]),
);

/** 카탈로그에 실제 존재하는 카테고리만, CATEGORY_ORDER 순으로 {category, slug, count}.
 *  items 를 주면 그 목록(예: 검수 게이트 통과분) 기준으로 집계한다. */
export function categoryLandings(
  items: StudioItem[] = STUDIO_ITEMS,
): Array<{ category: string; slug: string; count: number }> {
  return orderedCategories(items)
    .filter((c) => CATEGORY_SLUG[c])
    .map((c) => ({
      category: c,
      slug: CATEGORY_SLUG[c],
      count: items.filter((i) => i.category === c).length,
    }));
}

/** 슬러그 → 카테고리명 (없으면 undefined = 404) */
export function categoryFromSlug(slug: string): string | undefined {
  return SLUG_TO_CATEGORY[slug];
}

/** skey 화이트리스트 조회 — 없는 키는 undefined (라우트에서 404/경로조작 차단) */
export function getStudioItem(skey: string): StudioItem | undefined {
  return STUDIO_ITEMS.find((i) => i.skey === skey);
}

/** 공개 자산 경로 (/public 아래) */
export function studioAsset(skey: string, file: string): string {
  return `/studio/${STUDIO_VER}/${skey}/${file}`;
}

/** 난이도 별표 문자열 (★★☆☆☆) */
export function starsLabel(stars: number): string {
  const n = Math.max(1, Math.min(5, stars || 1));
  return "★".repeat(n) + "☆".repeat(5 - n);
}
