"use server";

/**
 * 제안서 편집기 서버 액션 — 저장(자동 저장 포함)·옛 초안으로 다시 채우기·옛 초안으로 시작.
 * 서버 액션은 프록시·레이아웃을 거치지 않고 직접 호출될 수 있으므로 모든 액션의 첫 줄에서
 * 관리자 권한을 다시 확인한다 (outreach/actions.ts 와 같은 규칙).
 *
 * 자동 저장은 2초마다 돌 수 있어 활동 기록을 남기지 않는다. 원고를 통째로 갈아 끼우는
 * 조치(옛 초안으로 다시 채우기·시작)만 리드 타임라인에 남긴다.
 */

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAdminEmail, requireAdmin } from "@/lib/session";
import { addActivity } from "@/lib/lead-activities";
import { isUuid } from "@/lib/estimate-types";
import { quoteFromRow } from "@/lib/quote-types";
import {
  RevConflictError,
  applyGenResult,
  createProposalDoc,
  discardGenResult,
  ensureDocAndRequest,
  getProposalDoc,
  resetProposalDoc,
  saveProposalDoc,
  type ProposalDoc,
} from "@/lib/proposal-docs";
import { isGenMode, type GenMode, type GenStatus } from "@/lib/proposal-book/jobs";
import { buildFallback } from "@/lib/proposal-book/fallback";
import type { BookContent, BookPage, BookStyle } from "@/lib/proposal-book/schema";

export type ProposalActionResult =
  | { ok: true; doc: ProposalDoc }
  | { ok: false; error: string; conflict?: boolean; currentRev?: number | null };

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

function fail(e: unknown): ProposalActionResult {
  if (e instanceof RevConflictError) {
    return { ok: false, error: e.message, conflict: true, currentRev: e.currentRev };
  }
  const msg = errMessage(e);
  console.error("[admin/proposal] action error:", msg);
  return { ok: false, error: msg };
}

function checkId(quoteId: string): void {
  if (!isUuid(quoteId)) throw new Error("리드 번호가 올바르지 않습니다.");
}

async function readLead(quoteId: string) {
  const { data, error } = await supabaseAdmin.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("리드를 찾을 수 없습니다.");
  return quoteFromRow(data);
}

/** 활동 기록 — best-effort. 본 조치는 이미 반영됐으므로 기록 실패로 "실패"를 돌려주지 않는다 */
async function logActivity(quoteId: string, body: string, actor: string | null): Promise<void> {
  try {
    await addActivity({ quoteId, kind: "system", body, actor: actor ?? "" });
  } catch (e) {
    console.error("[admin/proposal] activity log failed:", e);
  }
}

/** 저장 — expectedRev 가 DB 와 다르면 conflict:true (다른 창이 먼저 저장했다) */
export async function saveProposal(
  quoteId: string,
  input: { content: BookContent; style: BookStyle; pages: BookPage[] },
  expectedRev: number
): Promise<ProposalActionResult> {
  try {
    await requireAdmin();
    checkId(quoteId);
    const actor = await getAdminEmail();
    const doc = await saveProposalDoc(quoteId, input, expectedRev, actor);
    // revalidatePath 를 부르지 않는다 — 서버 액션 안의 revalidatePath 는 지금 화면(편집기)을 다시 그리게 해서
    // 2초 자동 저장마다 페이지 전체를 서버에서 새로 받았다. 보드에 보이는 것(문서 유무)은 저장으로 바뀌지 않는다
    return { ok: true, doc };
  } catch (e) {
    return fail(e);
  }
}

/** 원고를 옛 본문으로 만든 초안으로 갈아 끼운다. 서체·키컬러·쪽 구성은 그대로 둔다 */
export async function resetToFallback(quoteId: string, expectedRev: number): Promise<ProposalActionResult> {
  try {
    await requireAdmin();
    checkId(quoteId);
    const actor = await getAdminEmail();
    const lead = await readLead(quoteId);
    const doc = await resetProposalDoc(quoteId, buildFallback(lead), "fallback", actor, { expectedRev });
    await logActivity(quoteId, "제안서 초안 다시 채움", actor);
    revalidatePath("/admin/outreach");
    return { ok: true, doc };
  } catch (e) {
    return fail(e);
  }
}

/** AI 초안이 실패했을 때 — 옛 본문으로 만든 초안으로 새 문서를 만든다(이미 있으면 그것을 돌려준다) */
export async function createFromFallback(quoteId: string): Promise<ProposalActionResult> {
  try {
    await requireAdmin();
    checkId(quoteId);
    const actor = await getAdminEmail();
    const existing = await getProposalDoc(quoteId);
    if (existing.doc) return { ok: true, doc: existing.doc };
    const lead = await readLead(quoteId);
    const { doc, created } = await createProposalDoc(quoteId, buildFallback(lead), "fallback", actor);
    // 다른 창이 먼저 만들었으면(created=false) 그 문서를 돌려줄 뿐 — 타임라인에 두 번 남기지 않는다
    if (created) await logActivity(quoteId, "제안서 초안 만듦 (옛 본문)", actor);
    revalidatePath("/admin/outreach");
    return { ok: true, doc };
  } catch (e) {
    return fail(e);
  }
}

/* ── AI 작성 작업 (맥 작업자) — docs/proposal-editor-plan.md §8 ── */

export type GenStatusResult =
  | {
      ok: true;
      genStatus: GenStatus;
      genMode: GenMode | null;
      genError: string | null;
      hasResult: boolean;
      resultAt: string | null;
      requestedAt: string | null;
      finishedAt: string | null;
      rev: number;
      source: ProposalDoc["source"];
    }
  | { ok: false; error: string };

/** 편집기가 10초마다 묻는 작업 상태 — 원고는 싣지 않는다(가볍게) */
export async function getGenStatus(quoteId: string): Promise<GenStatusResult> {
  try {
    await requireAdmin();
    checkId(quoteId);
    const { doc } = await getProposalDoc(quoteId);
    if (!doc) return { ok: false, error: "제안서가 없습니다." };
    return {
      ok: true,
      genStatus: doc.genStatus,
      genMode: doc.genMode,
      genError: doc.genError,
      hasResult: doc.hasGenResult,
      resultAt: doc.genResultAt,
      requestedAt: doc.genRequestedAt,
      finishedAt: doc.genFinishedAt,
      rev: doc.rev,
      source: doc.source,
    };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

/** 지금 저장본을 다시 읽는다 — 맥 원고가 자동 적용됐을 때 편집기가 불러온다 */
export async function getProposal(quoteId: string): Promise<ProposalActionResult> {
  try {
    await requireAdmin();
    checkId(quoteId);
    const { doc } = await getProposalDoc(quoteId);
    if (!doc) throw new Error("제안서가 없습니다.");
    return { ok: true, doc };
  } catch (e) {
    return fail(e);
  }
}

/** AI 작성 요청 (맥). 문서가 없으면 기존 자료로 먼저 만든다. 이미 요청 중이면 그대로 */
export async function requestAi(quoteId: string, mode: GenMode): Promise<ProposalActionResult> {
  try {
    await requireAdmin();
    checkId(quoteId);
    if (!isGenMode(mode)) throw new Error("요청 종류가 올바르지 않습니다.");
    const actor = await getAdminEmail();
    const lead = await readLead(quoteId);
    const r = await ensureDocAndRequest(quoteId, lead, mode, actor);
    if (r.created) await logActivity(quoteId, "제안서 초안(기존 자료)", actor);
    if (r.requested) await logActivity(quoteId, "제안서 AI 작성 요청 (맥)", actor);
    return { ok: true, doc: r.doc };
  } catch (e) {
    return fail(e);
  }
}

/** 도착한 AI 원고를 적용 — expectedRev 가 DB 와 다르면 conflict:true. 이미지·서체·쪽 구성은 그대로 */
export async function applyAiResult(quoteId: string, expectedRev: number): Promise<ProposalActionResult> {
  try {
    await requireAdmin();
    checkId(quoteId);
    const actor = await getAdminEmail();
    const doc = await applyGenResult(quoteId, expectedRev, actor);
    await logActivity(quoteId, "제안서 AI 원고 적용", actor);
    return { ok: true, doc };
  } catch (e) {
    return fail(e);
  }
}

/** 도착한 AI 원고(또는 실패 표시)를 버린다 */
export async function discardAiResult(quoteId: string): Promise<ProposalActionResult> {
  try {
    await requireAdmin();
    checkId(quoteId);
    const doc = await discardGenResult(quoteId);
    return { ok: true, doc };
  } catch (e) {
    return fail(e);
  }
}
