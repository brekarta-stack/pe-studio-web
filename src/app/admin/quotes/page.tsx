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

  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("*")
    .order("created_at", { ascending: false });

  const quotes: QuoteSubmission[] = error ? [] : (data ?? []).map(quoteFromRow);

  /* 아티스트 목록 + 배정 현황.
     assignments 테이블이 아직 없으면 listAssignments 가 빈 배열로 폴백하므로,
     별도로 존재 여부를 확인해 시트에서 배정 UI 를 잠그고 안내를 띄운다. */
  const { artists: allArtists } = await getAllArtists();
  const artists: ArtistOption[] = allArtists.map((a) => ({ id: a.id, name: a.name }));

  let assignmentsReady = true;
  try {
    const { error: probe } = await supabaseAdmin.from("assignments").select("id").limit(1);
    if (probe) assignmentsReady = false;
  } catch {
    assignmentsReady = false;
  }

  let assigned: AssignedMap = {};
  if (assignmentsReady) {
    const nameById = new Map(artists.map((a) => [a.id, a.name]));
    const rows = await listAssignments();
    assigned = rows.reduce<AssignedMap>((acc, a) => {
      (acc[a.quoteId] ??= []).push({
        id: a.artistId,
        name: nameById.get(a.artistId) ?? a.artistId,
      });
      return acc;
    }, {});
  }

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
