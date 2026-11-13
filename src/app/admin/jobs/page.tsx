import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAllArtists } from "@/lib/artists";
import { listAssignments } from "@/lib/assignments";
import { isActiveStage, isQuoteStage } from "@/lib/assignment-types";
import { jobBoardReady, listPostings } from "@/lib/job-board";
import { connectionHasCalendar, getConnection } from "@/lib/google-drive";
import { CALENDAR_ACCOUNT } from "@/lib/job-board-types";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";
import JobBoard, { type JobRow } from "@/components/admin/JobBoard";

export const dynamic = "force-dynamic";

/**
 * 작업 공고 — 진행 중 문의마다 견적가·작업비·마감일을 적어 작업자에게 공고하고,
 * 누가 가져갔는지·캘린더·마감 알림 상태를 본다 (docs/job-board-plan.md).
 * 권한은 프록시(/admin/**)와 액션의 requireAdmin() 이 막는다.
 */
export default async function AdminJobsPage() {
  const [quotesRes, ready, postings, artistsRes, assignments, conn, hasCalendar, estimatesRes] = await Promise.all([
    supabaseAdmin
      .from("quotes")
      .select("id, name, product, quantity, delivery_date, rushed, stage, dropped_at, created_at")
      .order("created_at", { ascending: false }),
    jobBoardReady(),
    listPostings(),
    getAllArtists(),
    listAssignments(),
    getConnection(),
    connectionHasCalendar(),
    // 견적가 기본값 — 문의에 연결된 가장 최근 견적서의 공급가액
    supabaseAdmin
      .from("estimates")
      .select("quote_id, supply_amount, created_at")
      .not("quote_id", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  const names = new Map(artistsRes.artists.map((a) => [a.id, a.name]));
  const postingByQuote = new Map(postings.map((p) => [p.quoteId, p]));
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const estimateByQuote = new Map<string, number>();
  for (const e of estimatesRes.data ?? []) {
    if (e.quote_id && !estimateByQuote.has(e.quote_id)) estimateByQuote.set(e.quote_id, Number(e.supply_amount) || 0);
  }

  const rows: JobRow[] = (quotesRes.data ?? [])
    .filter((q) => {
      // 진행 중 문의 + (단계가 바뀌었어도) 가져간 공고가 걸린 문의는 계속 보여 준다 — 회수할 수 있어야 한다
      const p = postingByQuote.get(q.id);
      return (!q.dropped_at && isActiveStage(q.stage)) || p?.status === "claimed";
    })
    .map((q) => {
      const p = postingByQuote.get(q.id) ?? null;
      const a = p?.assignmentId ? assignmentById.get(p.assignmentId) : undefined;
      return {
        quoteId: q.id,
        customer: q.name ?? "",
        product: label(PRODUCT_LABELS, q.product) || q.product || "",
        quantity: q.quantity ?? "",
        deliveryDate: q.rushed ? "최대한 빠르게" : q.delivery_date ?? "",
        createdAt: q.created_at,
        stage: isQuoteStage(q.stage) ? q.stage : "new",
        dropped: !!q.dropped_at,
        estimateSupply: estimateByQuote.get(q.id) ?? null,
        posting: p,
        claimedByName: p?.claimedBy ? names.get(p.claimedBy) ?? p.claimedBy : null,
        assignmentStatus: a?.status ?? null,
        assignmentProgress: a?.progress ?? null,
      };
    });

  const calendarWarning = !conn
    ? `구글이 연결되지 않아 캘린더에 기록할 수 없습니다. 견적서 화면에서 ${CALENDAR_ACCOUNT} 로 연결하세요.`
    : !hasCalendar
      ? `구글 연결(${conn.email})에 캘린더 권한이 없습니다. 견적서 화면에서 ${CALENDAR_ACCOUNT} 로 다시 연결하고 캘린더 항목을 체크하세요.`
      : conn.email.toLowerCase() !== CALENDAR_ACCOUNT
        ? `캘린더가 ${conn.email} 계정에 기록됩니다. ${CALENDAR_ACCOUNT} 에 기록하려면 그 계정으로 다시 연결하세요.`
        : null;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">작업 공고</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          작업비와 마감일을 적어 올리면 작업자가 포털에서 보고 먼저 가져간 사람이 맡습니다. 고객 정보와 견적가는 작업자에게 보이지 않습니다.
        </p>
      </div>

      {!ready && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          작업 공고 표가 없습니다. Supabase SQL Editor 에서 <code>supabase/migrations/20261113_job_board.sql</code> 을 실행하세요.
        </div>
      )}
      {quotesRes.error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          DB 오류: {quotesRes.error.message}
        </div>
      )}
      {calendarWarning && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{calendarWarning}</div>
      )}

      <JobBoard rows={rows} ready={ready} />
    </div>
  );
}
