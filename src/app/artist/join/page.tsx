import Link from "next/link";
import { getAccountByInviteToken } from "@/lib/artist-accounts";
import { isInviteValid } from "@/lib/artist-account-types";
import { getArtistById } from "@/lib/artists";
import JoinForm from "@/components/artist/JoinForm";

export const dynamic = "force-dynamic";

/**
 * 초대 수락 — /artist/join?token=...
 *
 * 토큰이 유효하지 않으면 폼 자체를 보여주지 않는다. 이유를 구분해 알려 주지도
 * 않는다(만료인지 없는 토큰인지) — 토큰을 넣어 보며 맞추는 시도에 힌트를 주지 않기 위해.
 */
export default async function ArtistJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const account = token ? await getAccountByInviteToken(token) : null;
  const valid = isInviteValid(account);

  // 초대는 아티스트를 지목해 발급되므로 artistId 가 반드시 있다
  const artist = valid && account?.artistId ? await getArtistById(account.artistId) : null;
  const artistName = artist?.name || account?.displayName || "아티스트";

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold text-slate-900">아티스트 포털 등록</h1>
        <p className="mt-1 text-sm text-slate-500">초대 링크로 계정을 연결합니다.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {valid && token ? (
          <JoinForm token={token} artistName={artistName} />
        ) : (
          <div className="text-center">
            <p className="text-2xl" aria-hidden>
              ⚠️
            </p>
            <p className="mt-2 font-bold text-slate-800">사용할 수 없는 초대 링크입니다</p>
            <p className="mt-1 text-sm text-slate-500">
              링크가 만료되었거나 이미 사용되었습니다. 담당자에게 새 링크를 요청해 주세요.
            </p>
            <Link
              href="/artist/apply"
              className="mt-4 inline-block text-sm font-semibold text-[#1E22B2] underline"
            >
              직접 가입 신청하기
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
