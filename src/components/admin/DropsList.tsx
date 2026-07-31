"use client";

/**
 * Drop(제외) 처리된 제작 문의 목록 — 운영 > Drop.
 *
 * 제작 문의 시트에서 담당 아티스트 드롭다운의 "⛔ Drop" 을 고르면 여기로 온다.
 * 여기서 할 수 있는 일은 둘:
 *   · 복구 — 제작 문의 목록으로 되돌린다 (낙관적으로 즉시 감춤)
 *   · 영구 삭제 — 되돌릴 수 없다. 테스트 제출·스팸 정리용.
 *
 * 삭제는 여러 건을 골라 한 번에 처리한다. 테스트 데이터를 치우는 상황에서
 * 한 건씩 확인창을 띄우면 결국 아무 생각 없이 눌러 넘기게 된다 —
 * 무엇을 지우는지 목록으로 한 번 보여주고 한 번만 확인받는 편이 더 안전하다.
 */

import { useMemo, useState, useTransition } from "react";
import type { QuoteSubmission } from "@/lib/quote-types";
import { STAGE_LABELS, STAGE_COLORS } from "@/lib/assignment-types";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";
import { restoreQuote, deleteQuoteForever } from "@/app/admin/quotes/actions";
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
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
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
      if (restoredIds.has(q.id) || deletedIds.has(q.id)) return false;
      if (!term) return true;
      return [q.name, q.email, q.phone, q.notes, q.colorRequest]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [quotes, search, restoredIds, deletedIds]);

  /* 선택은 현재 보이는 행 기준으로만 유지한다 — 검색을 바꿨을 때
     화면에 없는 항목이 조용히 선택된 채 남아 함께 지워지면 안 된다. */
  const visibleSelected = useMemo(
    () => rows.filter((q) => selected.has(q.id)),
    [rows, selected]
  );

  const allVisibleChecked = rows.length > 0 && visibleSelected.length === rows.length;

  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleAll = () =>
    setSelected(() => (allVisibleChecked ? new Set() : new Set(rows.map((q) => q.id))));

  /** 선택한 건을 순서대로 지운다. 실패한 건은 남기고 무엇이 실패했는지 알린다. */
  const onDeleteSelected = () => {
    const targets = visibleSelected;
    setError(null);
    startTransition(async () => {
      const failures: string[] = [];
      const done: string[] = [];
      for (const q of targets) {
        const res = await deleteQuoteForever(q.id);
        if (res.ok) done.push(q.id);
        else failures.push(`${q.name || q.email || q.id}: ${res.error}`);
      }
      if (done.length > 0) {
        setDeletedIds((s) => {
          const n = new Set(s);
          done.forEach((id) => n.add(id));
          return n;
        });
      }
      setSelected(new Set());
      setConfirming(false);
      if (failures.length > 0) setError(failures.join(" / "));
    });
  };

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

        {visibleSelected.length > 0 && (
          <button
            onClick={() => setConfirming(true)}
            disabled={isPending}
            className="h-9 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            선택한 {visibleSelected.length}건 영구 삭제
          </button>
        )}

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
              <th className={`${th} w-10`}>
                <input
                  type="checkbox"
                  checked={allVisibleChecked}
                  onChange={toggleAll}
                  disabled={rows.length === 0}
                  aria-label="전체 선택"
                  className="h-3.5 w-3.5 accent-[#1E22B2]"
                />
              </th>
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
                <td colSpan={11} className="px-4 py-16 text-center text-slate-400">
                  {quotes.length === 0
                    ? "Drop 처리된 문의가 없습니다."
                    : "조건에 맞는 문의가 없습니다."}
                </td>
              </tr>
            ) : (
              rows.map((q) => {
                const artistNames = (assigned[q.id] ?? []).map((a) => a.name).join(", ");
                const checked = selected.has(q.id);
                return (
                  <tr key={q.id} className={checked ? "bg-red-50/60" : "hover:bg-slate-50/60"}>
                    <td className={td}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(q.id)}
                        aria-label={`${q.name || q.email || "문의"} 선택`}
                        className="h-3.5 w-3.5 accent-[#1E22B2]"
                      />
                    </td>
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

      {/* 삭제 확인 — 무엇이 사라지는지 목록으로 보여주고 한 번만 묻는다 */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => !isPending && setConfirming(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-slate-900">
              {visibleSelected.length}건을 영구 삭제할까요?
            </h2>
            <p className="mt-1 text-sm text-red-600">
              되돌릴 수 없습니다. 복구가 필요할 수 있으면 Drop 상태로 두세요.
            </p>

            <ul className="mt-4 max-h-60 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
              {visibleSelected.map((q) => (
                <li key={q.id} className="text-sm text-slate-700">
                  <b>{q.name || "(이름 없음)"}</b>
                  {q.email && <span className="text-slate-400"> · {q.email}</span>}
                </li>
              ))}
            </ul>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={isPending}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={onDeleteSelected}
                disabled={isPending}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? "삭제 중…" : "영구 삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
