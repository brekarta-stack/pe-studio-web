import { NextResponse } from "next/server";
import { getAdminEmail, requireAdminApi } from "@/lib/session";
import { workerTokenMatches } from "@/lib/worker-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { quoteFromRow } from "@/lib/quote-types";
import { isUuid } from "@/lib/estimate-types";
import { addActivity } from "@/lib/lead-activities";
import {
  ensureDocAndRequest,
  isMissingTableError,
  ProposalJobsMissingError,
  ProposalTableMissingError,
} from "@/lib/proposal-docs";
import { isGenMode } from "@/lib/proposal-book/jobs";

/**
 * POST /api/admin/proposals/[id]/request — 제안서 AI 작성 요청 (id = quotes.id). docs/proposal-editor-plan.md §8
 *
 * 인증: 작업자 토큰(x-intake-token / Bearer = OUTREACH_INTAKE_TOKEN) 또는 관리자 세션.
 * body { mode: "create" | "regenerate" }
 *  - 문서가 없으면 기존 자료(옛 본문)로 초안을 만들고(source "fallback") 요청 상태로 둔다.
 *  - 이미 requested/running 이면 그대로 둔다.
 *
 * 200 { ok: true, doc, requested } · 400 잘못된 id/body · 401 · 404 리드 없음 · 503 표·컬럼 없음 · 500
 */

export const dynamic = "force-dynamic";

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const byWorker = workerTokenMatches(req);
  if (!byWorker) {
    const guard = await requireAdminApi();
    if (guard) return guard;
  }
  const actor = byWorker ? "mac-worker" : ((await getAdminEmail()) ?? "admin");

  const { id } = await ctx.params;
  if (!isUuid(id)) return fail("잘못된 id 입니다.", 400);

  let body: { mode?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return fail("요청 본문(JSON)을 읽지 못했습니다.", 400);
  }
  if (!isGenMode(body.mode)) return fail('mode 는 "create" 또는 "regenerate" 여야 합니다.', 400);

  try {
    const { data: row, error } = await supabaseAdmin.from("quotes").select("*").eq("id", id).maybeSingle();
    if (error) return fail(`리드를 불러오지 못했습니다: ${error.message}`, 500);
    if (!row) return fail("리드를 찾지 못했습니다.", 404);
    const r = await ensureDocAndRequest(id, quoteFromRow(row), body.mode, actor);
    if (r.requested) {
      try {
        await addActivity({ quoteId: id, kind: "system", body: "제안서 AI 작성 요청 (맥)", actor });
      } catch {
        // 활동 기록은 덤이다
      }
    }
    return NextResponse.json({ ok: true, doc: r.doc, requested: r.requested });
  } catch (e) {
    if (e instanceof ProposalJobsMissingError) return fail(e.message, 503);
    if (e instanceof ProposalTableMissingError || isMissingTableError(e)) {
      return fail("제안서 표(proposal_docs)가 아직 없습니다. /admin/setup 에서 마이그레이션을 실행해 주세요.", 503);
    }
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
