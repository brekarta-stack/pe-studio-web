import { NextResponse } from "next/server";
import { getAdminEmail, requireAdminApi } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { quoteFromRow } from "@/lib/quote-types";
import { isUuid } from "@/lib/estimate-types";
import { addActivity } from "@/lib/lead-activities";
import {
  createProposalDoc,
  getProposalDoc,
  isMissingTableError,
  ProposalTableMissingError,
  resetProposalDoc,
  RevConflictError,
  type ProposalDoc,
} from "@/lib/proposal-docs";
import { buildFallback } from "@/lib/proposal-book/fallback";
import { describeGenerateError, generateDraft } from "@/lib/proposal-book/generate";
import { type BookContent, type ImageValue } from "@/lib/proposal-book/schema";

/**
 * POST /api/admin/proposals/[id]/generate — 제안서 AI 초안 (id = quotes.id)
 *
 * body { mode: "create" | "regenerate", keepImages?: boolean, expectedRev?: number }
 *  - create: 문서가 있으면 그대로 돌려준다. 없으면 AI 초안 → 실패하면 옛 본문으로 채운 대체 원고.
 *  - regenerate: 있는 문서의 원고만 AI 로 갈아 끼운다(서체·쪽 구성 유지). AI 가 실패하면 덮어쓰지 않는다.
 *
 * 응답 { ok: true, doc, source, notice? } | { ok: false, error }  — 편집기 화면이 이 모양에 기댄다.
 */

// AI 호출 90초 + DB 왕복 — 기본 함수 시간 한도보다 길다
export const maxDuration = 120;
export const runtime = "nodejs";

const TABLE_MISSING_MSG =
  "제안서 표(proposal_docs)가 아직 없습니다. /admin/setup 에서 마이그레이션을 실행해 주세요.";

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function ok(doc: ProposalDoc, notice?: string) {
  return NextResponse.json({ ok: true, doc, source: doc.source, ...(notice ? { notice } : {}) });
}

async function logActivity(quoteId: string, body: string, actor: string) {
  try {
    await addActivity({ quoteId, kind: "system", body, actor });
  } catch {
    // 활동 기록은 덤이다 — 표가 없거나 실패해도 초안 응답은 나간다
  }
}

function hasImage(v: ImageValue | undefined): boolean {
  if (!v) return false;
  return typeof v === "string" ? v.trim() !== "" : (v.url ?? "").trim() !== "";
}

/** 새 원고에 옛 원고의 이미지(비어 있지 않은 것만)를 옮긴다 — 같은 자리(인덱스)끼리 */
function carryImages(next: BookContent, prev: BookContent): BookContent {
  const out: BookContent = {
    ...next,
    designs: { ...next.designs, items: next.designs.items.map((x) => ({ ...x })) },
    scenes: { ...next.scenes },
    cases: { ...next.cases, items: next.cases.items.map((x) => ({ ...x })) },
  };
  if (hasImage(prev.cover)) out.cover = prev.cover;
  if (hasImage(prev.scenes.image)) out.scenes.image = prev.scenes.image;
  out.designs.items.forEach((it, i) => {
    const old = prev.designs.items[i]?.image;
    if (hasImage(old)) it.image = old;
  });
  out.cases.items.forEach((it, i) => {
    const old = prev.cases.items[i]?.image;
    if (hasImage(old)) it.image = old;
  });
  return out;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const actor = (await getAdminEmail()) ?? "admin";

  const { id } = await ctx.params;
  if (!isUuid(id)) return fail("잘못된 id 입니다.", 400);

  let body: { mode?: unknown; keepImages?: unknown; expectedRev?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return fail("요청 본문(JSON)을 읽지 못했습니다.", 400);
  }
  const mode = body.mode;
  if (mode !== "create" && mode !== "regenerate") return fail('mode 는 "create" 또는 "regenerate" 여야 합니다.', 400);
  const keepImages = body.keepImages === true;
  const expectedRev =
    typeof body.expectedRev === "number" && Number.isInteger(body.expectedRev) ? body.expectedRev : undefined;

  try {
    const { data: row, error: qErr } = await supabaseAdmin.from("quotes").select("*").eq("id", id).maybeSingle();
    if (qErr) return fail(`리드를 불러오지 못했습니다: ${qErr.message}`, 500);
    if (!row) return fail("리드를 찾지 못했습니다.", 404);
    const lead = quoteFromRow(row);

    const cur = await getProposalDoc(id);
    if (cur.tableMissing) return fail(TABLE_MISSING_MSG, 503);

    if (mode === "create") {
      if (cur.doc) return ok(cur.doc);
      let content: BookContent | null = null;
      let reason = "";
      try {
        content = (await generateDraft(lead)).content;
      } catch (e) {
        reason = describeGenerateError(e);
        console.error("[proposals/generate] AI 초안 실패 → 대체 원고", e);
      }
      if (content) {
        const doc = await createProposalDoc(id, content, "ai", actor);
        await logActivity(id, "제안서 AI 초안 작성", actor);
        return ok(doc);
      }
      const doc = await createProposalDoc(id, buildFallback(lead), "fallback", actor);
      await logActivity(id, "제안서 초안(기존 자료)", actor);
      return ok(doc, `AI 초안을 만들지 못해 기존 자료로 채웠습니다 — ${reason}`);
    }

    // regenerate
    if (!cur.doc) return fail("다시 쓸 제안서가 없습니다. 먼저 제안서를 여세요.", 404);
    if (expectedRev != null && expectedRev !== cur.doc.rev) {
      return fail(new RevConflictError(cur.doc.rev).message, 409);
    }
    let content: BookContent;
    try {
      content = (await generateDraft(lead)).content;
    } catch (e) {
      console.error("[proposals/generate] AI 다시 쓰기 실패", e);
      return fail(describeGenerateError(e), 502);
    }
    if (keepImages) content = carryImages(content, cur.doc.content);
    const doc = await resetProposalDoc(id, content, "ai", actor, { expectedRev });
    await logActivity(id, "제안서 AI로 다시 씀", actor);
    return ok(doc);
  } catch (e) {
    if (e instanceof ProposalTableMissingError || isMissingTableError(e)) return fail(TABLE_MISSING_MSG, 503);
    if (e instanceof RevConflictError) return fail(e.message, 409);
    const msg = e instanceof Error ? e.message : String(e);
    return fail(msg, 500);
  }
}
