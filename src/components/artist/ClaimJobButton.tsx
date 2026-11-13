"use client";

/** 공고 가져가기 — 한 번 더 확인받고 누른다(되돌리려면 관리자에게 연락해야 하므로) */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimJob } from "@/app/artist/actions";

export default function ClaimJobButton({ postingId }: { postingId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function claim() {
    setError(null);
    start(async () => {
      const res = await claimJob(postingId);
      if (res.ok) {
        router.push(`/artist/works/${res.assignmentId}`);
        router.refresh();
      } else {
        setConfirming(false);
        setError(res.error);
      }
    });
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {error}
        <button type="button" onClick={() => router.push("/artist/jobs")} className="mt-2 block font-semibold underline">
          다른 공고 보기
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#1E22B2]/20 bg-[#1E22B2]/5 p-5">
      {confirming ? (
        <>
          <p className="text-sm font-semibold text-slate-800">이 작업을 맡으시겠어요?</p>
          <p className="mt-1 text-xs text-slate-500">
            가져가면 내 업무로 옮겨지고 다른 작업자에게는 보이지 않습니다. 취소는 담당자에게 요청해야 합니다.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={claim}
              disabled={pending}
              className="flex-1 rounded-xl bg-[#1E22B2] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {pending ? "가져가는 중…" : "네, 맡겠습니다"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600"
            >
              취소
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">먼저 가져간 분이 이 작업을 맡습니다.</p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-3 w-full rounded-xl bg-[#1E22B2] px-4 py-3 text-sm font-bold text-white"
          >
            이 작업 가져가기
          </button>
        </>
      )}
    </div>
  );
}
