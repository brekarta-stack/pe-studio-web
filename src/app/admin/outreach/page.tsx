import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { quoteFromRow, type QuoteSubmission } from "@/lib/quote-types";
import { OUTREACH_STAGES } from "@/lib/assignment-types";
import { listActivitiesForQuotes, type LeadActivity } from "@/lib/lead-activities";
import { isMissingColumnError } from "@/lib/outreach";
import OutreachBoard from "@/components/admin/OutreachBoard";

export const dynamic = "force-dynamic";

/**
 * 제안 영업 — 내가 먼저 보내는 제안(아웃바운드)의 진행판.
 * 보드 소속은 source 가 아니라 단계 그룹이 정한다: 전환된 리드는 source='outbound' 그대로
 * 상담중으로 넘어가 제작 문의에 나타나고, 여기서는 빠진다 (docs/sales-pipeline-plan.md §2).
 */
export default async function AdminOutreachPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  /* next_action_at 정렬은 20261013 마이그레이션 컬럼에 기대므로, 컬럼이 없으면
     이 쿼리가 42703/PGRST204 로 실패한다 — 그걸 "마이그레이션 전" 신호로 쓴다 */
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("*")
    .is("dropped_at", null)
    .in("stage", [...OUTREACH_STAGES])
    .order("next_action_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error && isMissingColumnError(error)) {
    return (
      <div className="mx-auto max-w-3xl p-6 md:p-8">
        <h1 className="text-2xl font-bold text-slate-900">제안 영업</h1>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-bold text-amber-800">영업 파이프라인 마이그레이션이 아직 적용되지 않았습니다.</p>
          <p className="mt-1 text-sm text-amber-700">
            제안 영업 리드를 담을 컬럼과 활동 기록 표를 먼저 만들어야 합니다.
          </p>
          <Link
            href="/admin/setup"
            className="mt-4 inline-block rounded-xl px-4 py-2.5 text-sm font-bold text-white"
            style={{ background: "#1E22B2" }}
          >
            DB 셋업으로 이동 →
          </Link>
        </div>
      </div>
    );
  }

  const rows: QuoteSubmission[] = error ? [] : (data ?? []).map(quoteFromRow);
  // 활동 표가 없으면 빈 기록으로 폴백한다 (lead-activities.ts) — 보드는 그대로 뜬다
  const activities = await listActivitiesForQuotes(rows.map((r) => r.id)).catch((e) => {
    // 타임라인은 보조 정보 — 읽기 실패(사용량 차단 등)로 목록 전체가 죽지 않게 빈 기록으로 둔다
    console.error("[admin] activities load failed:", e);
    return {} as Record<string, LeadActivity[]>;
  });

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">제안 영업</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          내가 먼저 보내는 제안의 진행 상황입니다. 팔로업 예정일이 지난 건이 맨 위에 옵니다.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          DB 오류: {(error as { message?: string }).message ?? String(error)}
        </div>
      )}

      <OutreachBoard rows={rows} activities={activities} />
    </div>
  );
}
