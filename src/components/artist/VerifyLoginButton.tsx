"use client";

/**
 * 로그인 링크 확인 버튼. 링크를 여는 것만으로 로그인되지 않게 한 번 누르게 한다 —
 * 메일 보안 검사기가 링크를 미리 열어 1회용 토큰을 써 버리는 일을 막기 위해서다.
 */

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { signInErrorMessage } from "@/lib/artist-account-types";

export default function VerifyLoginButton({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setPending(true);
    setError(null);
    const res = await signIn("email-link", { token, redirect: false });
    if (res?.ok && !res.error) {
      // 전체 새로 고침으로 들어가야 세션을 읽는 껍데기(ArtistShell)가 바로 바뀐다
      window.location.href = "/artist";
      return;
    }
    setPending(false);
    setError(
      !res?.error || res.error === "CredentialsSignin"
        ? "링크가 만료됐거나 이미 사용됐습니다. 로그인 화면에서 새 링크를 받아 주세요."
        : signInErrorMessage(res.error),
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="w-full rounded-xl bg-[#1E22B2] px-6 py-3 font-semibold text-white disabled:opacity-50"
      >
        {pending ? "확인 중…" : "로그인"}
      </button>
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {error}{" "}
          <Link href="/artist/login" className="font-semibold underline">
            로그인 화면으로
          </Link>
        </div>
      )}
    </div>
  );
}
