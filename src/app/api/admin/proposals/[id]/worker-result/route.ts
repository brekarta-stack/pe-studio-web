import { NextResponse } from "next/server";
import { workerTokenMatches } from "@/lib/worker-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { quoteFromRow } from "@/lib/quote-types";
import { isUuid } from "@/lib/estimate-types";
import { addActivity } from "@/lib/lead-activities";
import {
  applyGenResult,
  getProposalDoc,
  isMissingTableError,
  ProposalJobsMissingError,
  RevConflictError,
  storeWorkerError,
  storeWorkerResult,
} from "@/lib/proposal-docs";
import { postProcessWorkerContent } from "@/lib/proposal-book/generate";
import { clipGenError, shouldAutoApply } from "@/lib/proposal-book/jobs";

/**
 * POST /api/admin/proposals/[id]/worker-result — 맥 작업자가 쓴 원고(또는 실패)를 돌려준다. docs/proposal-editor-plan.md §8
 *
 * 인증: 작업자 토큰만.
 * body { ok: true, content } | { ok: false, error }
 *  - 작업이 running 이 아니면 409 (늦게 온 결과가 새 요청·적용을 덮지 않게).
 *  - content 는 후처리(postProcessWorkerContent: 분량·견적 빈칸·출처 http(s)·수신 메일=리드 메일) 뒤 gen_result 로 보관(done).
 *    처음 여는 문서(mode create)이고 요청 이후 아무도 저장하지 않았으면(rev 그대로) 바로 적용한다(이미지 유지).
 *  - 후처리에 실패하면(형식이 아예 안 맞음) failed 로 기록하고 422.
 *
 * 200 { ok: true, applied: boolean, status: "done" | "idle" | "failed" }
 * 400 잘못된 id/body · 401 · 404 리드·문서 없음 · 409 running 아님 · 422 원고 형식 오류 · 503 컬럼 없음 · 500
 */

export const dynamic = "force-dynamic";

const ACTOR = "mac-worker";

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function logActivity(quoteId: string, body: string) {
  try {
    await addActivity({ quoteId, kind: "system", body, actor: ACTOR });
  } catch {
    // 활동 기록은 덤이다
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!workerTokenMatches(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return fail("잘못된 id 입니다.", 400);

  let body: { ok?: unknown; content?: unknown; error?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return fail("요청 본문(JSON)을 읽지 못했습니다.", 400);
  }
  if (body.ok !== true && body.ok !== false) return fail("ok 는 true 또는 false 여야 합니다.", 400);
  if (body.ok === true && (!body.content || typeof body.content !== "object")) return fail("content 가 필요합니다.", 400);

  try {
    const { data: row, error } = await supabaseAdmin.from("quotes").select("*").eq("id", id).maybeSingle();
    if (error) return fail(`리드를 불러오지 못했습니다: ${error.message}`, 500);
    if (!row) return fail("리드를 찾지 못했습니다.", 404);
    const lead = quoteFromRow(row);

    const cur = await getProposalDoc(id);
    if (cur.tableMissing) return fail("제안서 표(proposal_docs)가 아직 없습니다.", 503);
    if (!cur.doc) return fail("제안서가 없습니다.", 404);
    if (cur.doc.genStatus !== "running") {
      return fail(`이 작업은 진행 중이 아닙니다 (상태: ${cur.doc.genStatus}). 결과를 버립니다.`, 409);
    }

    if (body.ok === false) {
      const reason = clipGenError(body.error);
      const doc = await storeWorkerError(id, reason);
      if (!doc) return fail("이 작업은 진행 중이 아닙니다.", 409);
      await logActivity(id, `제안서 AI 작성 실패: ${reason}`);
      return NextResponse.json({ ok: true, applied: false, status: "failed" });
    }

    let content;
    try {
      content = postProcessWorkerContent(body.content, lead);
    } catch (e) {
      const reason = clipGenError(`원고 형식이 맞지 않습니다 — ${e instanceof Error ? e.message : String(e)}`);
      await storeWorkerError(id, reason);
      await logActivity(id, `제안서 AI 작성 실패: ${reason}`);
      return fail(reason, 422);
    }

    const stored = await storeWorkerResult(id, content);
    if (!stored) return fail("이 작업은 진행 중이 아닙니다.", 409);

    let applied = false;
    if (shouldAutoApply({ mode: stored.genMode, rev: stored.rev, requestedRev: stored.genRequestedRev })) {
      try {
        await applyGenResult(id, stored.genRequestedRev, ACTOR);
        applied = true;
      } catch (e) {
        // 그 사이 사람이 저장했다 — 편집기에서 "적용하기"로 고르게 둔다
        if (!(e instanceof RevConflictError)) throw e;
      }
    }
    await logActivity(id, applied ? "제안서 AI 원고 도착 (맥) · 자동 적용" : "제안서 AI 원고 도착 (맥)");
    return NextResponse.json({ ok: true, applied, status: applied ? "idle" : "done" });
  } catch (e) {
    if (e instanceof ProposalJobsMissingError || isMissingTableError(e)) {
      return fail(new ProposalJobsMissingError().message, 503);
    }
    return fail(clipGenError(e), 500);
  }
}
