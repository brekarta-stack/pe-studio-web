/**
 * 제안서 AI 초안 — 프롬프트, 모델 호출, 결과 다듬기, 오류 분류.
 *
 * 모델 호출은 AI SDK 7 의 `generateText` + `Output.object({ schema })` (구조화 출력)다.
 * 모델 문자열("anthropic/claude-sonnet-5.5")을 그대로 넘기면 SDK 가 Vercel AI Gateway 로 보내고,
 * Vercel 배포에서는 OIDC 토큰으로 인증된다(키 없음).
 *
 * 호출 함수는 주입할 수 있다(deps.call) — 테스트는 가짜 함수를 넣어 네트워크·과금 없이 돈다.
 * 기본 호출은 `ai` 를 동적으로 불러오므로 이 파일을 import 하는 것만으로는 SDK 가 올라오지 않는다.
 *
 * 생성 결과는 믿지 않는다. 모양 검증(bookContentSchema) 뒤에 기계적으로 고칠 수 있는 것은 고친다:
 *  - 견적 금액은 언제나 `[확인 필요: 단가]` (모델이 숫자를 써도 지운다)
 *  - 이미지 칸은 전부 빈칸 (사람이 올린다)
 *  - 개수 한도는 자르거나 빈칸 항목으로 채운다, 추천 구간은 정확히 하나
 *  - 쪽 제목·리드·인용·시안 설명은 글자 수 한도로 자른다
 *  - 출처 URL 은 조사 산출물의 URL 칸·운영자 메모에 있는 것만, 수신 메일은 리드 자신의 메일만 (지어낸 링크·주소 차단)
 *
 * 맥 작업자(웹 조사)가 쓴 원고도 같은 교정을 거친다 — postProcessWorkerContent (출처만 http(s) 이면 남긴다).
 */

import { z } from "zod";
import {
  CHAR_LIMIT_FIELDS,
  LIMITS,
  STANDARD_INCLUDES,
  STANDARD_NEXT,
  STANDARD_STEPS,
  TBD,
  bookContentSchema,
  charLen,
  checkLimits,
  conformContent,
  emptyContent,
  getAt,
  isTrustedCaseImageUrl,
  issueOf,
  normalizeImage,
  setAt,
  type BookContent,
} from "./schema.ts";
import { clipText } from "./fallback.ts";
import { STUDIO, type StudioInfo } from "./studio.ts";
import type { QuoteSubmission } from "../quote-types.ts";

export type GenerateLead = Partial<
  Pick<QuoteSubmission, "id" | "org" | "name" | "email" | "segment" | "score" | "notes" | "outreach">
>;

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
export const GENERATE_TIMEOUT_MS = 90_000;

/** AI_GATEWAY_MODEL — Vercel 대시보드에서 붙여 넣은 값 끝의 줄바꿈·공백을 걷는다 */
export function resolveModel(explicit?: string): string {
  const v = (explicit ?? process.env.AI_GATEWAY_MODEL ?? "").trim();
  return v || DEFAULT_MODEL;
}

/* ── 생성용 스키마 ─────────────────────────────────────────────
 * 저장 스키마(bookContentSchema)를 그대로 넘기지 않는 이유
 *  - glance.specs 가 튜플이라 JSON Schema prefixItems 가 된다 — 구조화 출력이 거절할 수 있다
 *  - 이미지 칸은 모델이 채울 것이 아니다 (빈 문자열로 고정)
 *  - 선택 키(optional)·개수 제약은 공급자마다 지원이 달라 빼고, 받은 뒤에 코드로 맞춘다 */

const s = z.string();

export const generationSchema = z.object({
  org: s,
  org_display: s.describe("표지용 줄바꿈. 필요 없으면 빈 문자열"),
  title: s,
  subtitle: s,
  contact: z.object({ dept: s, email: s }),
  glance: z.object({
    headline: s,
    lede: s,
    specs: z.array(z.object({ label: s, value: s })),
  }),
  observation: z.object({
    headline: s,
    quote: s,
    body: z.array(s),
    sources: z.array(z.object({ label: s, url: s })),
  }),
  offer: z.object({
    headline: s,
    lede: s,
    lines: z.array(z.object({ use: s, name: s, body: z.array(s), spec: s })),
  }),
  designs: z.object({
    headline: s,
    note: s,
    items: z.array(z.object({ key: s, title: s, note: s })),
  }),
  scenes: z.object({
    headline: s,
    items: z.array(z.object({ title: s, body: s })),
  }),
  cases: z.object({
    headline: s,
    items: z.array(z.object({ org: s, title: s, note: s })),
  }),
  pricing: z.object({
    headline: s,
    lede: s,
    tiers: z.array(z.object({ qty: s, desc: s, total: s, unit: s, pick: z.boolean() })),
    includes: z.array(s),
    notes: z.array(s),
  }),
  plan: z.object({
    headline: s,
    steps: z.array(z.object({ when: s, title: s, body: s })),
  }),
  closing: z.object({
    headline: s,
    lede: s,
    next: z.array(s),
  }),
});

export type GeneratedDraft = z.infer<typeof generationSchema>;

/* ── 프롬프트 ─────────────────────────────────────────────── */

const BANNED = ["함께", "시너지", "혁신", "새로운 가치"] as const;
const BODY_MAX_CHARS = 16_000;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function outreachOf(lead: GenerateLead | null | undefined): Record<string, unknown> {
  const o = lead?.outreach;
  return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
}

function matchedCasesOf(o: Record<string, unknown>): string[] {
  const raw = Array.isArray(o.matched_cases) ? o.matched_cases : Array.isArray(o.matchedCases) ? o.matchedCases : [];
  return raw
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? JSON.stringify(x) : ""))
    .map((x) => x.trim())
    .filter(Boolean);
}

/* ── 출처 URL 허용 목록 ───────────────────────────────────────
 * 규칙 — observation.sources 의 URL 은 아래 두 곳에 "URL 로서" 적힌 것과 정확히 같을 때만 남긴다.
 *  1) 조사 산출물(quotes.outreach)의 URL 칸: 키 이름에 url·link·href 가 든 칸(contact_form_url, view_url,
 *     source_url …)과 sources·links 배열(문자열이든 {label,url} 객체든). 중첩 객체 안의 같은 칸도 본다.
 *  2) 운영자 메모(notes) — 사람이 직접 붙여 넣은 링크라 믿는다.
 * 조사 메모 본문(body_text) 같은 자유 서술 안의 URL 은 받지 않는다. 그 본문은 발굴 에이전트가 쓴 글이라
 * 거기서 지어낸 링크가 이미 섞여 있을 수 있고, 예전처럼 "입력 전체에 부분 문자열로 있으면 통과"면
 * 모델이 본문 속 링크를 잘라 붙이거나 앞부분만 맞춘 주소도 통과했다.
 * 비교는 양끝 공백·끝의 문장부호·끝 '/' 를 걷은 뒤 전체 일치다. */

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const URL_KEY_RE = /url|link|href/i;
const URL_LIST_KEYS = new Set(["sources", "links"]);

function normUrl(u: string): string {
  return u.trim().replace(/[.,;:!?)\]}>'"]+$/, "").replace(/\/+$/, "");
}

function urlsIn(text: string): string[] {
  return (text.match(URL_RE) ?? []).map(normUrl).filter(Boolean);
}

/** outreach 의 URL 칸에서만 URL 을 모은다(자유 서술 칸은 건너뛴다) */
function collectFieldUrls(v: unknown, urlish: boolean, out: Set<string>, depth: number): void {
  if (depth > 6 || v == null) return;
  if (typeof v === "string") {
    if (urlish) for (const u of urlsIn(v)) out.add(u);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectFieldUrls(x, urlish, out, depth + 1);
    return;
  }
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      // URL 칸 아래의 문자열만 받는다. sources·links 배열 안의 맨 문자열도 URL 칸으로 친다
      collectFieldUrls(x, URL_KEY_RE.test(k) || URL_LIST_KEYS.has(k), out, depth + 1);
    }
  }
}

/** 출처로 쓸 수 있는 URL — 위 규칙의 1)·2) */
export function allowedSourceUrls(lead: GenerateLead | null | undefined): Set<string> {
  const out = new Set<string>();
  collectFieldUrls(outreachOf(lead), false, out, 0);
  for (const u of urlsIn(str(lead?.notes))) out.add(u);
  return out;
}

export interface BuiltPrompt {
  system: string;
  prompt: string;
}

export function buildPrompt(lead: GenerateLead | null | undefined, studio: StudioInfo = STUDIO): BuiltPrompt {
  const o = outreachOf(lead);
  const org = str(lead?.org) || str(lead?.name) || "(기관명 없음)";
  const C = LIMITS.counts;
  const ch = LIMITS.chars;

  const system = [
    `당신은 ${studio.name} 의 제안서 원고 작성자다. 기관 한 곳에 보낼 A4 가로 10쪽 편집 디자인 제안서의 원고를 JSON 으로 쓴다.`,
    `${studio.name} 은 페이퍼 엔지니어링 스튜디오다. 2차원 전개도를 잘라 조립하는 입체 종이모형(페이퍼크래프트)을 설계·생산한다.`,
    "",
    "## 가장 중요한 규칙 — 지어내지 않는다",
    "- 기관에 관한 사실(전시·캐릭터·예산·부서·수치·연도·사업명)은 아래 '입력 자료'에 있는 것만 쓴다.",
    "- 자료에 없는 사실이 필요한 자리에는 `[확인 필요: 무엇]` 을 쓴다. 예: `[확인 필요: 기념품점 운영 주체]`.",
    "- 빈칸이 그럴듯한 거짓보다 낫다. 추정 수치는 쓰지 않는다.",
    "- 출처(observation.sources)에는 입력 자료의 URL 칸(…_url, sources)이나 운영자 메모에 적힌 URL 만 그대로 넣는다. 조사 메모 본문 속 링크는 쓰지 않는다. 없으면 `{\"label\":\"[확인 필요: 출처]\",\"url\":\"\"}` 하나만 둔다.",
    "- 본문에 각주 `[^1]` 을 붙일 때는 같은 번호의 출처가 sources 에 있어야 한다.",
    "",
    "## 입력 자료를 다루는 법",
    "- '발굴 에이전트 조사 메모'는 옛 형식의 긴 제안서다. 문장을 옮겨 쓰지 말고, 사실을 뽑아 쓰는 조사 메모로만 읽는다.",
    "- 메모 안의 금액·단가·견적 범위는 다른 기관 단가를 근거로 한 추정이다. 어디에도 옮기지 않는다.",
    "",
    "## 문장 규칙",
    `- 한 문장은 ${ch.sentence}자 이내. 본문은 합니다체 단문, 라벨·사양·카드 제목은 명사형으로 끝낸다.`,
    "- 기관을 칭찬하는 도입부를 쓰지 않는다. 관찰한 사실로 시작한다.",
    `- 다음 말은 쓰지 않는다: ${BANNED.map((w) => `"${w}"`).join(", ")}.`,
    "- 느낌표와 과장 형용사를 쓰지 않는다. 숫자와 고유명사로 말한다.",
    `- 회사 소개는 두 문장을 넘기지 않는다. 금액 표기는 \`500만 원\`, \`2,500원\` 처럼 쓰고 ₩ 기호는 쓰지 않는다.`,
    "- 강조는 `**굵게**` 만 쓴다. 다른 마크다운(제목, 목록 기호)은 쓰지 않는다.",
    "",
    "## 분량 한도 (넘으면 지면이 넘친다)",
    `- 모든 쪽 제목(headline): ${ch.headline}자 이내, 그 쪽이 증명하려는 결론 한 문장.`,
    `- 리드(lede): 두 문장, ${ch.lede}자 이내.`,
    `- observation.quote: ${ch.quote}자 이내.`,
    `- observation.body: 문단 ${C["observation.body"].min}~${C["observation.body"].max}개, 문단당 2~${LIMITS.sentencesPerParagraph}문장.`,
    `- observation.sources: ${C["observation.sources"].max}개 이하.`,
    `- glance.specs: ${C["glance.specs"].min}~${C["glance.specs"].max}개. {label, value}. 예: {"label":"조립","value":"칼·가위·풀 없이 뜯어 끼움"}.`,
    `- offer.lines: ${C["offer.lines"].min}~${C["offer.lines"].max}개. 각 body 는 문장 ${LIMITS.offerBodyLines}개.`,
    `- designs.items: 정확히 ${C["designs.items"].max}개, key 는 "A","B","C". title 은 시안 이름, note 는 디자이너가 무엇을 그릴지 ${ch.designNote}자 이내 지시.`,
    `- scenes.items: 정확히 ${C["scenes.items"].max}개. cases.items: 정확히 ${C["cases.items"].max}개.`,
    `- pricing.tiers: 정확히 ${C["pricing.tiers"].max}개. qty 는 총 수량 구조(예: "2,000개"), desc 는 산식(예: "1,000부 × 2종").`,
    `  total 과 unit 은 반드시 "${TBD("단가")}". 가운데 구간 하나만 pick=true, 나머지는 false.`,
    `- pricing.includes: ${C["pricing.includes"].max}개 이하. pricing.notes: ${C["pricing.notes"].max}개 이하.`,
    `- plan.steps: ${C["plan.steps"].min}~${C["plan.steps"].max}개. closing.next: ${C["closing.next"].min}~${C["closing.next"].max}개.`,
    "",
    "## 칸별 지시",
    "- org: 기관 정식 이름. org_display: 표지에서 줄을 바꾸고 싶을 때만 `\\n` 을 넣은 이름, 아니면 빈 문자열.",
    `- contact.dept: 입력 자료에 담당 부서가 있으면 그 부서, 없으면 "${TBD("수신 부서")}". contact.email: 빈 문자열(리드 메일로 채운다).`,
    "- cases.items: '매칭 사례' 목록에서 최대 3개를 고른다. 모자라면 org·title 을 `[확인 필요: 기관]`·`[확인 필요: 사례명]` 으로 둔다.",
    "- plan·pricing.includes·closing.next 는 아래 스튜디오 표준값을 그대로 써도 된다(스튜디오 사실이라 빈칸이 아니다).",
    "- designs.headline·designs.note 는 쓰지 않아도 된다(빈 문자열).",
    "",
    "## 스튜디오 사실 (이것은 확인된 사실이다)",
    `- 실적: ${studio.stats.map((x) => `${x.label} ${x.num}`).join(", ")}`,
    `- 고객사: ${studio.clients}`,
    `- 연락처: ${studio.contact.person} · ${studio.contact.email} · ${studio.contact.phone}`,
    "- 시안 3종 제공 · 수정 2회. 최소 수량 1,000개. 납기 약 4주(디자인 2주 · 생산 2주).",
    `- 표준 일정: ${JSON.stringify(STANDARD_STEPS)}`,
    `- 표준 포함 항목: ${JSON.stringify(STANDARD_INCLUDES)}`,
    `- 표준 다음 단계: ${JSON.stringify(STANDARD_NEXT)}`,
  ].join("\n");

  const body = str(o.body_text) || str(o.bodyText);
  const clipped = body.length > BODY_MAX_CHARS ? `${body.slice(0, BODY_MAX_CHARS)}\n…(이하 생략)` : body;
  const cases = matchedCasesOf(o);
  const known = new Set(["subject", "body_text", "bodyText", "matched_cases", "matchedCases", "image_prompt", "imagePrompt"]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!known.has(k)) extra[k] = v;
  let extraJson = "";
  try {
    extraJson = Object.keys(extra).length ? JSON.stringify(extra).slice(0, 4000) : "";
  } catch {
    extraJson = "";
  }

  const prompt = [
    "# 입력 자료",
    "",
    `- 기관명: ${org}`,
    `- 분류(세그먼트): ${str(lead?.segment) || "(없음)"}`,
    `- 적합도 점수: ${lead?.score ?? "(없음)"}`,
    `- 담당자: ${str(lead?.name) || "(없음)"}${str(lead?.email) ? ` <${str(lead?.email)}>` : ""}`,
    "",
    "## 운영자 메모",
    str(lead?.notes) || "(없음)",
    "",
    "## 발굴 에이전트 조사 메모 (사실만 뽑아 쓸 것 — 문장 재사용 금지, 금액 무시)",
    `- 옛 메일 제목: ${str(o.subject) || "(없음)"}`,
    "",
    "```",
    clipped || "(없음)",
    "```",
    "",
    "## 매칭 사례",
    cases.length ? cases.map((c) => `- ${c}`).join("\n") : "(없음)",
    "",
    "## 이미지 방향 메모",
    str(o.image_prompt) || str(o.imagePrompt) || "(없음)",
    ...(extraJson ? ["", "## 그 밖의 조사 필드(JSON)", extraJson] : []),
    "",
    "# 할 일",
    `${org} 에 보낼 제안서 원고를 스키마 그대로 쓴다. 자료에 없는 기관 사실은 \`[확인 필요: 무엇]\` 으로 남긴다.`,
  ].join("\n");

  return { system, prompt };
}

/* ── 모델 호출 ────────────────────────────────────────────── */

export interface ModelCallArgs {
  model: string;
  system: string;
  prompt: string;
  schema: typeof generationSchema;
  abortSignal: AbortSignal;
}

export interface ModelCallResult {
  output: unknown;
  usage?: unknown;
}

export type ModelCall = (args: ModelCallArgs) => Promise<ModelCallResult>;

/** 실제 호출 — AI SDK 7 generateText + Output.object. 모델 문자열은 AI Gateway 로 간다 */
const aiSdkCall: ModelCall = async ({ model, system, prompt, schema, abortSignal }) => {
  const { generateText, Output } = await import("ai");
  const result = await generateText({
    model,
    instructions: system,
    prompt,
    output: Output.object({ schema, name: "proposal_book", description: "편집 디자인 제안서 10쪽 원고" }),
    abortSignal,
    // 90초 안에 끝나야 한다 — 재시도는 한 번만 (429·5xx)
    maxRetries: 1,
  });
  return { output: result.output, usage: result.usage };
};

export class GenerateOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerateOutputError";
  }
}

export interface GenerateDeps {
  model?: string;
  call?: ModelCall;
  timeoutMs?: number;
}

export interface GenerateResult {
  content: BookContent;
  usage?: unknown;
  model: string;
}

export async function generateDraft(lead: GenerateLead | null | undefined, deps: GenerateDeps = {}): Promise<GenerateResult> {
  const model = resolveModel(deps.model);
  const call = deps.call ?? aiSdkCall;
  const { system, prompt } = buildPrompt(lead);
  const abortSignal = AbortSignal.timeout(deps.timeoutMs ?? GENERATE_TIMEOUT_MS);
  const res = await call({ model, system, prompt, schema: generationSchema, abortSignal });
  const content = finalizeDraft(res.output, lead);
  return { content, usage: res.usage, model };
}

/* ── 결과 다듬기 ──────────────────────────────────────────── */

/** 생성 결과(생성용 모양이든 저장 모양이든) → 저장 모양. specs 는 {label,value} 와 [k,v] 둘 다 받는다 */
export function toBookShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  const glance = r.glance && typeof r.glance === "object" ? { ...(r.glance as Record<string, unknown>) } : r.glance;
  if (glance && typeof glance === "object" && Array.isArray((glance as Record<string, unknown>).specs)) {
    const g = glance as Record<string, unknown>;
    g.specs = (g.specs as unknown[]).map((x) => {
      if (Array.isArray(x)) return [String(x[0] ?? ""), String(x[1] ?? "")];
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        return [String(o.label ?? o.key ?? ""), String(o.value ?? "")];
      }
      return ["", String(x ?? "")];
    });
  }
  return { ...r, glance };
}

const MONEY_RE = /\d[\d,.]*\s*(?:만|억|천)?\s*원|₩/;

function fit<T>(arr: T[], min: number, max: number, pad: (i: number) => T): T[] {
  const out = arr.slice(0, max);
  while (out.length < min) out.push(pad(out.length));
  return out;
}

/**
 * 출처 거르기 방식
 *  - "allowlist": Vercel AI 초안 — 모델은 웹을 못 본다. 입력 자료의 URL 칸·운영자 메모에 있는 URL 만 (지어낸 링크 차단)
 *  - "web": 맥 작업자 원고 — Claude Code 가 실제로 웹을 조사했다. http(s) URL 이면 남기고 그 밖(javascript:·상대 경로)은 버린다
 */
export type SourcePolicy = "allowlist" | "web";

/**
 * 모양 검증 + 기계적 교정. 모양이 아예 안 맞으면 GenerateOutputError (→ 대체 원고로).
 * 고친 뒤에도 checkLimits 의 개수·추천 문제는 남지 않는다(글자 수도 잘라 넣는다).
 */
export function finalizeDraft(raw: unknown, lead: GenerateLead | null | undefined): BookContent {
  return finalizeContent(raw, lead, "allowlist");
}

/**
 * 맥 작업자(Claude Code, 웹 조사)가 보낸 원고 → 저장 모양. finalizeDraft 와 같은 교정
 * (분량 한도·추천 하나·견적 금액 빈칸·시안 키 A/B/C·이미지 칸 비움·수신 메일은 리드 메일)을 하되,
 * 출처는 http(s) 이기만 하면 남긴다 — 작업자는 실제로 웹을 읽고 쓴 것이라 입력 자료 허용 목록과 맞출 이유가 없다.
 * 이미지는 비워 둔다. 지금 문서의 이미지는 적용할 때(applyGenResult) carryImages 로 옮긴다.
 */
export function postProcessWorkerContent(raw: unknown, lead: GenerateLead | null | undefined): BookContent {
  return finalizeContent(raw, lead, "web");
}

function finalizeContent(raw: unknown, lead: GenerateLead | null | undefined, policy: SourcePolicy): BookContent {
  const shaped = toBookShape(raw);
  if (!shaped || typeof shaped !== "object") throw new GenerateOutputError("AI 응답이 비어 있습니다.");
  const leadOrg = str(lead?.org) || str(lead?.name);
  const modelOrg = str((shaped as Record<string, unknown>).org);
  const base = emptyContent(leadOrg || modelOrg);

  // 이미지 칸은 생성용 스키마에 없다 — 템플릿의 "" 가 들어간다
  const strict = bookContentSchema.safeParse({ ...base, ...(shaped as object), issue: base.issue, cover: "" });
  const c: BookContent = strict.success ? strict.data : conformContent(shaped, base);
  if (!strict.success && c === base) throw new GenerateOutputError("AI 응답이 원고 형식에 맞지 않습니다.");

  const allowedUrls = policy === "allowlist" ? allowedSourceUrls(lead) : null;
  const C = LIMITS.counts;

  /* 표지 */
  c.org = leadOrg || str(c.org) || base.org;
  if (c.org_display !== undefined && !str(c.org_display)) delete c.org_display;
  c.issue = issueOf();
  c.cover = "";
  c.contact = {
    dept: str(c.contact.dept) || TBD("수신 부서"),
    // 수신 메일은 리드 자신의 메일만 — 모델이 쓴 값은 보지 않는다. 조사 메모 안의 다른 주소(대표 메일·
    // 다른 부서·지어낸 주소)가 표지에 실려 엉뚱한 곳으로 나가면 사고다. 없으면 비워 둔다(지면에서 감춘다)
    email: str(lead?.email),
  };

  /* 개수 맞추기 */
  c.glance.specs = fit(
    c.glance.specs.filter(([k, v]) => k.trim() && v.trim() && !MONEY_RE.test(v)),
    C["glance.specs"].min,
    C["glance.specs"].max,
    (i) => base.glance.specs[i] ?? ["항목", TBD("사양")]
  );
  c.observation.body = fit(
    c.observation.body.filter((p) => p.trim()),
    C["observation.body"].min,
    C["observation.body"].max,
    () => TBD("기관 현황")
  );
  // 출처: allowlist 면 자료에 있는 URL 만, web 이면 http(s) 면 된다. 빈 url 은 '[확인 필요]' 라벨일 때만 남긴다
  const sources = c.observation.sources
    .map((x) => ({ ...x, url: str(x.url) }))
    .filter((x) => {
      if (!x.url) return /확인\s*필요/.test(x.label);
      if (!/^https?:\/\/[^\s]+$/i.test(x.url)) return false;
      return allowedUrls ? allowedUrls.has(normUrl(x.url)) : true;
    });
  c.observation.sources = sources.length
    ? sources.slice(0, C["observation.sources"].max)
    : [{ label: TBD("출처"), url: "" }];

  c.offer.lines = fit(c.offer.lines, C["offer.lines"].min, C["offer.lines"].max, () => ({
    use: TBD("쓰임"),
    name: TBD("라인명"),
    body: [TBD("설명")],
    spec: TBD("사양"),
  })).map((l) => ({ ...l, body: (l.body.length ? l.body : [TBD("설명")]).slice(0, LIMITS.offerBodyLines) }));

  const keys = ["A", "B", "C"];
  c.designs.items = fit(c.designs.items, 3, 3, () => ({ key: "", image: "", title: TBD("시안 제목"), note: "" })).map(
    (d, i) => ({ ...d, key: keys[i], image: "", title: str(d.title) || TBD("시안 제목") })
  );
  if (c.designs.headline !== undefined && !str(c.designs.headline)) delete c.designs.headline;
  if (c.designs.note !== undefined && !str(c.designs.note)) delete c.designs.note;

  c.scenes.image = "";
  c.scenes.items = fit(c.scenes.items, 2, 2, () => ({ title: TBD("장면"), body: TBD("장면 설명") }));

  // 사례 사진: 맥 작업자(web)는 사례 라이브러리의 photo_url 을 옮겨 적는다 — 우리 스토리지 https 주소만 남긴다
  c.cases.items = fit(c.cases.items, 3, 3, () => ({ org: TBD("기관"), title: TBD("사례명"), note: "", image: "" })).map(
    (x) => {
      const url = normalizeImage(x.image).url;
      return { ...x, image: policy === "web" && isTrustedCaseImageUrl(url) ? url : "" };
    }
  );

  /* 견적 — 금액은 언제나 빈칸, 추천은 정확히 하나 */
  const tiers = fit<BookContent["pricing"]["tiers"][number]>(c.pricing.tiers, 3, 3, () => ({
    qty: TBD("수량"),
    desc: TBD("구성"),
    total: "",
    unit: "",
  }));
  const picked = tiers.map((t) => !!t.pick);
  const pickIdx = picked.filter(Boolean).length === 1 ? picked.indexOf(true) : 1;
  c.pricing.tiers = tiers.map((t, i) => ({
    qty: MONEY_RE.test(t.qty) ? TBD("수량") : t.qty,
    desc: MONEY_RE.test(t.desc) ? TBD("구성") : t.desc,
    total: TBD("단가"),
    unit: TBD("단가"),
    ...(i === pickIdx ? { pick: true } : {}),
  }));
  c.pricing.includes = c.pricing.includes.filter((x) => x.trim()).slice(0, C["pricing.includes"].max);
  c.pricing.notes = c.pricing.notes
    .filter((x) => x.trim() && !MONEY_RE.test(x))
    .slice(0, C["pricing.notes"].max);

  c.plan.steps = fit(c.plan.steps, C["plan.steps"].min, C["plan.steps"].max, (i) => ({
    ...(STANDARD_STEPS[i] ?? { when: TBD("시기"), title: TBD("단계"), body: "" }),
  }));
  c.closing.next = fit(
    c.closing.next.filter((x) => x.trim()),
    C["closing.next"].min,
    C["closing.next"].max,
    (i) => STANDARD_NEXT[i] ?? TBD("다음 단계")
  );

  /* 글자 수 — 잘라 넣는다 (자르는 김에 칸을 비우지 않게 빈칸 표기는 그대로 둔다) */
  let out: BookContent = c;
  for (const [pattern, max] of Object.entries(CHAR_LIMIT_FIELDS)) {
    for (const path of expand(out, pattern)) {
      const v = getAt(out, path);
      if (typeof v === "string" && charLen(v) > max) out = setAt(out, path, clipText(v, max));
    }
  }

  const final = bookContentSchema.safeParse(out);
  if (!final.success) throw new GenerateOutputError("AI 응답을 원고 형식으로 맞추지 못했습니다.");
  const left = checkLimits(final.data);
  if (left.length) throw new GenerateOutputError(`분량 한도를 맞추지 못했습니다: ${left[0].message}`);
  return final.data;
}

function expand(c: unknown, pattern: string): string[] {
  let paths = [""];
  for (const seg of pattern.split(".")) {
    const next: string[] = [];
    for (const p of paths) {
      if (seg === "*") {
        const arr = getAt(c, p);
        if (Array.isArray(arr)) arr.forEach((_, i) => next.push(p ? `${p}.${i}` : String(i)));
      } else next.push(p ? `${p}.${seg}` : seg);
    }
    paths = next;
  }
  return paths;
}

/* ── 오류 분류 ────────────────────────────────────────────── */

function errChain(e: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const q: unknown[] = [e];
  while (q.length && out.length < 20) {
    const x = q.shift();
    if (x == null || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (o.lastError) q.push(o.lastError);
      if (Array.isArray(o.errors)) q.push(...o.errors);
      if (o.cause) q.push(o.cause);
    }
  }
  return out;
}

function statusOf(x: unknown): number | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  for (const k of ["statusCode", "status"]) {
    const n = Number(o[k]);
    if (Number.isFinite(n) && n >= 100) return n;
  }
  return null;
}

/** 화면에 보일 한국어 이유 한 줄 */
export function describeGenerateError(e: unknown): string {
  const chain = errChain(e);
  const statuses = chain.map(statusOf).filter((n): n is number => n != null);
  const names = chain.map((x) => (x && typeof x === "object" ? String((x as { name?: unknown }).name ?? "") : "")).join(" ");
  const msgs = chain
    .map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : ""))
    .join(" ")
    .toLowerCase();

  if (
    statuses.includes(402) ||
    /insufficient|credit|balance|budget|quota|payment required|spend limit/.test(msgs)
  ) {
    return "AI Gateway 크레딧(잔액)이 부족합니다. Vercel 대시보드 AI Gateway 에서 크레딧을 충전해 주세요.";
  }
  if (
    statuses.includes(401) ||
    /GatewayAuthenticationError/.test(names) ||
    /no authentication|oidc|api key|unauthori[sz]ed|authentication failed/.test(msgs)
  ) {
    return "AI Gateway 인증 정보가 없습니다(OIDC 토큰·API 키). Vercel 배포 환경에서만 동작합니다.";
  }
  if (statuses.includes(429) || /GatewayRateLimitError/.test(names) || /rate limit|too many requests/.test(msgs)) {
    return "AI 요청이 너무 많아 잠시 막혔습니다. 1~2분 뒤 다시 시도해 주세요.";
  }
  if (
    /TimeoutError|AbortError|GatewayTimeoutError/.test(names) ||
    statuses.includes(408) ||
    statuses.includes(504) ||
    /timed? ?out|aborted/.test(msgs)
  ) {
    return "AI 응답이 90초 안에 오지 않았습니다. 잠시 뒤 다시 시도해 주세요.";
  }
  if (
    /GenerateOutputError|NoObjectGeneratedError|NoOutputGeneratedError|TypeValidationError|JSONParseError/.test(names)
  ) {
    return "AI 가 쓴 원고가 형식에 맞지 않았습니다. 다시 시도해 주세요.";
  }
  if (statuses.includes(403)) return "AI Gateway 가 요청을 거절했습니다(권한·차단 규칙). Vercel 설정을 확인해 주세요.";
  if (/GatewayModelNotFoundError/.test(names) || /model.*not found/.test(msgs)) {
    return "AI 모델을 찾지 못했습니다. 환경 변수 AI_GATEWAY_MODEL 을 확인해 주세요.";
  }
  const first = chain.find((x) => x instanceof Error) as Error | undefined;
  const detail = first?.message ? `: ${first.message.slice(0, 160)}` : "";
  return `AI 초안 작성에 실패했습니다${detail}`;
}
