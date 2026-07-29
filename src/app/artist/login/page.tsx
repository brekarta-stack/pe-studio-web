import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { signInErrorMessage } from "@/lib/artist-account-types";
import GoogleSignInButton from "@/components/artist/GoogleSignInButton";

export const dynamic = "force-dynamic";

/**
 * 아티스트 포털 로그인.
 *
 * 로그인 자체는 승인된 계정만 통과한다(src/lib/auth.ts). 막힌 이유는
 * ?error= 로 전달돼 여기서 안내 문구가 된다 — 아무 설명 없이 튕기면
 * 아티스트는 무엇을 해야 할지 알 수 없다.
 */
export default async function ArtistLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role === "artist") redirect("/artist");
  if (session?.user?.role === "admin") redirect("/admin");

  const { error } = await searchParams;
  const message = signInErrorMessage(error);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ background: "#1E22B2" }}
          >
            <svg viewBox="0 0 28 28" className="h-6 w-6" fill="none" aria-hidden>
              <path d="M6 4 H14 A6 6 0 0 1 14 16 H10 V24 H6 Z" fill="white" />
              <path d="M14 4 L20 10 V24 H22 V8 L16 2 H14 Z" fill="white" opacity="0.6" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">아티스트 포털</h1>
          <p className="mt-1 text-sm text-slate-500">
            배정된 업무와 정산 내역을 확인하세요.
          </p>
        </div>

        {message && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {message}
          </div>
        )}

        <GoogleSignInButton callbackUrl="/artist" />

        <div className="mt-6 border-t border-slate-100 pt-5 text-center text-sm text-slate-500">
          아직 계정이 없나요?{" "}
          <Link href="/artist/apply" className="font-semibold text-[#1E22B2] underline">
            가입 신청하기
          </Link>
          <p className="mt-2 text-xs text-slate-400">
            초대 링크를 받으셨다면 그 링크로 먼저 등록해 주세요.
          </p>
        </div>
      </div>
    </div>
  );
}
