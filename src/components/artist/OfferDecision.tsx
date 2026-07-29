"use client";

/**
 * 업무 상세의 수락/거절 블록.
 *
 * 대시보드 카드(WorkCard)에도 같은 버튼이 있지만, 조건을 다 읽고 나서
 * 그 자리에서 결정할 수 있어야 해서 상세에도 둔다.
 */

import { useState, useTransition } from "react";
import { respondToOffer } from "@/app/artist/actions";

export default function OfferDecision({ assignmentId }: { assignmentId: string }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function respond(accept: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await respondToOffer(assignmentId, accept, reason);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
      <p className="font-bold text-amber-900">이 업무를 맡으시겠습니까?</p>
      <p className="mt-0.5 text-sm text-amber-800">
        아래 의뢰 내용과 작업비를 확인한 뒤 선택해 주세요. 거절하면 다른 아티스트에게
        재배정됩니다.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-white p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {declining ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4">
          <label
            htmlFor="decline-reason"
            className="mb-1 block text-sm font-semibold text-slate-700"
          >
            거절 사유 (선택)
          </label>
          <textarea
            id="decline-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="일정이 겹칩니다 / 작업 난이도상 어렵습니다 등"
            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#1E22B2]"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => respond(false)}
              disabled={pending}
              className="rounded-lg bg-red-500 px-4 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "처리 중…" : "거절 확정"}
            </button>
            <button
              onClick={() => setDeclining(false)}
              disabled={pending}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-500"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => respond(true)}
            disabled={pending}
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "#1E22B2" }}
          >
            {pending ? "처리 중…" : "수락하고 작업 시작"}
          </button>
          <button
            onClick={() => setDeclining(true)}
            disabled={pending}
            className="rounded-xl border border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
          >
            거절
          </button>
        </div>
      )}
    </div>
  );
}
