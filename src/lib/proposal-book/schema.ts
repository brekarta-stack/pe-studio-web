/**
 * 제안서(편집 디자인 10쪽) 원고·스타일·쪽 구성의 형식 — 클라이언트/서버/테스트 공용 순수 모듈.
 *
 * 원고 키는 agents-bd `reference/proposals/editorial/README.md` 의 data.json 과 같다.
 * 같게 둔 이유: 에이전트가 쓴 data.json 을 그대로 들여올 수 있고, 반대로 여기서 고친 원고를
 * bin/proposal-book 으로도 찍을 수 있다. 키를 바꾸면 두 쪽이 갈라진다.
 *
 * 스키마는 두 겹이다.
 *  - bookContentSchema: 모양(타입)만 본다. 저장할 때 쓴다 — 편집 중에는 개수가 잠깐 한도를
 *    벗어날 수 있어야 한다(항목을 지우고 새로 넣는 사이).
 *  - bookContentStrictSchema: 모양 + 개수 한도(README '원고 분량'). AI 초안·발송 전 검사에 쓴다.
 */

import { z } from "zod";

/* ── 이미지 값 ────────────────────────────────────────────────
 * 문자열(URL·파일명) 또는 맞춤·확대·위치를 가진 객체. 옛 원고(data.json)는 전부 문자열이라
 * 둘 다 받고, 화면에서는 normalizeImage() 로 한 모양으로 펴서 쓴다. */

export const IMAGE_FITS = ["cover", "contain"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

export const imageObjectSchema = z.object({
  url: z.string(),
  fit: z.enum(IMAGE_FITS),
  zoom: z.number().min(1).max(3),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});
export const imageValueSchema = z.union([z.string(), imageObjectSchema]);

export type ImageObject = z.infer<typeof imageObjectSchema>;
export type ImageValue = z.infer<typeof imageValueSchema>;

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

/** 어떤 값이 와도 {url, fit, zoom, x, y} 로 편다. 범위 밖 숫자는 잘라 넣는다 (화면이 죽지 않게) */
export function normalizeImage(v: unknown): ImageObject {
  if (typeof v === "string") return { url: v.trim(), fit: "cover", zoom: 1, x: 50, y: 50 };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return {
      url: typeof o.url === "string" ? o.url.trim() : "",
      fit: o.fit === "contain" ? "contain" : "cover",
      zoom: clampNum(o.zoom, 1, 3, 1),
      x: clampNum(o.x, 0, 100, 50),
      y: clampNum(o.y, 0, 100, 50),
    };
  }
  return { url: "", fit: "cover", zoom: 1, x: 50, y: 50 };
}

/** 이미지 값의 주소만 */
export function imageUrl(v: unknown): string {
  return normalizeImage(v).url;
}

/* ── 원고 ───────────────────────────────────────────────────── */

const str = z.string();

export const bookContentSchema = z.object({
  org: str,
  /** 표지용 줄바꿈 ("국립해양\n박물관"). 키커·쪽표시는 org 를 쓴다 */
  org_display: str.optional(),
  issue: str,
  title: str,
  subtitle: str,
  cover: imageValueSchema,
  contact: z.object({ dept: str, email: str }),
  glance: z.object({
    headline: str,
    lede: str,
    specs: z.array(z.tuple([str, str])),
  }),
  observation: z.object({
    headline: str,
    quote: str,
    body: z.array(str),
    sources: z.array(z.object({ label: str, url: str })),
  }),
  offer: z.object({
    headline: str,
    lede: str,
    lines: z.array(z.object({ use: str, name: str, body: z.array(str), spec: str })),
  }),
  designs: z.object({
    headline: str.optional(),
    note: str.optional(),
    items: z.array(z.object({ key: str, image: imageValueSchema, title: str, note: str })),
  }),
  scenes: z.object({
    headline: str,
    image: imageValueSchema,
    items: z.array(z.object({ title: str, body: str })),
  }),
  cases: z.object({
    headline: str,
    items: z.array(z.object({ org: str, title: str, note: str, image: imageValueSchema })),
  }),
  pricing: z.object({
    headline: str,
    lede: str,
    tiers: z.array(
      z.object({ qty: str, desc: str, total: str, unit: str, pick: z.boolean().optional() })
    ),
    includes: z.array(str),
    notes: z.array(str),
  }),
  plan: z.object({
    headline: str,
    steps: z.array(z.object({ when: str, title: str, body: str })),
  }),
  closing: z.object({
    headline: str,
    lede: str,
    next: z.array(str),
  }),
});

export type BookContent = z.infer<typeof bookContentSchema>;

/* ── 분량 한도 (README '원고 분량' 표와 같아야 한다) ─────────────
 * 개수는 지면 칸 수가 정한다 — 넘치면 칸이 납작해지거나 면 밖으로 밀린다.
 * 글자 수는 지면 넘침을 막는 기준선이다(bin/proposal-book 은 검사하지 않고 넘침을 잰다). */

export const LIMITS = {
  counts: {
    "glance.specs": { min: 4, max: 6 },
    "observation.body": { min: 1, max: 4 },
    "observation.sources": { min: 0, max: 6 },
    "offer.lines": { min: 2, max: 3 },
    "designs.items": { min: 3, max: 3 },
    "scenes.items": { min: 2, max: 2 },
    "cases.items": { min: 3, max: 3 },
    "pricing.tiers": { min: 3, max: 3 },
    "pricing.includes": { min: 0, max: 6 },
    "pricing.notes": { min: 0, max: 4 },
    "plan.steps": { min: 3, max: 5 },
    "closing.next": { min: 2, max: 4 },
  },
  chars: {
    /** 쪽 제목 — 28자 안팎, 두 줄 이내 */
    headline: 28,
    /** 리드 — 두 문장 */
    lede: 80,
    /** 관찰 인용 */
    quote: 60,
    /** 시안 설명 */
    designNote: 30,
    /** 한 문장 (AI 규칙) */
    sentence: 60,
  },
  /** 관찰 문단당 문장 수 */
  sentencesPerParagraph: 3,
  /** 라인업 본문 문장 수 */
  offerBodyLines: 2,
} as const;

export type CountPath = keyof typeof LIMITS.counts;

/** 글자 수 한도가 걸리는 필드 경로 → 한도. 숫자 인덱스는 * 로 적는다 */
export const CHAR_LIMIT_FIELDS: Record<string, number> = {
  "glance.headline": LIMITS.chars.headline,
  "observation.headline": LIMITS.chars.headline,
  "offer.headline": LIMITS.chars.headline,
  "designs.headline": LIMITS.chars.headline,
  "scenes.headline": LIMITS.chars.headline,
  "cases.headline": LIMITS.chars.headline,
  "pricing.headline": LIMITS.chars.headline,
  "plan.headline": LIMITS.chars.headline,
  "closing.headline": LIMITS.chars.headline,
  "glance.lede": LIMITS.chars.lede,
  "offer.lede": LIMITS.chars.lede,
  "pricing.lede": LIMITS.chars.lede,
  "closing.lede": LIMITS.chars.lede,
  "observation.quote": LIMITS.chars.quote,
  "designs.items.*.note": LIMITS.chars.designNote,
};

export interface LimitProblem {
  path: string;
  kind: "count" | "chars" | "pick";
  message: string;
}

/** 글자 수 — 코드포인트 기준(한글·이모지 한 글자 = 1) */
export function charLen(s: string): number {
  return Array.from(s ?? "").length;
}

/** 개수·글자 수·추천 구간 검사. 문제 목록을 돌려준다(없으면 빈 배열) */
export function checkLimits(c: BookContent): LimitProblem[] {
  const out: LimitProblem[] = [];
  for (const [path, { min, max }] of Object.entries(LIMITS.counts)) {
    const v = getAt(c, path);
    const n = Array.isArray(v) ? v.length : 0;
    if (n < min || n > max) {
      const want = min === max ? `${min}개` : `${min}~${max}개`;
      out.push({ path, kind: "count", message: `${path} ${n}개 (한도 ${want})` });
    }
  }
  for (const [pattern, max] of Object.entries(CHAR_LIMIT_FIELDS)) {
    for (const path of expandPattern(c, pattern)) {
      const v = getAt(c, path);
      if (typeof v === "string" && charLen(v) > max) {
        out.push({ path, kind: "chars", message: `${path} ${charLen(v)}자 (한도 ${max}자)` });
      }
    }
  }
  const picks = (c.pricing?.tiers ?? []).filter((t) => t.pick).length;
  if (picks !== 1) {
    out.push({ path: "pricing.tiers", kind: "pick", message: `추천 견적 구간은 정확히 하나여야 합니다 (지금 ${picks}개)` });
  }
  return out;
}

/** "designs.items.*.note" → 실제 있는 인덱스로 편 경로 목록 */
function expandPattern(c: unknown, pattern: string): string[] {
  const segs = pattern.split(".");
  let paths: string[] = [""];
  for (const seg of segs) {
    const next: string[] = [];
    for (const p of paths) {
      if (seg === "*") {
        const arr = getAt(c, p);
        if (Array.isArray(arr)) arr.forEach((_, i) => next.push(p ? `${p}.${i}` : String(i)));
      } else {
        next.push(p ? `${p}.${seg}` : seg);
      }
    }
    paths = next;
  }
  return paths;
}

/** 모양 + 개수 한도 + 추천 구간 하나. 글자 수는 경고일 뿐이라 여기서 막지 않는다 */
export const bookContentStrictSchema = bookContentSchema.superRefine((c, ctx) => {
  for (const p of checkLimits(c as BookContent)) {
    if (p.kind === "chars") continue;
    ctx.addIssue({ code: "custom", path: p.path.split("."), message: p.message });
  }
});

/* ── 스타일 ─────────────────────────────────────────────────── */

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const fieldOverrideSchema = z.object({
  font: z.string().optional(),
  /** 글자 크기 배율 0.7~1.4 (편집기의 70~140%) */
  scale: z.number().min(0.7).max(1.4).optional(),
});

export const bookStyleSchema = z.object({
  keyColor: z.string().regex(HEX_COLOR),
  headingFont: z.string(),
  bodyFont: z.string(),
  overrides: z.record(z.string(), fieldOverrideSchema),
});

export type FieldOverride = z.infer<typeof fieldOverrideSchema>;
export type BookStyle = z.infer<typeof bookStyleSchema>;

export const DEFAULT_KEY_COLOR = "#1E22B2";

export const DEFAULT_STYLE: BookStyle = {
  keyColor: DEFAULT_KEY_COLOR,
  headingFont: "noto-serif-kr",
  bodyFont: "pretendard",
  overrides: {},
};

/** 저장된 style JSON(빈 객체일 수도 있다) → 완전한 BookStyle. 틀린 값은 기본값으로 */
export function normalizeStyle(v: unknown): BookStyle {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const overrides: Record<string, FieldOverride> = {};
  if (o.overrides && typeof o.overrides === "object" && !Array.isArray(o.overrides)) {
    for (const [k, raw] of Object.entries(o.overrides as Record<string, unknown>)) {
      const r = fieldOverrideSchema.safeParse(raw);
      if (r.success && (r.data.font || r.data.scale != null)) overrides[k] = r.data;
    }
  }
  return {
    keyColor: typeof o.keyColor === "string" && HEX_COLOR.test(o.keyColor) ? o.keyColor : DEFAULT_KEY_COLOR,
    headingFont: typeof o.headingFont === "string" && o.headingFont ? o.headingFont : DEFAULT_STYLE.headingFont,
    bodyFont: typeof o.bodyFont === "string" && o.bodyFont ? o.bodyFont : DEFAULT_STYLE.bodyFont,
    overrides,
  };
}

/* ── 쪽 구성 ────────────────────────────────────────────────── */

export const PAGE_IDS = [
  "cover",
  "glance",
  "observation",
  "offer",
  "designs",
  "scenes",
  "cases",
  "pricing",
  "plan",
  "back",
] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface PageDef {
  id: PageId;
  /** 편집기 쪽 목록에 보이는 이름 */
  name: string;
  /** 표지·뒤표지는 숨기거나 옮길 수 없다 */
  fixed: boolean;
  /** 키커 왼쪽(영문 섹션명) — 표지에는 없다 */
  sec: string;
  /** 키커 오른쪽(한글) */
  ko: string;
}

export const PAGE_DEFS: readonly PageDef[] = [
  { id: "cover", name: "표지", fixed: true, sec: "", ko: "" },
  { id: "glance", name: "한눈에", fixed: false, sec: "At a glance", ko: "한눈에" },
  { id: "observation", name: "관찰", fixed: false, sec: "Observation", ko: "관찰" },
  { id: "offer", name: "제안", fixed: false, sec: "Proposal", ko: "제안" },
  { id: "designs", name: "시안", fixed: false, sec: "Design", ko: "시안" },
  { id: "scenes", name: "활용 장면", fixed: false, sec: "In use", ko: "활용" },
  { id: "cases", name: "사례", fixed: false, sec: "Portfolio", ko: "사례" },
  { id: "pricing", name: "견적", fixed: false, sec: "Estimate", ko: "견적" },
  { id: "plan", name: "일정", fixed: false, sec: "Schedule", ko: "일정" },
  { id: "back", name: "뒤표지", fixed: true, sec: "Next", ko: "다음 단계" },
];

export function pageDef(id: PageId): PageDef {
  return PAGE_DEFS.find((p) => p.id === id) ?? PAGE_DEFS[0];
}

export function isPageId(v: unknown): v is PageId {
  return typeof v === "string" && (PAGE_IDS as readonly string[]).includes(v);
}

export const bookPageSchema = z.object({ id: z.enum(PAGE_IDS), hidden: z.boolean() });
export const bookPagesSchema = z.array(bookPageSchema);
export type BookPage = z.infer<typeof bookPageSchema>;

export function defaultPages(): BookPage[] {
  return PAGE_IDS.map((id) => ({ id, hidden: false }));
}

/**
 * 저장된 pages(빈 배열·옛 형식일 수도 있다) → 열 쪽이 전부, 한 번씩, 표지 처음·뒤표지 끝.
 * 빠진 쪽은 기본 순서 자리에 끼우지 않고 뒤표지 앞에 붙인다 — 사용자가 바꾼 순서를 지키려고.
 */
export function normalizePages(v: unknown): BookPage[] {
  const seen = new Set<PageId>();
  const middle: BookPage[] = [];
  if (Array.isArray(v)) {
    for (const raw of v) {
      const id = raw && typeof raw === "object" ? (raw as { id?: unknown }).id : undefined;
      if (!isPageId(id) || seen.has(id)) continue;
      seen.add(id);
      if (id === "cover" || id === "back") continue;
      middle.push({ id, hidden: !!(raw as { hidden?: unknown }).hidden });
    }
  }
  for (const id of PAGE_IDS) {
    if (id !== "cover" && id !== "back" && !seen.has(id)) middle.push({ id, hidden: false });
  }
  return [{ id: "cover", hidden: false }, ...middle, { id: "back", hidden: false }];
}

/** 원고의 최상위 키 → 그 글이 실리는 쪽 (빈칸 목록을 쪽별로 묶거나 숨긴 쪽을 거를 때) */
export const PAGE_OF_KEY: Record<string, PageId> = {
  org: "cover",
  org_display: "cover",
  issue: "cover",
  title: "cover",
  subtitle: "cover",
  cover: "cover",
  contact: "cover",
  glance: "glance",
  observation: "observation",
  offer: "offer",
  designs: "designs",
  scenes: "scenes",
  cases: "cases",
  pricing: "pricing",
  plan: "plan",
  closing: "back",
};

export function pageOfPath(path: string): PageId | null {
  return PAGE_OF_KEY[path.split(".")[0]] ?? null;
}

/* ── 기본값 ─────────────────────────────────────────────────── */

/** "2026.10" — 한국 달력 기준 발행 월 */
export function issueOf(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" })
    .formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  return `${y}.${m}`;
}

export const TBD = (what: string) => `[확인 필요: ${what}]`;

/** 스튜디오 표준 일정 — 스튜디오 사실(평균 납기 4주)이라 빈칸으로 두지 않는다 */
export const STANDARD_STEPS = [
  { when: "1주", title: "시안·사양 확정", body: "시안 3종 중 방향 선택, 수량 확정" },
  { when: "2주", title: "디자인 디벨롭", body: "도면 설계와 수정 2회" },
  { when: "3주", title: "샘플·생산", body: "샘플 확인 후 인쇄·재단" },
  { when: "4주", title: "포장·납품", body: "개별 포장, 지정 장소 납품" },
];

export const STANDARD_INCLUDES = ["디자인 시안 3종과 수정 2회", "도면 설계와 조립 테스트", "인쇄·재단·개별 포장", "지정 장소 납품"];

export const STANDARD_NEXT = ["샘플 요청 (메일 또는 전화)", "시안 방향 선택", "수량·일정 확정 후 정식 견적서 발행"];

/** 견적 금액은 언제나 빈칸 — 옛 제안서의 금액대·다른 기관 단가를 옮겨 오면 틀린 값이 진짜처럼 나간다 */
export function tbdTiers(): BookContent["pricing"]["tiers"] {
  return [0, 1, 2].map((i) => ({
    qty: TBD("수량"),
    desc: TBD("구성"),
    total: TBD("단가"),
    unit: TBD("단가"),
    ...(i === 1 ? { pick: true } : {}),
  }));
}

/** 한도를 만족하는 빈 원고 — 모든 사실 칸이 [확인 필요: …] */
export function emptyContent(org: string): BookContent {
  const name = (org ?? "").trim() || TBD("기관명");
  return {
    org: name,
    issue: issueOf(),
    title: TBD("표지 제목"),
    subtitle: TBD("표지 부제"),
    cover: "",
    contact: { dept: TBD("수신 부서"), email: "" },
    glance: {
      headline: TBD("한눈에 제목"),
      lede: TBD("한눈에 리드"),
      specs: [
        ["품목", TBD("품목")],
        ["크기", TBD("크기")],
        ["최소 수량", "1,000개부터"],
        ["시안", "3종 제공 · 수정 2회"],
        ["납기", "약 4주 (디자인 2주 · 생산 2주)"],
      ],
    },
    observation: {
      headline: TBD("관찰 제목"),
      quote: TBD("인용"),
      body: [TBD("기관 현황")],
      sources: [{ label: TBD("출처"), url: "" }],
    },
    offer: {
      headline: TBD("제안 제목"),
      lede: TBD("제안 리드"),
      lines: [0, 1].map(() => ({
        use: TBD("쓰임"),
        name: TBD("라인명"),
        body: [TBD("설명")],
        spec: TBD("사양"),
      })),
    },
    designs: {
      items: ["A", "B", "C"].map((key) => ({ key, image: "", title: TBD("시안 제목"), note: "" })),
    },
    scenes: {
      headline: TBD("활용 장면 제목"),
      image: "",
      items: [0, 1].map(() => ({ title: TBD("장면"), body: TBD("장면 설명") })),
    },
    cases: {
      headline: TBD("사례 제목"),
      items: [0, 1, 2].map(() => ({ org: TBD("기관"), title: TBD("사례명"), note: "", image: "" })),
    },
    pricing: {
      headline: TBD("견적 제목"),
      lede: TBD("견적 리드"),
      tiers: tbdTiers(),
      includes: [...STANDARD_INCLUDES],
      notes: ["VAT 별도", TBD("단가 기준")],
    },
    plan: { headline: "시안 확인부터 납품까지 4주입니다", steps: STANDARD_STEPS.map((s) => ({ ...s })) },
    closing: {
      headline: "샘플 한 부를 먼저 보내 드리겠습니다",
      lede: "실물을 보신 뒤 방향을 정하셔도 늦지 않습니다. 샘플은 요청 후 1주 안에 도착합니다.",
      next: [...STANDARD_NEXT],
    },
  };
}

/**
 * 모양이 어긋난 원고(옛 저장본·손으로 고친 JSON)를 틀에 맞춘다.
 * 있는 값은 살리고, 없거나 타입이 틀린 칸만 template(보통 emptyContent) 값으로 채운다.
 * 개수 한도는 건드리지 않는다 — 편집기가 보여 주고 사람이 고친다.
 */
export function conformContent(raw: unknown, template: BookContent): BookContent {
  const out = conform(raw, template, "") as BookContent;
  const r = bookContentSchema.safeParse(out);
  return r.success ? r.data : template;
}

/** 이미지 칸은 문자열/객체 둘 다 받는다 — conform 이 객체를 템플릿 문자열로 덮지 않게 경로를 적어 둔다 */
const IMAGE_PATH_RE = /^(cover|scenes\.image|designs\.items\.\d+\.image|cases\.items\.\d+\.image)$/;

export function isImagePath(path: string): boolean {
  return IMAGE_PATH_RE.test(path);
}

function conform(raw: unknown, tpl: unknown, path: string): unknown {
  if (isImagePath(path)) return imageValueSchema.safeParse(raw).success ? raw : tpl;
  if (typeof tpl === "string") return typeof raw === "string" ? raw : tpl;
  if (typeof tpl === "boolean") return typeof raw === "boolean" ? raw : tpl;
  if (Array.isArray(tpl)) {
    if (!Array.isArray(raw)) return tpl;
    // 튜플([k, v])은 문자열 둘로
    if (tpl.length > 0 && Array.isArray(tpl[0])) {
      return raw
        .filter((x) => Array.isArray(x))
        .map((x) => [String((x as unknown[])[0] ?? ""), String((x as unknown[])[1] ?? "")]);
    }
    const item = tpl[0];
    if (item === undefined) return raw.filter((x) => typeof x === "string");
    return raw.map((x, i) => conform(x, item, `${path}.${i}`));
  }
  if (tpl && typeof tpl === "object") {
    const t = tpl as Record<string, unknown>;
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(t)) o[k] = conform(r[k], t[k], path ? `${path}.${k}` : k);
    // 템플릿에 없는 선택 키(org_display·designs.headline/note·tiers.pick)는 타입이 맞을 때만 살린다
    // (그 밖의 키가 붙어도 zod 가 저장 전에 걷어 낸다)
    for (const k of ["org_display", "headline", "note"]) {
      if (!(k in t) && typeof r[k] === "string") o[k] = r[k];
    }
    if (!("pick" in t) && typeof r.pick === "boolean") o.pick = r.pick;
    return o;
  }
  return tpl;
}

/* ── 필드 경로 ───────────────────────────────────────────────
 * "observation.body.2", "offer.lines.0.name" 처럼 점으로 잇는다. 숫자 마디는 배열 인덱스.
 * 편집기의 data-path·서체 덮어쓰기 키·빈칸 목록이 전부 이 경로를 쓴다. */

export function splitPath(path: string): string[] {
  return path ? path.split(".").filter((s) => s !== "") : [];
}

export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of splitPath(path)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * 불변 갱신 — 경로 위의 객체·배열만 새로 만들고 나머지는 원래 참조를 그대로 둔다
 * (React 가 바뀐 칸만 다시 그리게, 되돌리기 기록이 원본을 잃지 않게).
 * 중간 마디가 없으면 다음 마디가 숫자인지 보고 배열/객체를 만든다.
 */
export function setAt<T>(obj: T, path: string, value: unknown): T {
  const segs = splitPath(path);
  if (segs.length === 0) return value as T;
  const rec = (cur: unknown, i: number): unknown => {
    const seg = segs[i];
    const isIdx = /^\d+$/.test(seg);
    let base: Record<string, unknown> | unknown[];
    if (Array.isArray(cur)) base = cur.slice();
    else if (cur && typeof cur === "object") base = { ...(cur as Record<string, unknown>) };
    else base = isIdx ? [] : {};
    const child = (base as Record<string, unknown>)[seg];
    const next = i === segs.length - 1 ? value : rec(child, i + 1);
    if (Array.isArray(base) && isIdx) base[Number(seg)] = next;
    else (base as Record<string, unknown>)[seg] = next;
    return base;
  };
  return rec(obj, 0) as T;
}
