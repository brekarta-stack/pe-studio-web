"use client";

/**
 * Drop(제외) 처리된 제작 문의 목록 — 운영 > Drop.
 *
 * 제작 문의 시트에서 담당 아티스트 드롭다운의 "⛔ Drop" 을 고르면 여기로 온다.
 * 여기서는 조회 + 복구(제작 문의로 되돌리기)만 한다. 복구는 낙관적으로 즉시 감춘다.
 */

import { useMemo, useState, useTransition } from "react";
import type { QuoteSubmission } from "@/lib/quote-types";
import { STAGE_LABELS, STAGE_COLORS } from "@/lib/assignment-types";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";
import { restoreQuote } from "@/app/admin/quotes/actions";
import type { AssignedMap } from "@/components/admin/QuoteSheet";

interface Props {
  quotes: QuoteSubmission[];
  assigned: AssignedMap;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", {
    year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function DropsList({ quotes, assigned }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [restoredIds, setRestoredIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const onRestore = (q: QuoteSubmission) => {
    setRestoredIds((s) => new Set(s).add(q.id));
    setError(null);
    startTransition(async () => {
      const res = await restoreQuote(q.id);
      if (!res.ok) {
        setRestoredIds((s) => {
          const n = new Set(s);
          n.delete(q.id);
          return n;
        });
        setError(res.error);
      }
    });
  };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return quotes.filter((q) => {
      if (restoredIds.has(q.id)) return false;
      if (!term) return true;
      return [q.name, q.email, q.phone, q.notes, q.colorRequest]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [quotes, search, restoredIds]);

  const th =
    "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap border-b border-slate-200";
  const td = "px-3 py-2 text-sm text-slate-700 align-top border-b border-slate-100";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름·이메일·연락처·메모 검색"
          className="h-9 w-60 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
        />
        <span className="ml-auto text-sm text-slate-400">
          {rows.length}건
          {isPending && <span className="ml-2 text-slate-300">처리 중…</span>}
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          처리하지 못했습니다: {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <th className={`${th} w-36`}>Drop 일시</th>
              <th className={`${th} w-32`}>접수일</th>
              <th className={`${th} w-28`}>이름</th>
              <th className={`${th} w-32`}>연락처</th>
              <th className={`${th} w-48`}>이메일</th>
              <th className={`${th} w-36`}>제품</th>
              <th className={`${th} w-28`}>단계</th>
              <th className={`${th} w-28`}>담당</th>
              <th className={`${th} w-56`}>메모</th>
              <th className={`${th} w-24`}>복구</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-16 text-center text-slate-400">
                  {quotes.length === 0
                    ? "Drop 처리된 문의가 없습니다."
                    : "조건에 맞는 문의가 없습니다."}
                </td>
              </tr>
            ) : (
              rows.map((q) => {
                const artistNames = (assigned[q.id] ?? []).map((a) => a.name).join(", ");
                return (
                  <tr key={q.id} className="hover:bg-slate-50/60">
                    <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>{fmtDate(q.droppedAt)}</td>
                    <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>{fmtDate(q.createdAt)}</td>
                    <td className={`${td} font-semibold text-slate-900`}>{q.name || "—"}</td>
                    <td className={td}>
                      {q.phone ? <a href={`tel:${q.phone}`} className="hover:text-blue-700 hover:underline">{q.phone}</a> : "—"}
                    </td>
                    <td className={td}>
                      {q.email ? <a href={`mailto:${q.email}`} className="hover:text-blue-700 hover:underline">{q.email}</a> : "—"}
                    </td>
                    <td className={td}>
                      <span className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "#F0F2FF", color: "#1E22B2" }}>
                        {label(PRODUCT_LABELS, q.product) || "—"}
                      </span>
                    </td>
                    <td className={td}>
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${STAGE_COLORS[q.stage]}`}>
                        {STAGE_LABELS[q.stage]}
                      </span>
                    </td>
                    <td className={td}>{artistNames || <span className="text-slate-300">미배정</span>}</td>
                    <td className={`${td} max-w-[14rem]`}><span className="line-clamp-2">{q.notes || "—"}</span></td>
                    <td className={td}>
                      <button
                        onClick={() => onRestore(q)}
                        disabled={isPending}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        ↩ 복구
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
