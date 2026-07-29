import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAllArtists } from "@/lib/artists";
import { listAccountViews } from "@/lib/artist-accounts";
import AccountsBoard, { type ArtistOption } from "@/components/admin/AccountsBoard";

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  /* 독립 조회를 병렬로 — 테이블이 없으면 listAccountViews 가 빈 배열로 폴백하므로
     probe 와 함께 조회해도 안전하다 (/admin/works 와 같은 방식) */
  const [probe, accounts, artistsRes] = await Promise.all([
    supabaseAdmin.from("artist_accounts").select("id").limit(1),
    listAccountViews(),
    getAllArtists(),
  ]);

  if (probe.error) {
    return (
      <div className="mx-auto max-w-3xl p-6 md:p-8">
        <h1 className="text-2xl font-bold text-slate-900">아티스트 계정</h1>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-bold text-amber-800">
            <code className="font-mono">artist_accounts</code> 테이블이 아직 없습니다.
          </p>
          <p className="mt-1 text-sm text-amber-700">
            아티스트 포털 로그인을 관리할 테이블을 먼저 만들어야 합니다.
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

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">아티스트 계정</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          누가 아티스트 포털(<code className="font-mono text-xs">/artist</code>)에 로그인할 수
          있는지 관리합니다. 승인된 계정은 자기에게 배정된 업무와 작업비만 볼 수 있습니다.
          {" "}프로필 편집은{" "}
          <Link href="/admin/artists" className="underline hover:text-slate-700">
            아티스트
          </Link>
          {" "}메뉴에서 합니다.
        </p>
      </div>

      <AccountsBoard accounts={accounts} artists={artists} />
    </div>
  );
}
