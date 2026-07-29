"use client";

/**
 * 업무 카드 — 대시보드 목록의 한 줄.
 *
 * 제안(offered) 상태면 카드 안에서 바로 수락/거절할 수 있다. 상세 페이지까지
 * 들어가야 응답할 수 있으면 "할지 말지"를 고르는 데 단계가 하나 더 붙는다.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ASSIGNMENT_STATUS_COLORS,
  ASSIGNMENT_STATUS_LABELS,
  OFFER_STATUS_COLORS,
  OFFER_STATUS_LABELS,
  daysUntil,
  formatWon,
} from "@/lib/assignment-types";
import type { ArtistWork } from "@/lib/artist-portal-types";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";
import { respondToOffer } from "@/app/artist/actions";

/** 납기 D-day 배지 — 완료·거절 건에는 붙이지 않는다 */
function DueBadge({ dueDate, muted }: { dueDate: string | null; muted: boolean }) {
  if (!dueDate) return null;
  const d = daysUntil(dueDate);
  if (d == null) return null;

  const tone = muted
    ? "bg-slate-100 text-slate-500 border-slate-200"
    : d < 0
      ? "bg-red-50 text-red-600 border-red-200"
      : d <= 7
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-slate-50 text-slate-600 border-slate-200";

  const text = muted ? dueDate : d < 0 ? `${-d}일 초과` : d === 0 ? "오늘 마감" : `D-${d}`;

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      납기 {text}
    </span>
  );
}

export default function WorkCard({ work }: { work: ArtistWork }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isOffer = work.offerStatus === "offered";
  const muted = work.offerStatus === "declined" || work.status === "cancelled";

  function respond(accept: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await respondToOffer(work.id, accept, reason);
      if (!result.ok) setError(result.error);
      else setDeclining(false);
    });
  }

  return (
    <div
      className={`rounded-2xl border bg-white p-5 ${
        isOffer ? "border-amber-300 shadow-sm" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                OFFER_STATUS_COLORS[work.offerStatus]
              }`}
            >
              {OFFER_STATUS_LABELS[work.offerStatus]}
            </span>
            {work.offerStatus === "accepted" && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  ASSIGNMENT_STATUS_COLORS[work.status]
                }`}
              >
                {ASSIGNMENT_STATUS_LABELS[work.status]}
              </span>
            )}
            <DueBadge dueDate={work.dueDate} muted={muted} />
          </div>

          <h3 className="mt-2 truncate text-base font-bold text-slate-900">
            {label(PRODUCT_LABELS, work.brief.product) || "제작 의뢰"}
            {work.brief.quantity && (
              <span className="ml-2 text-sm font-medium text-slate-400">
                {work.brief.quantity}
              </span>
            )}
          </h3>
          {work.brief.purpose && (
            <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{work.brief.purpose}</p>
          )}
        </div>

        <div className="text-right">
          <p className="text-[11px] font-semibold text-slate-400">내 작업비</p>
          <p className="text-lg font-bold text-slate-900">
            {work.payout.fee == null ? "협의 예정" : `${formatWon(work.payout.fee)}원`}
          </p>
          {work.payout.fee != null && work.payout.taxAmount !== 0 && (
            <p className="text-[11px] text-slate-400">
              실지급 {formatWon(work.payout.net)}원
            </p>
          )}
        </div>
      </div>

      {work.offerStatus === "accepted" && work.status !== "cancelled" && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-400">
            <span>진행률</span>
            <span>{work.progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${work.progress}%`, background: "#1E22B2" }}
            />
          </div>
        </div>
      )}

      {work.declineReason && (
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
          거절 사유: {work.declineReason}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/artist/works/${work.id}`}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
        >
          상세 보기
        </Link>

        {isOffer && !declining && (
          <>
            <button
              onClick={() => respond(true)}
              disabled={pending}
              className="rounded-xl px-4 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "#1E22B2" }}
            >
              {pending ? "처리 중…" : "수락"}
            </button>
            <button
              onClick={() => setDeclining(true)}
              disabled={pending}
              className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              거절
            </button>
          </>
        )}
      </div>

      {isOffer && declining && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label
            htmlFor={`decline-${work.id}`}
            className="mb-1 block text-sm font-semibold text-slate-700"
          >
            거절 사유 (선택)
          </label>
          <textarea
            id={`decline-${work.id}`}
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
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
