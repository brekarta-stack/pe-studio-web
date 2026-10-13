/**
 * 포트폴리오 자동 등록(인테이크) 규칙 — 순수 함수만. 서버 라우트·CLI·테스트가 같이 쓴다.
 *
 * 운영자가 Slack 에 올리는 사진의 **파일명이 곧 메타데이터**다:
 *
 *     고객명-YYMMDD-명칭 (n).jpg
 *     예) 서울문화교육센터-260907- 무대 위 안무가들 (3).jpg
 *         온더룩-261013-고양이탈 (1).jpg
 *
 * - 구분자(-) 주변 공백은 허용한다. 위 예시처럼 실제로 섞여 들어온다.
 * - 고객명에는 하이픈을 쓸 수 없다(첫 하이픈까지가 고객명).
 * - 날짜는 YYMMDD 또는 YYYYMMDD. 포트폴리오의 "제작 시기(producedAt)" 가 된다.
 * - 끝의 " (n)" 또는 "_n" 은 같은 사례의 n 번째 사진. 없으면 1장짜리로 본다.
 * - 고객명·날짜·명칭이 같은 사진은 한 사례로 묶인다(groupIntakeFiles).
 * - 제목·요약·본문·alt 는 Claude 가 사진을 보고 쓴다(portfolio-intake-run.ts).
 *   여기서는 그 결과를 사이트 규격(카테고리·고객 유형·alt 개수)에 맞게 다듬는 것까지만 한다.
 */
import { CATEGORIES, CLIENT_TYPES, SUGGESTED_TAGS } from "./portfolio-types.ts";
import type { Category, ClientType } from "./portfolio-types.ts";

/** 인테이크로 만든 사례의 외부 ID 접두어 — portfolio_items.airtable_id 에 `intake:<키>` 로 둔다.
 *  같은 묶음의 사진이 나중에 더 오면 이 값으로 기존 초안을 찾아 사진을 덧붙인다. */
export const INTAKE_ID_PREFIX = "intake:";
export const INTAKE_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([".jpg", ".jpeg", ".png", ".webp"]);
/** 한 번에 받는 사진 수·크기 상한 — Slack 한 메시지, CLI 한 묶음 기준 */
export const INTAKE_MAX_FILES = 20;
export const INTAKE_MAX_FILE_BYTES = 15 * 1024 * 1024;
/** 한 요청에서 처리하는 묶음(사례) 수 상한 — 묶음마다 생성 최대 100초라 300초 함수 상한 안에 들게 */
export const INTAKE_MAX_GROUPS = 3;

export interface ParsedIntakeName {
  client: string;
  /** YYYY-MM-DD */
  producedAt: string;
  /** 파일명에 적힌 명칭 — 제목의 힌트일 뿐, 최종 제목은 생성 단계에서 정한다 */
  title: string;
  /** (n) — 없으면 1 */
  index: number;
  /** 소문자 확장자, 점 포함. 없으면 빈 문자열 */
  ext: string;
}

/** macOS 가 보내는 NFD 한글을 NFC 로 모으고 공백을 한 칸으로 */
function collapse(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** "260907" | "20260907" → "2026-09-07". 달력에 없는 날이면 null */
export function toIsoDate(digits: string): string | null {
  const d = digits.length === 6 ? `20${digits}` : digits;
  if (!/^\d{8}$/.test(d)) return null;
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6));
  const day = Number(d.slice(6, 8));
  const t = new Date(Date.UTC(y, m - 1, day));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== day) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

// " (3)" 또는 "_3" — 하이픈+숫자는 명칭의 일부일 수 있어("아이오닉-5") 받지 않는다
const INDEX_SUFFIX = /(?:\s*\((\d{1,3})\)|_(\d{1,3}))\s*$/;
const NAME_SHAPE = /^([^-]+?)\s*-\s*(\d{8}|\d{6})\s*-\s*(.+)$/;

export function parseIntakeFilename(name: string): ParsedIntakeName | null {
  const base = collapse(name.replace(/^.*[\\/]/, ""));
  const extMatch = base.match(/\.([a-z0-9]{2,5})$/i);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : "";
  let stem = extMatch ? base.slice(0, -extMatch[0].length).trim() : base;

  let index = 1;
  const idx = stem.match(INDEX_SUFFIX);
  if (idx && idx.index !== undefined) {
    index = parseInt(idx[1] ?? idx[2], 10);
    stem = stem.slice(0, idx.index).trim();
  }

  const m = stem.match(NAME_SHAPE);
  if (!m) return null;
  const client = collapse(m[1]);
  const producedAt = toIsoDate(m[2]);
  const title = collapse(m[3]);
  if (!client || !title || !producedAt) return null;
  return { client, producedAt, title, index, ext };
}

/** 같은 사례인지 가르는 키 — 고객명|날짜|명칭 */
export function intakeKey(p: Pick<ParsedIntakeName, "client" | "producedAt" | "title">): string {
  return `${collapse(p.client)}|${p.producedAt}|${collapse(p.title)}`;
}

export function intakeExternalId(key: string): string {
  return `${INTAKE_ID_PREFIX}${key}`;
}

export interface SkippedFile {
  name: string;
  reason: string;
}

export interface IntakeGroup<T> {
  key: string;
  client: string;
  producedAt: string;
  /** 파일명의 명칭 */
  title: string;
  files: Array<{ file: T; parsed: ParsedIntakeName }>;
}

/** 파일명으로 묶는다. 묶이지 않는 파일은 이유와 함께 skipped 로 돌려준다 (조용히 버리지 않는다). */
export function groupIntakeFiles<T extends { name: string }>(
  files: readonly T[],
): { groups: IntakeGroup<T>[]; skipped: SkippedFile[] } {
  const groups = new Map<string, IntakeGroup<T>>();
  const skipped: SkippedFile[] = [];
  for (const file of files) {
    const parsed = parseIntakeFilename(file.name);
    if (!parsed) {
      skipped.push({ name: file.name, reason: "파일명이 '고객명-YYMMDD-명칭 (n)' 형식이 아님" });
      continue;
    }
    if (!INTAKE_IMAGE_EXTENSIONS.has(parsed.ext)) {
      skipped.push({ name: file.name, reason: `지원하지 않는 확장자(${parsed.ext || "없음"}) — jpg·png·webp 만 받음` });
      continue;
    }
    const key = intakeKey(parsed);
    let g = groups.get(key);
    if (!g) {
      g = { key, client: parsed.client, producedAt: parsed.producedAt, title: parsed.title, files: [] };
      groups.set(key, g);
    }
    g.files.push({ file, parsed });
  }
  for (const g of groups.values()) {
    g.files.sort((a, b) => a.parsed.index - b.parsed.index || a.file.name.localeCompare(b.file.name, "ko"));
  }
  return { groups: [...groups.values()], skipped };
}

/* ───────────────────────── 생성 결과 규격 ───────────────────────── */

export interface GeneratedContent {
  title: string;
  summary: string;
  description: string;
  category: Category;
  clientType?: ClientType;
  tags: string[];
  keywords: string[];
  /** 사진 수와 같은 길이. 비면 null (사이트가 제목 기반으로 대체) */
  imageAlts: (string | null)[];
}

/** 모델에게 강제할 출력 형태 — enum 은 쓰지 않고 normalizeGenerated 에서 다시 거른다 */
export const GENERATED_CONTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "description", "category", "clientType", "tags", "keywords", "imageAlts"],
  properties: {
    title: { type: "string", description: "포트폴리오 제목, 20자 안팎" },
    summary: { type: "string", description: "1~2문장 요약, 160자 이내, 격식체" },
    description: { type: "string", description: "본문. 문단 사이 빈 줄 한 줄" },
    category: { type: "string", description: `다음 중 하나: ${CATEGORIES.join(" / ")}` },
    clientType: { type: "string", description: `다음 중 하나: ${CLIENT_TYPES.join(" / ")}` },
    tags: { type: "array", items: { type: "string" }, description: "3~6개" },
    keywords: { type: "array", items: { type: "string" }, description: "검색어 5~10개" },
    imageAlts: { type: "array", items: { type: "string" }, description: "사진 순서대로, 사진 수와 같은 개수" },
  },
} as const;

/** 파일명 힌트만으로 고르는 보수적 기본값 — 모델이 목록 밖의 값을 냈을 때만 쓴다 */
export function inferCategory(hint: string): Category {
  const h = hint.toLowerCase();
  if (/탈|마스크|가면|모자|헬멧|mask|helmet/.test(h)) return "모자/마스크";
  if (/오토마타|액션|움직|automata/.test(h)) return "액션 크래프트";
  if (/팝업|pop-?up|카드|북|book/.test(h)) return "팝업북";
  return "페이퍼 크래프트";
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStringList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = asString(x).replace(/^#/, "").replace(/\s+/g, " ");
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export interface NormalizeContext {
  client: string;
  titleHint: string;
  imageCount: number;
}

/** 모델 출력(무엇이 와도)을 사이트 규격으로 — 목록 밖 값은 기본값으로, alt 는 사진 수에 맞춰 */
export function normalizeGenerated(raw: unknown, ctx: NormalizeContext): GeneratedContent {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const title = (asString(r.title).replace(/["“”「」]/g, "").replace(/\s+/g, " ") || `${ctx.client} ${ctx.titleHint}`.trim()).slice(0, 60);
  const summary = asString(r.summary).replace(/\s+/g, " ").slice(0, 200);
  const description = asString(r.description).replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  const cat = asString(r.category);
  const category = (CATEGORIES as readonly string[]).includes(cat)
    ? (cat as Category)
    : inferCategory(`${ctx.titleHint} ${title}`);

  const ct = asString(r.clientType);
  const clientType = (CLIENT_TYPES as readonly string[]).includes(ct) ? (ct as ClientType) : undefined;

  const tags = asStringList(r.tags, 8);
  const keywords = asStringList(r.keywords, 12);

  const altsRaw = Array.isArray(r.imageAlts) ? r.imageAlts : [];
  const imageAlts: (string | null)[] = [];
  for (let i = 0; i < ctx.imageCount; i++) {
    const a = asString(altsRaw[i]).replace(/\s+/g, " ");
    imageAlts.push(a ? a.slice(0, 160) : null);
  }

  return { title, summary, description, category, clientType, tags, keywords, imageAlts };
}

/* ───────────────────────── 프롬프트 ───────────────────────── */

/**
 * 고정 지시문. 바이트 하나라도 바뀌면 프롬프트 캐시가 깨지므로 날짜·ID 같은 가변값은 넣지 않는다.
 * 문체 예시는 실제 발행된 사례(현대자동차 남산 타워 팝업북)에서 가져왔다.
 */
export const INTAKE_SYSTEM_PROMPT = `당신은 페이퍼크래프트 제작사 "페이퍼크래프트(papercraft.kr, 구 액션크래프트)" 의 포트폴리오 편집자입니다.
운영자가 올린 완성품 사진과 파일명에 적힌 고객명·제작 시기·명칭을 받아, 사이트 포트폴리오에 바로 올릴 글을 JSON 으로 씁니다.
독자는 비슷한 제작을 의뢰할지 검토하는 기관·기업 담당자입니다. 과장·감탄사 없이, 사진에서 실제로 보이는 것을 구체적으로 씁니다.

[사실 규칙]
- 사진과 파일명에 없는 사실(수량, 가격, 납기, 종이 두께, 제작 기간, 수상, 설치 장소)은 쓰지 않습니다.
- 자(눈금자)가 함께 찍혔으면 "약 20cm 폭" 처럼 '약' 을 붙여 크기를 말해도 됩니다. 눈금을 읽을 수 없으면 크기를 말하지 않습니다.
- 사진 속 로고·문구(기관명 등)는 읽어서 고객 설명을 보강해도 됩니다. 고객명 표기 자체는 파일명의 것을 따릅니다.
- 사람 이름은 어디에도 쓰지 않습니다.

[필드 규칙]
title: 「고객명 + 작품명 + 제작 형태」 순으로 20자 안팎. 특수문자·따옴표 없이.
  예) 현대자동차 남산 타워 팝업북 / 경주박물관 신라 금관 페이퍼 마스크
summary: 1~2문장, 160자 이내, 격식체(…입니다). 고객명·제작물 종류·용도 키워드가 들어가게. 검색 결과와 링크 미리보기에 그대로 노출됩니다.
description: 5~7문단, 문단 사이는 빈 줄 한 줄. 마크다운·이모지·목록 기호를 쓰지 않습니다.
  - 1문단: 격식체(…입니다). 누구를 위해 무엇을 만들었고 어디에 쓰는지.
  - 2~5문단: 해요체(…어요/…해요). 각 문단 1~2문장. 사진에서 보이는 구조·색·질감·장치·연출을 하나씩.
  - 마지막 문단: "…주문 제작과 …기획에 참고하기 좋은 사례예요." 꼴로, 비슷한 의뢰를 떠올리게 맺습니다.
category: 다음 중 하나만 씁니다.
  - 팝업북: 펼치면 입체가 서는 책·카드·무대형 종이 오브제
  - 페이퍼 크래프트: 조립형 종이 모형·키트·전시 조형물
  - 액션 크래프트: 움직이는 장치(오토마타·레버·회전)가 있는 것
  - 모자/마스크: 머리에 쓰는 탈·가면·모자·헬멧
  - 자체 제작: 고객 없이 자체 기획한 상품 (고객명이 있으면 고르지 않습니다)
clientType: 다음 중 하나. 고객명으로 추정하되 애매하면 "기타".
  ${CLIENT_TYPES.join(" / ")}
tags: 3~6개. 가능하면 이 목록에서 고르고 필요하면 자유 태그를 더합니다. 사람 이름은 넣지 않습니다.
  ${SUGGESTED_TAGS.join(" / ")}
keywords: 5~10개 검색어. "팝업북 제작", "종이 무대 모형 주문 제작" 처럼 의뢰 담당자가 실제로 검색할 말.
imageAlts: 사진 수와 같은 개수, 첨부 순서대로. 각 50~90자. 배경·사물·색·배치를 사실대로. 첫 알트에는 제작물 종류와 고객명이 들어가게.

[문체 예시 — 이 톤을 따릅니다]
title: 현대자동차 남산 타워 팝업북
summary: 현대자동차와 광고대행사 이노션이 협업한 남산타워 팝업북. 서울의 랜드마크 N서울타워와 케이블카·도로·녹지를 입체로 펼쳐내, 브랜드 공간 디스플레이·서점 전시용 굿즈로 제작되었습니다.
description:
대한민국 서울의 남산타워를 새롭게 재해석하여, 팝업북으로 만들었습니다.

가운데 우뚝 선 N서울타워를 중심으로 초록 숲과 보랏빛 순환도로가 사방으로 펼쳐져요.

타워 기둥에는 케이블카가 매달려 있고, 도로 위에 미니카를 올리면 남산을 달리는 장면이 완성돼요.

서점 전시 테이블 위에서 화보집들과 나란히 진열될 만큼 완성도를 갖춘 종이 조형물이에요.

도시 랜드마크를 소재로 한 팝업북 주문 제작과 브랜드 굿즈 기획에 참고하기 좋은 사례예요.`;

export interface IntakePromptInput {
  client: string;
  producedAt: string;
  titleHint: string;
  imageCount: number;
  /** 기존 초안에 사진을 덧붙이는 경우 — 제목·본문은 참고만, alt 만 새로 */
  existing?: { title: string; description: string } | null;
}

export function buildIntakeUserPrompt(i: IntakePromptInput): string {
  const lines = [
    `고객명: ${i.client}`,
    `제작 시기: ${i.producedAt}`,
    `파일명에 적힌 명칭: ${i.titleHint}`,
    `사진 수: ${i.imageCount}장 (첨부 순서 = imageAlts 순서)`,
  ];
  if (i.existing) {
    lines.push(
      "",
      "이미 등록된 사례에 사진을 추가하는 중입니다. 기존 제목·본문은 참고만 하고, imageAlts 는 이번에 첨부한 사진만 순서대로 씁니다.",
      `기존 제목: ${i.existing.title}`,
      `기존 본문:\n${i.existing.description}`,
    );
  }
  lines.push("", "위 사진과 정보로 포트폴리오 글을 JSON 으로 작성하세요.");
  return lines.join("\n");
}

/* ───────────────────────── 실행 결과 형태 ───────────────────────── */

export type IntakeAction = "created" | "appended" | "dry-run" | "failed";

export interface IntakeGroupResult {
  key: string;
  client: string;
  producedAt: string;
  titleHint: string;
  /** 이번에 처리한 사진 수 (준비 실패분 제외) */
  imageCount: number;
  action: IntakeAction;
  itemId?: string;
  slug?: string;
  title?: string;
  adminUrl?: string;
  publicUrl?: string;
  published?: boolean;
  generated?: GeneratedContent;
  error?: string;
  skippedImages: SkippedFile[];
}

export interface IntakeRunResult {
  groups: IntakeGroupResult[];
  skipped: SkippedFile[];
}
