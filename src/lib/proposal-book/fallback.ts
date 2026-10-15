/**
 * AI 초안이 실패했을 때 쓰는 대체 원고 — 순수 함수.
 *
 * 리드(QuoteSubmission)와 발굴 에이전트가 보드에 남긴 옛 제안서 본문(마크다운)을
 * 섹션별로 나눠 편집 디자인 원고(BookContent)의 칸에 앉힌다. 확인하지 못한 것은 전부
 * `[확인 필요: …]` 로 비워 둔다 — 초안이 지어낸 사실이 진짜처럼 나가는 것이 가장 큰 사고다.
 *
 * 원칙
 *  - 견적 금액은 언제나 빈칸. 옛 본문의 "690만~1,220만원" 같은 금액대는 다른 기관 단가를
 *    근거로 한 추정이라 옮기지 않는다(한눈 요약의 금액 줄도 거른다).
 *  - 출처 링크가 옛 본문에 없으므로 출처는 빈칸 하나.
 *  - 무엇이 와도 던지지 않는다. 깨진 입력이면 빈 원고(emptyContent)가 나온다.
 */

import {
  LIMITS,
  STANDARD_STEPS,
  TBD,
  bookContentSchema,
  emptyContent,
  tbdTiers,
  type BookContent,
} from "./schema.ts";
import type { QuoteSubmission } from "../quote-types.ts";

export type FallbackLead = Partial<Pick<QuoteSubmission, "org" | "name" | "email" | "segment" | "outreach">>;

/* ── 마크다운 조각내기 ─────────────────────────────────────── */

interface Section {
  /** 첫 굵은 줄 — 그 섹션의 '액션 타이틀' */
  title: string;
  /** 타이틀을 뺀 나머지 줄 (빈 줄 포함, 원문 그대로) */
  lines: string[];
}

/** "## 제목" 단위로 나눈다. 같은 제목이 두 번 나오면 첫 것 */
export function splitSections(md: string): Map<string, Section> {
  const out = new Map<string, Section>();
  let cur: { name: string; lines: string[] } | null = null;
  const flush = () => {
    if (!cur || out.has(cur.name)) return;
    const idx = cur.lines.findIndex((l) => /^\s*\*\*.+\*\*\s*$/.test(l));
    const title = idx >= 0 ? cur.lines[idx].trim().replace(/^\*\*|\*\*$/g, "").trim() : "";
    const lines = idx >= 0 ? cur.lines.filter((_, i) => i !== idx) : cur.lines;
    out.set(cur.name, { title, lines });
  };
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h && !line.startsWith("###")) {
      flush();
      cur = { name: h[1].trim(), lines: [] };
    } else if (cur) {
      // 문서 끝의 품질 기록(--- 아래)은 본문이 아니다
      if (/^---+\s*$/.test(line)) {
        flush();
        cur = null;
        continue;
      }
      cur.lines.push(line);
    }
  }
  flush();
  return out;
}

function isListLine(l: string) {
  return /^\s*(?:[-*]|\d+[.)])\s+/.test(l);
}

function isTableLine(l: string) {
  return /^\s*\|/.test(l);
}

/** 산문 줄만 → 문장 목록. 한 줄이 한 문장인 옛 본문과 한 줄에 여러 문장인 글 둘 다 */
export function sentencesOf(lines: string[]): string[] {
  return lines
    .filter((l) => l.trim() && !isListLine(l) && !isTableLine(l) && !/^\s*#/.test(l))
    .flatMap((l) => l.trim().split(/(?<=[.!?。])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 금액이 들어간 문자열 — 견적이 아닌 칸으로 금액이 새지 않게 거른다 */
const MONEY_RE = /\d[\d,.]*\s*(?:만|억|천)?\s*원|₩/;

/* ── 길이 맞추기 ──────────────────────────────────────────── */

/** max 글자 안으로. 넘치면 어절 경계에서 끊고 … 를 붙인다(… 포함 max 자) */
export function clipText(s: string, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  if (chars.length <= max) return t;
  const cut = chars.slice(0, Math.max(1, max - 1)).join("");
  const sp = cut.lastIndexOf(" ");
  // 어절 경계가 너무 앞이면(절반 미만) 그냥 글자에서 끊는다
  const base = sp >= Math.floor(max / 2) ? cut.slice(0, sp) : cut;
  return `${base.replace(/[\s,·、]+$/, "")}…`;
}

function fitCount<T>(arr: T[], min: number, max: number, pad: (i: number) => T): T[] {
  const out = arr.slice(0, max);
  while (out.length < min) out.push(pad(out.length));
  return out;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/* ── 섹션별 해석 ──────────────────────────────────────────── */

/** "- 키 _ 값" → [키, 값] */
function parseSpecs(lines: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const l of lines) {
    const m = /^\s*[-*]\s+(.+?)\s+_\s+(.+)$/.exec(l);
    if (!m) continue;
    const k = m[1].replace(/\*\*/g, "").trim();
    const v = m[2].replace(/\*\*/g, "").trim();
    if (!k || !v || MONEY_RE.test(v) || MONEY_RE.test(k)) continue;
    out.push([clipText(k, 12), clipText(v, 40)]);
  }
  return out;
}

/** "- **라인명 _ 쓰임** — 설명" */
function parseLines(lines: string[]): BookContent["offer"]["lines"] {
  const out: BookContent["offer"]["lines"] = [];
  for (const l of lines) {
    const m = /^\s*[-*]\s+\*\*(.+?)\*\*\s*(?:[—–-]+|:)?\s*(.*)$/.exec(l);
    if (!m) continue;
    const [nameRaw, useRaw] = m[1].split(/\s+_\s+/);
    const body = sentencesOf([m[2] ?? ""])
      .filter((s) => !MONEY_RE.test(s))
      .slice(0, LIMITS.offerBodyLines)
      .map((s) => clipText(s, LIMITS.chars.sentence));
    out.push({
      use: useRaw ? clipText(useRaw.trim(), 30) : TBD("쓰임"),
      name: clipText((nameRaw ?? "").trim(), 24) || TBD("라인명"),
      body: body.length ? body : [TBD("설명")],
      spec: TBD("사양"),
    });
  }
  return out;
}

/** "1. 사례명(기관) — 설명" */
function parseCases(lines: string[]): BookContent["cases"]["items"] {
  const out: BookContent["cases"]["items"] = [];
  for (const l of lines) {
    const m = /^\s*\d+[.)]\s+(.+?)(?:\s+[—–-]+\s+(.*))?$/.exec(l);
    if (!m) continue;
    out.push({ ...caseFromLabel(m[1]), note: noteOf(m[2] ?? "") });
  }
  return out;
}

/** "남산타워 팝업북(이노션/현대)" → {title, org}. 괄호가 없으면 기관은 빈칸 */
function caseFromLabel(label: string): Omit<BookContent["cases"]["items"][number], "note"> {
  const t = label.replace(/\*\*/g, "").trim();
  const m = /^(.+?)\s*[(（]([^()（）]+)[)）]\s*$/.exec(t);
  const title = m ? m[1].trim() : t;
  const org = m ? m[2].trim().replace(/\s*\/\s*/g, " · ") : "";
  return { org: org ? clipText(org, 20) : TBD("기관"), title: clipText(title, 24) || TBD("사례명"), image: "" };
}

function noteOf(desc: string): string {
  const first = sentencesOf([desc])[0] ?? "";
  return first ? clipText(first, LIMITS.chars.sentence) : "";
}

/** 문장 → 문단(문단당 최대 n 문장) */
function paragraphs(sentences: string[], perPara: number, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < sentences.length && out.length < max; i += perPara) {
    out.push(sentences.slice(i, i + perPara).join(" "));
  }
  return out;
}

/** 표지 제목 — 메일 제목/문서 제목에서 "[papercraft.kr]" 같은 머리표를 뗀다 */
function coverTitle(subject: string, h1: string): string {
  const raw = (subject || h1).replace(/^\s*\[[^\]]*\]\s*/, "").trim();
  return raw ? clipText(raw, 40) : "";
}

/* ── 본체 ─────────────────────────────────────────────────── */

export function buildFallback(lead: FallbackLead | null | undefined): BookContent {
  const org = str(lead?.org) || str(lead?.name);
  try {
    return build(lead ?? {}, org);
  } catch {
    // 파서가 예상 못 한 입력에 넘어져도 편집기는 열려야 한다
    return emptyContent(org);
  }
}

function build(lead: FallbackLead, org: string): BookContent {
  const base = emptyContent(org);
  const o = lead.outreach && typeof lead.outreach === "object" ? (lead.outreach as Record<string, unknown>) : {};
  const md = str(o.body_text) || str(o.bodyText);
  const subject = str(o.subject);
  const h1 = /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? "";
  const sec = splitSections(md);
  const get = (name: string): Section => sec.get(name) ?? { title: "", lines: [] };

  const summary = get("한눈 요약");
  const status = get("기관 현황과 기회");
  const background = get("제안 배경");
  const solution = get("제안 솔루션");
  const matched = get("비슷한 유형 매칭 사례");
  const effect = get("기대 효과");
  const schedule = get("추진 일정");

  const c: BookContent = { ...base };

  /* 표지 */
  c.title = coverTitle(subject, h1) || base.title;
  c.subtitle = summary.title ? clipText(summary.title, LIMITS.chars.lede) : base.subtitle;
  c.contact = {
    dept: str(lead.name) || TBD("수신 부서"),
    email: str(lead.email),
  };

  /* 2쪽 한눈에 */
  const specs = parseSpecs(summary.lines);
  c.glance = {
    headline: base.glance.headline,
    lede: effect.title && !MONEY_RE.test(effect.title) ? clipText(effect.title, LIMITS.chars.lede) : base.glance.lede,
    specs: fitCount(specs, LIMITS.counts["glance.specs"].min, LIMITS.counts["glance.specs"].max, (i) =>
      // 모자라면 스튜디오 표준 사양(빈칸 원고의 줄)에서 아직 없는 키로 채운다
      base.glance.specs.filter(([k]) => !specs.some(([sk]) => sk === k))[i - specs.length] ?? ["항목", TBD("사양")]
    ),
  };

  /* 3쪽 관찰 */
  const obsBody = paragraphs(
    sentencesOf(status.lines).filter((s) => !MONEY_RE.test(s)),
    LIMITS.sentencesPerParagraph,
    LIMITS.counts["observation.body"].max
  );
  c.observation = {
    headline: status.title ? clipText(status.title, LIMITS.chars.headline) : base.observation.headline,
    quote: background.title ? clipText(background.title, LIMITS.chars.quote) : base.observation.quote,
    body: obsBody.length ? obsBody : base.observation.body,
    // 옛 본문에는 출처 링크가 없다 — 지어내지 않는다
    sources: [{ label: TBD("출처"), url: "" }],
  };

  /* 4쪽 제안 */
  const lines = parseLines(solution.lines);
  c.offer = {
    headline: base.offer.headline,
    lede: solution.title ? clipText(solution.title, LIMITS.chars.lede) : base.offer.lede,
    lines: fitCount(lines, LIMITS.counts["offer.lines"].min, LIMITS.counts["offer.lines"].max, () => ({
      use: TBD("쓰임"),
      name: TBD("라인명"),
      body: [TBD("설명")],
      spec: TBD("사양"),
    })),
  };

  /* 6쪽 활용 장면 — 기대 효과 첫 두 문장 */
  const effectSentences = sentencesOf(effect.lines).filter((s) => !MONEY_RE.test(s));
  c.scenes = {
    headline: base.scenes.headline,
    image: "",
    items: [0, 1].map((i) => ({
      title: TBD("장면 이름"),
      body: effectSentences[i] ? clipText(effectSentences[i], 80) : TBD("장면 설명"),
    })),
  };

  /* 7쪽 사례 — 번호 목록 → 모자라면 에이전트의 matched_cases → 그래도 모자라면 빈칸 */
  const cases = parseCases(matched.lines);
  const extra = Array.isArray(o.matched_cases) ? o.matched_cases : Array.isArray(o.matchedCases) ? o.matchedCases : [];
  for (const label of extra) {
    if (typeof label !== "string" || !label.trim()) continue;
    const it = caseFromLabel(label);
    if (!cases.some((x) => x.title === it.title)) cases.push({ ...it, note: "" });
  }
  c.cases = {
    headline: matched.title ? clipText(matched.title, LIMITS.chars.headline) : base.cases.headline,
    items: fitCount(cases, 3, 3, () => ({ org: TBD("기관"), title: TBD("사례명"), note: "", image: "" })),
  };

  /* 8쪽 견적 — 금액은 언제나 빈칸 */
  c.pricing = { ...base.pricing, tiers: tbdTiers(), notes: ["VAT 별도", TBD("단가")] };

  /* 9쪽 일정 */
  c.plan = {
    headline: schedule.title ? clipText(schedule.title, LIMITS.chars.headline) : base.plan.headline,
    steps: STANDARD_STEPS.map((s) => ({ ...s })),
  };

  // 마지막 관문 — 모양이 틀리면(있어선 안 되지만) 빈 원고로
  const r = bookContentSchema.safeParse(c);
  return r.success ? r.data : base;
}
