import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { quoteFromRow, type QuoteSubmission } from "@/lib/quote-types";
import { getAllArtists } from "@/lib/artists";
import { listAssignments } from "@/lib/assignments";
import DropsList from "@/components/admin/DropsList";
import type { AssignedMap } from "@/components/admin/QuoteSheet";

export const dynamic = "force-dynamic";

export default async function AdminDropsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  // 독립 조회를 병렬로 (quotes + 아티스트 + 배정) — 순차 왕복 제거
  const [quotesRes, artistsRes, assignmentRows] = await Promise.all([
    supabaseAdmin.from("quotes").select("*").order("created_at", { ascending: false }),
    getAllArtists(),
    listAssignments(), // 테이블 없으면 빈 배열 폴백
  ]);

  const { data, error } = quotesRes;
  // Drop 처리된 문의만 — dropped_at 최신순
  const dropped: QuoteSubmission[] = (error ? [] : (data ?? []).map(quoteFromRow))
    .filter((q) => !!q.droppedAt)
    .sort((a, b) => (b.droppedAt ?? "").localeCompare(a.droppedAt ?? ""));

  /* 담당 아티스트 이름 표시용 배정 맵 */
  const nameById = new Map(artistsRes.artists.map((a) => [a.id, a.name]));
  const assigned: AssignedMap = assignmentRows.reduce<AssignedMap>((acc, a) => {
    (acc[a.quoteId] ??= []).push({ id: a.artistId, name: nameById.get(a.artistId) ?? a.artistId });
    return acc;
  }, {});

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Drop</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          제작 문의에서 제외(Drop)한 건입니다. 총 {dropped.length}건 · 복구하면 제작 문의 목록으로 되돌아갑니다.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          DB 오류: {(error as { message?: string }).message ?? String(error)}
        </div>
      )}

      <DropsList quotes={dropped} assigned={assigned} />
    </div>
  );
}
