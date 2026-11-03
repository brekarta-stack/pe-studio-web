/**
 * 제안서에서 고를 수 있는 서체 — 제목용·본문용 목록과 로딩 주소. 순수 모듈.
 *
 * Pretendard 는 사이트가 이미 next/font/local 로 자체 호스팅한다(src/app/layout.tsx 의 --font-pretendard).
 * jsdelivr CDN 은 503 장애와 CSP font-src 차단으로 운영에서 시스템 서체로 떨어진 이력이 있어
 * 다시 들이지 않고 그 변수를 서체 스택 맨 앞에 둔다. 나머지는 Google Fonts css2 로 받는다.
 */

import type { BookStyle } from "./schema.ts";

export interface FontOption {
  id: string;
  label: string;
  /** CSS font-family 값 (대체 서체까지) */
  stack: string;
  /** Google Fonts 의 family 이름. 없으면 외부에서 받지 않는다 */
  googleFamily?: string;
  /** Google Fonts 에서 받을 굵기 — 그 서체에 있는 것만 적는다(없는 굵기를 적으면 css2 가 400 을 낸다) */
  weights?: number[];
}

const SERIF_FALLBACK = `"AppleMyungjo", "Batang", serif`;
const SANS_FALLBACK = `"Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
const PRETENDARD_STACK = `var(--font-pretendard, "Pretendard"), "Pretendard", "Pretendard Variable", ${SANS_FALLBACK}`;

export const HEADING_FONTS: readonly FontOption[] = [
  { id: "noto-serif-kr", label: "Noto Serif KR", stack: `"Noto Serif KR", ${SERIF_FALLBACK}`, googleFamily: "Noto Serif KR", weights: [400, 600, 700, 900] },
  { id: "nanum-myeongjo", label: "나눔명조", stack: `"Nanum Myeongjo", ${SERIF_FALLBACK}`, googleFamily: "Nanum Myeongjo", weights: [400, 700, 800] },
  { id: "gowun-batang", label: "고운바탕", stack: `"Gowun Batang", ${SERIF_FALLBACK}`, googleFamily: "Gowun Batang", weights: [400, 700] },
  { id: "hahmlet", label: "함렛", stack: `"Hahmlet", ${SERIF_FALLBACK}`, googleFamily: "Hahmlet", weights: [400, 600, 700, 900] },
  { id: "pretendard", label: "Pretendard", stack: PRETENDARD_STACK },
  { id: "noto-sans-kr", label: "Noto Sans KR", stack: `"Noto Sans KR", ${SANS_FALLBACK}`, googleFamily: "Noto Sans KR", weights: [400, 500, 600, 700, 900] },
];

export const BODY_FONTS: readonly FontOption[] = [
  { id: "pretendard", label: "Pretendard", stack: PRETENDARD_STACK },
  { id: "noto-sans-kr", label: "Noto Sans KR", stack: `"Noto Sans KR", ${SANS_FALLBACK}`, googleFamily: "Noto Sans KR", weights: [400, 500, 600, 700, 900] },
  { id: "ibm-plex-sans-kr", label: "IBM Plex Sans KR", stack: `"IBM Plex Sans KR", ${SANS_FALLBACK}`, googleFamily: "IBM Plex Sans KR", weights: [400, 500, 600, 700] },
  { id: "nanum-gothic", label: "나눔고딕", stack: `"Nanum Gothic", ${SANS_FALLBACK}`, googleFamily: "Nanum Gothic", weights: [400, 700, 800] },
  { id: "gowun-dodum", label: "고운돋움", stack: `"Gowun Dodum", ${SANS_FALLBACK}`, googleFamily: "Gowun Dodum", weights: [400] },
];

/** 제목·본문 목록을 합친 것 (칸별 덮어쓰기는 어느 쪽 서체든 고를 수 있다) */
export const ALL_FONTS: readonly FontOption[] = [
  ...HEADING_FONTS,
  ...BODY_FONTS.filter((b) => !HEADING_FONTS.some((h) => h.id === b.id)),
];

export function findFont(id: string | undefined | null): FontOption | undefined {
  return id ? ALL_FONTS.find((f) => f.id === id) : undefined;
}

/** 서체 id → CSS 스택. 모르는 id 면 kind 의 기본 서체 */
export function fontStack(id: string | undefined | null, kind: "heading" | "body"): string {
  const f = findFont(id);
  if (f) return f.stack;
  return kind === "heading" ? HEADING_FONTS[0].stack : BODY_FONTS[0].stack;
}

/** 이 스타일이 실제로 쓰는 서체 id (제목·본문·칸별 덮어쓰기) */
export function usedFontIds(style: Pick<BookStyle, "headingFont" | "bodyFont" | "overrides">): string[] {
  const ids = new Set<string>();
  ids.add(findFont(style.headingFont) ? style.headingFont : HEADING_FONTS[0].id);
  ids.add(findFont(style.bodyFont) ? style.bodyFont : BODY_FONTS[0].id);
  for (const o of Object.values(style.overrides ?? {})) if (o?.font && findFont(o.font)) ids.add(o.font);
  return [...ids];
}

export const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2";

/**
 * 쓰는 Google 서체를 css2 한 주소로 묶는다. 쓸 Google 서체가 없으면 빈 배열.
 * 한 주소로 묶는 이유: 서체마다 <link> 를 두면 인쇄 전 대기(document.fonts.ready)가 요청 수만큼 늘어난다.
 */
export function fontStylesheetUrls(style: Pick<BookStyle, "headingFont" | "bodyFont" | "overrides">): string[] {
  const families = usedFontIds(style)
    .map((id) => findFont(id))
    .filter((f): f is FontOption => !!f?.googleFamily)
    .map((f) => {
      const name = f.googleFamily!.replace(/ /g, "+");
      const w = f.weights && f.weights.length ? `:wght@${[...f.weights].sort((a, b) => a - b).join(";")}` : "";
      return `family=${name}${w}`;
    });
  if (families.length === 0) return [];
  return [`${GOOGLE_FONTS_CSS}?${families.join("&")}&display=swap`];
}
