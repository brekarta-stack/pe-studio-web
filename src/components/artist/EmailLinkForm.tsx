"use client";

/**
 * 이메일 로그인 링크 요청 폼 — 구글 계정이 없는 작업자용 (docs/job-board-plan.md §5).
 * 결과 문구는 계정 유무와 상관없이 같다.
 */

import { useState, useTransition } from "react";
import { requestEmailLoginLink } from "@/app/artist/actions";
import { LOGIN_LINK_SENT_MESSAGE } from "@/lib/job-board-types";

export default function EmailLinkForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await requestEmailLoginLink(email);
      if (res.ok) setDone(true);
      else setError(res.error);
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        {LOGIN_LINK_SENT_MESSAGE}
        <button
          type="button"
          onClick={() => setDone(false)}
          className="mt-2 block text-xs text-emerald-700 underline"
        >
          다른 이메일로 다시 받기
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="login-email" className="block text-sm font-semibold text-slate-700">
        이메일로 로그인 링크 받기
      </label>
      <div className="flex gap-2">
        <input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="등록한 이메일"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-[#1E22B2] focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !email}
          className="flex-shrink-0 rounded-xl bg-[#1E22B2] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "보내는 중…" : "링크 받기"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-slate-400">네이버 메일 등 구글이 아닌 주소로 등록했다면 이 방법을 쓰세요.</p>
    </form>
  );
}
