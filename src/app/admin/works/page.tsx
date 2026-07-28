import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAllArtists } from "@/lib/artists";
import { listAssignmentViews } from "@/lib/assignments";
import WorksBoard, {
  type ArtistOption,
  type UnassignedLead,
} from "@/components/admin/WorksBoard";

export const dynamic = "force-dynamic";

export default async function AdminWorksPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  /* 독립 조회를 한 번에 병렬로 — 순차 왕복이 쌓이지 않게.
     (테이블이 없으면 listAssignmentViews 가 빈 배열로 폴백하므로 함께 조회해도 안전) */
  const [probeRes, works, artistsRes, quoteRowsRes] = await Promise.all([
    supabaseAdmin.from("assignments").select("id").limit(1),
    listAssignmentViews(),
    getAllArtists(),
    supabaseAdmin
      .from("quotes")
      .select("id, name, product, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const ready = !probeRes.error;
  if (!ready) {
    return (
      <div className="mx-auto max-w-3xl p-6 md:p-8">
        <h1 className="text-2xl font-bold text-slate-900">작업 관리</h1>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-bold text-amber-800">
            <code className="font-mono">assignments</code> 테이블이 아직 없습니다.
          </p>
          <p className="mt-1 text-sm text-amber-700">
            배정 데이터를 저장할 테이블을 먼저 만들어야 합니다.
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

  const artists: ArtistOption[] = artistsRes.artists.map((a) => ({ id: a.id, name: a.name }));

  /* 새 배정 모달의 선택지 — 아직 배정이 없는 리드만.
     최신 순으로 최대 100건까지 (그보다 오래된 미배정 리드는 실무상 대상이 아니다) */
  const assignedIds = new Set(works.map((w) => w.quoteId));
  const unassigned: UnassignedLead[] = (quoteRowsRes.data ?? [])
    .filter((q) => !assignedIds.has(q.id as string))
    .map((q) => ({
      id: q.id as string,
      name: (q.name as string) || "(이름 없음)",
      product: (q.product as string) ?? "",
      createdAt: q.created_at as string,
    }));

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">작업 관리</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          어떤 리드를 누가 맡았고, 얼마나 진행됐으며, 작업비·납기가 어떻게 되는지 관리합니다.
          {" "}아티스트 프로필 편집은{" "}
          <Link href="/admin/artists" className="underline hover:text-slate-700">아티스트</Link>
          {" "}메뉴에서 합니다.
        </p>
      </div>

      <WorksBoard works={works} artists={artists} unassigned={unassigned} />
    </div>
  );
}
