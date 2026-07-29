"use client";

/**
 * 가입 신청 폼 — 로그인 전에 쓰는 공개 폼.
 *
 * 여기서 만들어지는 건 승인 대기(pending) 계정뿐이라 그 자체로는 아무
 * 권한도 생기지 않는다. 관리자가 아티스트와 매칭하고 승인해야 로그인된다.
 * 그래서 "구글 계정으로 쓸 이메일"을 정확히 받는 게 이 폼의 핵심이다.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { submitApplication } from "@/app/artist/actions";

export default function ApplyForm() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitApplication({ displayName, email, phone, note });
      if (result.ok) setDone(true);
      else setError(result.error);
    });
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-2xl" aria-hidden>
          ✅
        </p>
        <p className="mt-2 font-bold text-emerald-800">신청이 접수되었습니다</p>
        <p className="mt-1 text-sm text-emerald-700">
          관리자 승인 후 <b>{email}</b> 구글 계정으로 로그인할 수 있습니다.
        </p>
        <Link
          href="/artist/login"
          className="mt-4 inline-block text-sm text-emerald-700 underline"
        >
          로그인 화면으로
        </Link>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[#1E22B2]";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="apply-name" className="mb-1 block text-sm font-semibold text-slate-700">
          이름 <span className="text-red-500">*</span>
        </label>
        <input
          id="apply-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          maxLength={100}
          placeholder="실명 또는 활동명"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="apply-email" className="mb-1 block text-sm font-semibold text-slate-700">
          구글 이메일 <span className="text-red-500">*</span>
        </label>
        <input
          id="apply-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="you@gmail.com"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-400">
          로그인에 쓸 구글 계정 이메일이어야 합니다. 다른 주소를 적으면 로그인되지 않습니다.
        </p>
      </div>

      <div>
        <label htmlFor="apply-phone" className="mb-1 block text-sm font-semibold text-slate-700">
          연락처
        </label>
        <input
          id="apply-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={50}
          placeholder="010-0000-0000"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="apply-note" className="mb-1 block text-sm font-semibold text-slate-700">
          간단한 소개 · 작업 분야
        </label>
        <textarea
          id="apply-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="주로 하는 작업, 포트폴리오 링크 등을 적어 주세요."
          className={`${inputClass} resize-y`}
        />
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
        {pending ? "신청 중…" : "가입 신청하기"}
      </button>

      <p className="text-center text-sm text-slate-500">
        이미 승인된 계정이 있나요?{" "}
        <Link href="/artist/login" className="font-semibold text-[#1E22B2] underline">
          로그인
        </Link>
      </p>
    </form>
  );
}
