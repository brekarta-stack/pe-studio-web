import { NextResponse } from "next/server";
import { workerTokenMatches } from "@/lib/worker-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { quoteFromRow } from "@/lib/quote-types";
import {
  claimNextJob,
  isMissingTableError,
  ProposalJobsMissingError,
  storeWorkerError,
} from "@/lib/proposal-docs";

/**
 * GET /api/admin/proposals/jobs/next — 맥 작업자가 다음 AI 작성 작업 하나를 잡는다. docs/proposal-editor-plan.md §8
 *
 * 인증: 작업자 토큰만 (x-intake-token / Bearer = OUTREACH_INTAKE_TOKEN). 관리자 세션으로는 잡지 않는다 —
 * 브라우저에서 열어 보기만 해도 작업이 running 으로 넘어가 버리기 때문이다.
 *
 * 204 (본문 없음) — 할 일 없음
 * 200 { job: { quoteId, mode, requestedAt, lead: {org,segment,score,name,email,phone,notes,outreach}, current } }
 *     잡는 순간 requested → running (원자적). running 이 20분 넘으면 다시 줄 세움(2회까지), 넘으면 failed.
 * 401 · 503 컬럼 없음 · 500
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!workerTokenMatches(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // 리드가 사라진 작업(드묾 — FK CASCADE 라 보통 문서도 함께 지워진다)은 실패로 닫고 다음 것을 본다
    for (let i = 0; i < 3; i++) {
      const doc = await claimNextJob();
      if (!doc) return new NextResponse(null, { status: 204 });
      const { data: row, error } = await supabaseAdmin.from("quotes").select("*").eq("id", doc.quoteId).maybeSingle();
      if (error) throw error;
      if (!row) {
        await storeWorkerError(doc.quoteId, "리드를 찾지 못했습니다.");
        continue;
      }
      const lead = quoteFromRow(row);
      return NextResponse.json({
        job: {
          quoteId: doc.quoteId,
          mode: doc.genMode ?? "regenerate",
          requestedAt: doc.genRequestedAt,
          lead: {
            org: lead.org || lead.name || "",
            segment: lead.segment ?? "",
            score: lead.score ?? null,
            name: lead.name ?? "",
            email: lead.email ?? "",
            phone: lead.phone ?? "",
            notes: lead.notes ?? "",
            outreach: lead.outreach ?? null,
          },
          current: doc.content,
        },
      });
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof ProposalJobsMissingError || isMissingTableError(e)) {
      return NextResponse.json({ error: new ProposalJobsMissingError().message }, { status: 503 });
    }
    const msg = e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
