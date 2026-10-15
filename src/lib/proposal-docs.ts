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
import { carryImages } from "./proposal-book/editor-ops";
import { buildFallback, type FallbackLead } from "./proposal-book/fallback";
import {
  GEN_STALE_MS,
  GEN_TIMEOUT_ERROR,
  clipGenError,
  isGenActive,
  isGenMode,
  normalizeGenStatus,
  staleDecision,
  type GenMode,
  type GenStatus,
} from "./proposal-book/jobs";

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
  /* ── AI 작성 작업 (맥 작업자, 마이그레이션 20261016). 컬럼이 없으면 idle·null ── */
  genStatus: GenStatus;
  genMode: GenMode | null;
  genRequestedAt: string | null;
  genStartedAt: string | null;
  genFinishedAt: string | null;
  /** 요청할 때의 rev — 결과가 왔을 때 그대로면 아무도 안 고친 것 */
  genRequestedRev: number | null;
  genAttempts: number;
  genError: string | null;
  /** 도착해서 적용을 기다리는 원고가 있다 (원고 자체는 클라이언트에 싣지 않는다 — applyGenResult 가 읽는다) */
  hasGenResult: boolean;
  genResultAt: string | null;
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
    genStatus: normalizeGenStatus(r.gen_status),
    genMode: isGenMode(r.gen_mode) ? r.gen_mode : null,
    genRequestedAt: r.gen_requested_at ?? null,
    genStartedAt: r.gen_started_at ?? null,
    genFinishedAt: r.gen_finished_at ?? null,
    genRequestedRev: r.gen_requested_rev == null || !Number.isFinite(Number(r.gen_requested_rev)) ? null : Number(r.gen_requested_rev),
    genAttempts: Number.isFinite(Number(r.gen_attempts)) ? Number(r.gen_attempts) : 0,
    genError: typeof r.gen_error === "string" ? r.gen_error : null,
    hasGenResult: r.gen_result != null && typeof r.gen_result === "object",
    genResultAt: r.gen_result_at ?? null,
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

/* ── AI 작성 작업 (맥 작업자) — docs/proposal-editor-plan.md §8 ─────────────────────
 * 상태: idle → requested(요청) → running(작업자가 잡아 감) → done(결과 보관) | failed
 *       done 은 적용하면(applyGenResult) 원고가 바뀌고 idle, 버리면(discardGenResult) idle.
 * 작업 상태는 rev 를 건드리지 않는다 — 편집기의 자동 저장 잠금과 서로 간섭하지 않게.
 * 모든 전이는 "WHERE gen_status = 기대값" 조건부 UPDATE 다(작업자 두 대·두 창이 동시에 눌러도 한 번만). */

/** 작업 컬럼이 없다(마이그레이션 20261016 전) */
export class ProposalJobsMissingError extends Error {
  constructor() {
    super("AI 작성 작업 컬럼이 아직 없습니다. /admin/setup 에서 마이그레이션(20261016_proposal_jobs)을 실행해 주세요.");
    this.name = "ProposalJobsMissingError";
  }
}

function jobsError(error: unknown, what: string): Error {
  if (isMissingTableError(error)) return new ProposalJobsMissingError();
  const msg = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
  return new Error(`${what}: ${msg}`);
}

export interface RequestGenerationResult {
  doc: ProposalDoc;
  /** 이 호출이 실제로 요청 상태로 바꿨다 (이미 requested/running 이었으면 false) */
  requested: boolean;
}

/**
 * AI 작성 요청. 이미 requested/running 이면 아무것도 하지 않는다.
 * 도착해서 기다리던 결과(done)·실패 이유(failed)는 새 요청이 지운다.
 */
export async function requestGeneration(quoteId: string, mode: GenMode, actor: string | null): Promise<RequestGenerationResult> {
  void actor; // 요청자는 활동 기록(호출한 쪽)에 남긴다 — updated_by 는 원고를 바꾼 사람 칸이라 건드리지 않는다
  const cur = await getProposalDoc(quoteId);
  if (cur.tableMissing) throw new ProposalTableMissingError();
  if (!cur.doc) throw new Error("요청할 제안서가 없습니다. 먼저 제안서를 여세요.");
  if (isGenActive(cur.doc.genStatus)) return { doc: cur.doc, requested: false };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      gen_status: "requested",
      gen_mode: mode,
      gen_requested_at: new Date().toISOString(),
      gen_requested_rev: cur.doc.rev,
      gen_started_at: null,
      gen_finished_at: null,
      gen_attempts: 0,
      gen_error: null,
      gen_result: null,
      gen_result_at: null,
    })
    .eq("quote_id", quoteId)
    .not("gen_status", "in", "(requested,running)")
    .select("*")
    .maybeSingle();
  if (error) throw jobsError(error, "AI 작성을 요청하지 못했습니다");
  if (data) return { doc: fromRow(data), requested: true };
  // 그 사이 다른 요청이 먼저 바꿨다 — 그 상태를 돌려준다
  const again = await getProposalDoc(quoteId);
  if (!again.doc) throw new Error("요청할 제안서가 없습니다.");
  return { doc: again.doc, requested: false };
}

/** 20분 넘은 running — 시도 한도 안이면 다시 줄 세우고, 넘었으면 failed("시간 초과") */
async function reapStaleJobs(now = Date.now()): Promise<void> {
  const cutoff = new Date(now - GEN_STALE_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, gen_started_at, gen_attempts")
    .eq("gen_status", "running")
    .or(`gen_started_at.is.null,gen_started_at.lt.${cutoff}`)
    .limit(20);
  if (error) throw jobsError(error, "작업 상태를 읽지 못했습니다");
  for (const r of data ?? []) {
    const decision = staleDecision({ startedAt: r.gen_started_at ?? null, attempts: Number(r.gen_attempts) || 0 }, now);
    if (!decision) continue;
    const patch =
      decision === "requeue"
        ? { gen_status: "requested", gen_started_at: null }
        : { gen_status: "failed", gen_error: GEN_TIMEOUT_ERROR, gen_finished_at: new Date(now).toISOString() };
    // 조건부 — 그 사이 결과가 도착했으면(running 이 아니면) 건드리지 않는다
    const { error: upErr } = await supabaseAdmin.from(TABLE).update(patch).eq("id", r.id).eq("gen_status", "running");
    if (upErr) throw jobsError(upErr, "오래된 작업을 정리하지 못했습니다");
  }
}

/**
 * 작업자가 다음 작업 하나를 잡는다 — 가장 오래된 requested 를 running 으로.
 * 고른 뒤 "WHERE id = ? AND gen_status = 'requested'" 로 바꾸므로 작업자 둘이 같은 것을 잡지 못한다.
 * 진 쪽은 다음 후보로 몇 번 더 시도한다. 없으면 null.
 */
export async function claimNextJob(): Promise<ProposalDoc | null> {
  await reapStaleJobs();
  for (let i = 0; i < 5; i++) {
    const { data: cand, error } = await supabaseAdmin
      .from(TABLE)
      .select("id, gen_attempts")
      .eq("gen_status", "requested")
      .order("gen_requested_at", { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();
    if (error) throw jobsError(error, "작업을 고르지 못했습니다");
    if (!cand) return null;
    const attempts = Number(cand.gen_attempts) || 0;
    const { data, error: upErr } = await supabaseAdmin
      .from(TABLE)
      .update({ gen_status: "running", gen_started_at: new Date().toISOString(), gen_attempts: attempts + 1 })
      .eq("id", cand.id)
      .eq("gen_status", "requested")
      .select("*")
      .maybeSingle();
    if (upErr) throw jobsError(upErr, "작업을 잡지 못했습니다");
    if (data) return fromRow(data);
  }
  return null;
}

/** 작업자 결과 보관 — running 일 때만. 아니면 null (늦게 온 결과가 새 요청·적용을 덮지 않게) */
export async function storeWorkerResult(quoteId: string, content: BookContent): Promise<ProposalDoc | null> {
  const v = check<BookContent>(bookContentSchema, content, "AI 원고");
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ gen_status: "done", gen_result: v, gen_result_at: now, gen_finished_at: now, gen_error: null })
    .eq("quote_id", quoteId)
    .eq("gen_status", "running")
    .select("*")
    .maybeSingle();
  if (error) throw jobsError(error, "AI 원고를 보관하지 못했습니다");
  return data ? fromRow(data) : null;
}

/** 작업자 실패 기록 — running 일 때만. 아니면 null */
export async function storeWorkerError(quoteId: string, message: unknown): Promise<ProposalDoc | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      gen_status: "failed",
      gen_error: clipGenError(message),
      gen_finished_at: new Date().toISOString(),
      gen_result: null,
      gen_result_at: null,
    })
    .eq("quote_id", quoteId)
    .eq("gen_status", "running")
    .select("*")
    .maybeSingle();
  if (error) throw jobsError(error, "실패를 기록하지 못했습니다");
  return data ? fromRow(data) : null;
}

/**
 * 도착한 AI 원고를 적용 — 원고만 갈아 끼우고(지금 문서의 이미지는 옮긴다) 서체·쪽 구성은 둔다.
 * source 'ai', rev +1, 작업 상태는 idle 로. expectedRev 가 지금 rev 와 다르면 RevConflictError.
 */
export async function applyGenResult(quoteId: string, expectedRev: number | null, actor: string | null): Promise<ProposalDoc> {
  const { data: row, error } = await supabaseAdmin.from(TABLE).select("*").eq("quote_id", quoteId).maybeSingle();
  if (error) throw jobsError(error, "제안서를 불러오지 못했습니다");
  if (!row) throw new Error("제안서가 없습니다.");
  const cur = fromRow(row);
  if (cur.genStatus !== "done" || !row.gen_result) throw new Error("적용할 AI 원고가 없습니다. 이미 적용했거나 버렸을 수 있습니다.");
  if (expectedRev != null && expectedRev !== cur.rev) throw new RevConflictError(cur.rev);
  const incoming = check<BookContent>(bookContentSchema, row.gen_result, "AI 원고");
  const v = validate({ content: carryImages(incoming, cur.content), style: cur.style, pages: cur.pages });
  const { data, error: upErr } = await supabaseAdmin
    .from(TABLE)
    .update({
      content: v.content,
      source: "ai",
      rev: cur.rev + 1,
      updated_by: actor,
      gen_status: "idle",
      gen_result: null,
      gen_result_at: null,
      gen_error: null,
    })
    .eq("quote_id", quoteId)
    .eq("rev", cur.rev)
    .eq("gen_status", "done")
    .select("*")
    .maybeSingle();
  if (upErr) throw jobsError(upErr, "AI 원고를 적용하지 못했습니다");
  if (data) return fromRow(data);
  const now = await currentRev(quoteId);
  throw new RevConflictError(typeof now === "number" ? now : null);
}

/** 도착한 원고·실패 표시를 지운다(idle). 요청 중(requested/running)이면 그대로 둔다 */
export async function discardGenResult(quoteId: string): Promise<ProposalDoc> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ gen_status: "idle", gen_result: null, gen_result_at: null, gen_error: null })
    .eq("quote_id", quoteId)
    .in("gen_status", ["done", "failed"])
    .select("*")
    .maybeSingle();
  if (error) throw jobsError(error, "AI 원고를 버리지 못했습니다");
  if (data) return fromRow(data);
  const cur = await getProposalDoc(quoteId);
  if (!cur.doc) throw new Error("제안서가 없습니다.");
  return cur.doc;
}

export interface EnsureAndRequestResult extends RequestGenerationResult {
  /** 문서가 없어 이 호출이 기존 자료(옛 본문)로 새로 만들었다 */
  created: boolean;
}

/**
 * 문서가 없으면 기존 자료로 만든 초안(source "fallback")을 먼저 넣고, AI 작성을 요청한다.
 * 편집기는 그 초안으로 바로 열리고, 맥 작업자의 원고는 나중에 도착한다.
 */
export async function ensureDocAndRequest(
  quoteId: string,
  lead: FallbackLead,
  mode: GenMode,
  actor: string | null
): Promise<EnsureAndRequestResult> {
  const cur = await getProposalDoc(quoteId);
  if (cur.tableMissing) throw new ProposalTableMissingError();
  let created = false;
  if (!cur.doc) created = (await createProposalDoc(quoteId, buildFallback(lead), "fallback", actor)).created;
  const r = await requestGeneration(quoteId, mode, actor);
  return { ...r, created };
}
