/**
 * 제안서 원고(proposal_docs) 읽기·쓰기 — 서버 전용 (supabaseAdmin 을 쓴다).
 *
 * 저장은 낙관적 잠금이다: 클라이언트가 마지막으로 본 rev 를 함께 보내고,
 * `UPDATE … WHERE quote_id = ? AND rev = 기대값` 이 한 줄도 못 바꾸면 RevConflictError.
 * 자동 저장(2초)이 두 창에서 돌면 나중 창이 먼저 창의 수정을 조용히 지우던 것을 막는다.
 *
 * 쓰기 전에 zod 로 검증한다 — JSONB 라 DB 가 모양을 막아 주지 않는다.
 */

import type { z } from "zod";
import { supabaseAdmin } from "./supabase-admin";
import { isMissingColumnError } from "./outreach";
import {
  bookContentSchema,
  bookPagesSchema,
  bookStyleSchema,
  conformContent,
  defaultPages,
  DEFAULT_STYLE,
  emptyContent,
  normalizePages,
  normalizeStyle,
  type BookContent,
  type BookPage,
  type BookStyle,
} from "./proposal-book/schema";

export const PROPOSAL_SOURCES = ["ai", "fallback", "manual"] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

export function isProposalSource(v: unknown): v is ProposalSource {
  return typeof v === "string" && (PROPOSAL_SOURCES as readonly string[]).includes(v);
}

export interface ProposalDoc {
  id: string;
  quoteId: string;
  content: BookContent;
  style: BookStyle;
  pages: BookPage[];
  source: ProposalSource;
  rev: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** 저장본이 스키마에 안 맞아 틀에 맞춰 고쳐 읽었다 — 편집기가 "다시 저장하세요" 안내를 띄울 수 있게 */
  repaired: boolean;
}

export interface ProposalDocResult {
  doc: ProposalDoc | null;
  /** proposal_docs 표가 아직 없다(마이그레이션 20261015 전) */
  tableMissing: boolean;
}

/** 다른 창(또는 다른 사람)이 먼저 저장했다. currentRev 는 지금 DB 의 rev (모르면 null) */
export class RevConflictError extends Error {
  readonly currentRev: number | null;
  constructor(currentRev: number | null) {
    super("다른 창에서 이 제안서를 먼저 저장했습니다. 새로 불러온 뒤 다시 고쳐 주세요.");
    this.name = "RevConflictError";
    this.currentRev = currentRev;
  }
}

/** 저장하려는 원고·스타일·쪽 구성이 형식에 맞지 않는다 */
export class ProposalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalValidationError";
  }
}

/** 표가 없다 — 마이그레이션 안내로 돌린다 */
export class ProposalTableMissingError extends Error {
  constructor() {
    super("제안서 표(proposal_docs)가 아직 없습니다. DB 셋업에서 마이그레이션을 실행해 주세요.");
    this.name = "ProposalTableMissingError";
  }
}

/**
 * 표 없음 신호. PGRST205 = "Could not find the table … in the schema cache", 42P01 = relation does not exist.
 * 컬럼 없음(42703·PGRST204)도 같은 안내(마이그레이션 필요)로 묶는다.
 */
export function isMissingTableError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  if (code === "PGRST205" || code === "42P01") return true;
  const msg = typeof message === "string" ? message : "";
  if (msg.includes("Could not find the table")) return true;
  return isMissingColumnError(e);
}

const TABLE = "proposal_docs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(r: any): ProposalDoc {
  const parsed = bookContentSchema.safeParse(r.content);
  const org = r.content && typeof r.content === "object" && typeof r.content.org === "string" ? r.content.org : "";
  return {
    id: r.id,
    quoteId: r.quote_id,
    content: parsed.success ? parsed.data : conformContent(r.content, emptyContent(org)),
    style: normalizeStyle(r.style),
    pages: normalizePages(r.pages),
    source: isProposalSource(r.source) ? r.source : "manual",
    rev: Number.isFinite(Number(r.rev)) ? Number(r.rev) : 0,
    updatedBy: r.updated_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    repaired: !parsed.success,
  };
}

function check<T>(schema: z.ZodType<T>, v: unknown, what: string): T {
  const r = schema.safeParse(v);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const where = first?.path?.length ? ` (${first.path.map(String).join(".")})` : "";
  throw new ProposalValidationError(`${what} 형식이 맞지 않습니다${where}: ${first?.message ?? "알 수 없는 오류"}`);
}

function validate(input: { content: unknown; style?: unknown; pages?: unknown }) {
  const content = check<BookContent>(bookContentSchema, input.content, "원고");
  const style = check<BookStyle>(bookStyleSchema, input.style ?? DEFAULT_STYLE, "스타일");
  // 쪽 구성은 빠진 쪽·중복을 고쳐 넣는다(표지·뒤표지 고정) — 거절할 이유가 없는 어긋남이다
  const pages = check<BookPage[]>(bookPagesSchema, normalizePages(input.pages ?? defaultPages()), "쪽 구성");
  return { content, style, pages };
}

/** 리드 하나의 제안서. 없으면 doc=null, 표가 없으면 tableMissing=true (던지지 않는다) */
export async function getProposalDoc(quoteId: string): Promise<ProposalDocResult> {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("quote_id", quoteId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { doc: null, tableMissing: true };
    throw new Error(`제안서를 불러오지 못했습니다: ${error.message}`);
  }
  return { doc: data ? fromRow(data) : null, tableMissing: false };
}

/**
 * 새 제안서. 같은 리드에 이미 있으면(두 창이 동시에 초안을 만든 경우) 새로 넣지 않고 있는 것을 돌려준다
 * — quote_id 가 UNIQUE 라 두 번째 INSERT 는 23505 로 실패한다.
 * created 는 이 호출이 실제로 넣었는지다. 호출한 쪽은 created 일 때만 활동 기록을 남긴다
 * (동시에 만든 두 요청이 "초안 작성"을 타임라인에 두 번 남기던 것을 막는다).
 */
export interface CreateProposalResult {
  doc: ProposalDoc;
  created: boolean;
}

export async function createProposalDoc(
  quoteId: string,
  content: BookContent,
  source: ProposalSource,
  actor: string | null,
  opts: { style?: BookStyle; pages?: BookPage[] } = {}
): Promise<CreateProposalResult> {
  const v = validate({ content, style: opts.style, pages: opts.pages });
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      quote_id: quoteId,
      content: v.content,
      style: v.style,
      pages: v.pages,
      source: isProposalSource(source) ? source : "manual",
      rev: 0,
      updated_by: actor,
    })
    .select("*")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const existing = await getProposalDoc(quoteId);
      if (existing.doc) return { doc: existing.doc, created: false };
    }
    if (isMissingTableError(error)) throw new ProposalTableMissingError();
    throw new Error(`제안서를 만들지 못했습니다: ${error.message}`);
  }
  return { doc: fromRow(data), created: true };
}

async function currentRev(quoteId: string): Promise<number | null | "none"> {
  const { data, error } = await supabaseAdmin.from(TABLE).select("rev").eq("quote_id", quoteId).maybeSingle();
  if (error) return null;
  if (!data) return "none";
  return Number(data.rev);
}

/**
 * 저장 — expectedRev 가 지금 DB 의 rev 와 같을 때만 쓰고 rev 를 1 올린다.
 * 다르면 RevConflictError. 문서가 없으면 일반 Error.
 */
export async function saveProposalDoc(
  quoteId: string,
  input: { content: BookContent; style: BookStyle; pages: BookPage[] },
  expectedRev: number,
  actor: string | null
): Promise<ProposalDoc> {
  const v = validate(input);
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ content: v.content, style: v.style, pages: v.pages, rev: expectedRev + 1, updated_by: actor })
    .eq("quote_id", quoteId)
    .eq("rev", expectedRev)
    .select("*")
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw new ProposalTableMissingError();
    throw new Error(`제안서를 저장하지 못했습니다: ${error.message}`);
  }
  if (data) return fromRow(data);
  const now = await currentRev(quoteId);
  if (now === "none") throw new Error("저장할 제안서가 없습니다. 화면을 새로 고쳐 주세요.");
  throw new RevConflictError(now);
}

/**
 * 원고 갈아 끼우기 — AI 로 다시 쓰기·초안 다시 만들기. 서체·키컬러·쪽 구성은 기본으로 지킨다
 * (resetStyle 이면 그것까지 기본값으로). expectedRev 를 주면 저장과 같은 잠금을 건다.
 */
export async function resetProposalDoc(
  quoteId: string,
  content: BookContent,
  source: ProposalSource,
  actor: string | null,
  opts: { expectedRev?: number; resetStyle?: boolean } = {}
): Promise<ProposalDoc> {
  const cur = await getProposalDoc(quoteId);
  if (cur.tableMissing) throw new ProposalTableMissingError();
  if (!cur.doc) return (await createProposalDoc(quoteId, content, source, actor)).doc;
  if (opts.expectedRev != null && opts.expectedRev !== cur.doc.rev) throw new RevConflictError(cur.doc.rev);
  const v = validate({
    content,
    style: opts.resetStyle ? DEFAULT_STYLE : cur.doc.style,
    pages: opts.resetStyle ? defaultPages() : cur.doc.pages,
  });
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      content: v.content,
      style: v.style,
      pages: v.pages,
      source: isProposalSource(source) ? source : "manual",
      rev: cur.doc.rev + 1,
      updated_by: actor,
    })
    .eq("quote_id", quoteId)
    .eq("rev", cur.doc.rev)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`제안서를 바꾸지 못했습니다: ${error.message}`);
  if (!data) throw new RevConflictError(null);
  return fromRow(data);
}
