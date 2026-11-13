import Image from "next/image";
import Link from "next/link";
import VerifyLoginButton from "@/components/artist/VerifyLoginButton";

export const dynamic = "force-dynamic";

/** 이메일 로그인 링크가 여는 화면 — 버튼을 눌러야 로그인된다 (VerifyLoginButton 참고) */
export default async function VerifyLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <Image
            src="/brand/pe-studio-mark.png"
            alt=""
            width={44}
            height={56}
            className="mx-auto mb-4 h-14 w-auto"
            aria-hidden
          />
          <h1 className="text-xl font-bold text-slate-900">작업자 포털 로그인</h1>
          <p className="mt-1 text-sm text-slate-500">아래 버튼을 누르면 로그인됩니다.</p>
        </div>
        {token ? (
          <VerifyLoginButton token={token} />
        ) : (
          <p className="text-center text-sm text-slate-500">
            링크가 올바르지 않습니다.{" "}
            <Link href="/artist/login" className="font-semibold text-[#1E22B2] underline">
              새 링크 받기
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
