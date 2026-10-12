import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { quoteFromRow } from "@/lib/quote-types";
import { DONE_STAGES, type AssignmentView } from "@/lib/assignment-types";
import { listAssignmentViews } from "@/lib/assignments";
import { completedAtOf, summarizeQuoteBilling } from "@/lib/completed";
import CompletedList, { type CompletedRow } from "@/components/admin/CompletedList";

export const dynamic = "force-dynamic";

/** 아직 없는 컬럼을 정렬·조회에 썼다는 신호 — 마이그레이션 20261013 전에는 closed_at 이 없다 */
function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

/** 완료 단계(납품·정산) 리드 — 완료일 최신순. 마이그레이션 전에는 접수일 순으로 폴백 */
async function loadDoneQuotes() {
  const base = () =>
    supabaseAdmin
      .from("quotes")
      .select("*")
      .is("dropped_at", null)
      .in("stage", [...DONE_STAGES]);

  const first = await base()
    .order("closed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (!isMissingColumn(first.error)) return first;
  return base().order("created_at", { ascending: false });
}

export default async function AdminCompletedPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  // 리드와 배정을 병렬로 — 배정은 리드별 매출·수금 합계에 쓴다(테이블 없으면 빈 배열)
  const [quotesRes, views] = await Promise.all([loadDoneQuotes(), listAssignmentViews()]);
  const { data, error } = quotesRes;

  const byQuote = new Map<string, AssignmentView[]>();
  for (const v of views) {
    const list = byQuote.get(v.quoteId);
    if (list) list.push(v);
    else byQuote.set(v.quoteId, [v]);
  }

  const rows: CompletedRow[] = (error ? [] : (data ?? []))
    .map(quoteFromRow)
    .map((q) => ({
      id: q.id,
      name: q.name,
      org: q.org,
      product: q.product,
      stage: q.stage,
      completedAt: completedAtOf(q),
      billing: summarizeQuoteBilling(byQuote.get(q.id) ?? []),
    }));

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">완료 프로젝트</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          납품·정산이 끝난 건입니다. 잘못 옮긴 건은 제작중으로 되돌릴 수 있습니다.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          DB 오류: {(error as { message?: string }).message ?? String(error)}
        </div>
      )}

      <CompletedList rows={rows} />
    </div>
  );
}
