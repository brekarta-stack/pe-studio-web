"use client";

/**
 * 초대 수락 폼.
 *
 * 관리자가 아티스트를 지목해 발급한 링크이므로, 이메일만 연결하면 바로 승인된다.
 * 추가 승인 단계를 두지 않는 이유: 링크를 만든 것 자체가 관리자의 승인이다.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { acceptArtistInvite } from "@/app/artist/actions";
import GoogleSignInButton from "./GoogleSignInButton";

export default function JoinForm({
  token,
  artistName,
}: {
  token: string;
  artistName: string;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await acceptArtistInvite(token, email);
      if (result.ok) setDone(true);
      else setError(result.error);
    });
  }

  if (done) {
    return (
      <div className="space-y-5 text-center">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <p className="text-2xl" aria-hidden>
            🎉
          </p>
          <p className="mt-2 font-bold text-emerald-800">등록이 완료되었습니다</p>
          <p className="mt-1 text-sm text-emerald-700">
            이제 <b>{email}</b> 구글 계정으로 로그인하세요.
          </p>
        </div>
        <GoogleSignInButton callbackUrl="/artist" />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
        <b>{artistName}</b> 님으로 초대되었습니다. 로그인에 사용할 구글 이메일을 등록해 주세요.
      </div>

      <div>
        <label htmlFor="join-email" className="mb-1 block text-sm font-semibold text-slate-700">
          구글 이메일 <span className="text-red-500">*</span>
        </label>
        <input
          id="join-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="you@gmail.com"
          className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[#1E22B2]"
        />
        <p className="mt-1 text-xs text-slate-400">
          이 주소의 구글 계정으로만 로그인할 수 있습니다.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl py-3 font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: "#1E22B2" }}
      >
        {pending ? "등록 중…" : "이메일 등록하기"}
      </button>

      <p className="text-center text-sm text-slate-500">
        이미 등록했나요?{" "}
        <Link href="/artist/login" className="font-semibold text-[#1E22B2] underline">
          로그인
        </Link>
      </p>
    </form>
  );
}
