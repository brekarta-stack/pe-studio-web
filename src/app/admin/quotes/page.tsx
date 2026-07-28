import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { quoteFromRow, type QuoteSubmission } from "@/lib/quote-types";
import { getAllArtists } from "@/lib/artists";
import { listAssignments } from "@/lib/assignments";
import QuoteSheet, { type AssignedMap, type ArtistOption } from "@/components/admin/QuoteSheet";

export const dynamic = "force-dynamic";

export default async function AdminQuotesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  /* 독립적인 조회는 한 번에 병렬로 — 함수↔Supabase 왕복이 순차로 쌓이면 그대로 지연이 된다.
     (getServerSession 은 JWT 해석이라 DB 왕복이 없어 위에서 먼저 처리) */
  const [quotesRes, artistsRes, assignmentProbe, assignmentRows] = await Promise.all([
    supabaseAdmin.from("quotes").select("*").order("created_at", { ascending: false }),
    getAllArtists(),
    // assignments 테이블 존재 확인 — 시트의 배정 UI 잠금/안내 판단용
    supabaseAdmin.from("assignments").select("id").limit(1),
    // 테이블이 없으면 listAssignments 가 빈 배열로 폴백하므로 병렬로 함께 조회해도 안전
    listAssignments(),
  ]);

  const { data, error } = quotesRes;
  // Drop(제외) 처리된 문의는 목록에서 빼고 운영 > Drop 에서만 본다.
  const allQuotes: QuoteSubmission[] = error ? [] : (data ?? []).map(quoteFromRow);
  const quotes = allQuotes.filter((q) => !q.droppedAt);

  const artists: ArtistOption[] = artistsRes.artists.map((a) => ({ id: a.id, name: a.name }));
  const assignmentsReady = !assignmentProbe.error;

  const nameById = new Map(artists.map((a) => [a.id, a.name]));
  const assigned: AssignedMap = assignmentsReady
    ? assignmentRows.reduce<AssignedMap>((acc, a) => {
        (acc[a.quoteId] ??= []).push({ id: a.artistId, name: nameById.get(a.artistId) ?? a.artistId });
        return acc;
      }, {})
    : {};

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">제작 문의</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          총 {quotes.length}건 · 고객이 입력한 모든 항목을 컬럼별로 확인할 수 있습니다.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          DB 오류: {(error as { message?: string }).message ?? String(error)}
          <br />
          <span className="mt-1 block text-xs text-red-500">
            Supabase에 <code>quotes</code> 테이블이 생성되어 있는지 확인하세요.
          </span>
        </div>
      )}

      <QuoteSheet
        quotes={quotes}
        artists={artists}
        assigned={assigned}
        assignmentsReady={assignmentsReady}
      />
    </div>
  );
}
