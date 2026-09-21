import { NextResponse } from "next/server";
import { getAdminEmail } from "@/lib/session";
import { getEstimate, logEstimateEvent } from "@/lib/estimates";
import { exportSheetPdf } from "@/lib/google-drive";
import { buildFileName, isUuid } from "@/lib/estimate-types";

/**
 * GET /api/admin/estimates/[id]/pdf — 발송될 PDF 미리보기.
 * 발송 때와 똑같은 함수로 시트에서 뽑는다. 확인 단계에서 사람이 보는 것이 곧 고객이 받는 것이다.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getAdminEmail();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });

  try {
    const est = await getEstimate(id);
    if (!est?.sheetId) return NextResponse.json({ error: "시트가 없는 견적서입니다." }, { status: 404 });
    const pdf = await exportSheetPdf(est.sheetId, est.sheetGid);
    // 고객 정보가 담긴 문서를 내려받는 일이라 기록을 남긴다
    await logEstimateEvent({ estimateId: id, docNumber: est.docNumber, action: "pdf_viewed", actor });
    const name = `${buildFileName(est)}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="estimate.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
