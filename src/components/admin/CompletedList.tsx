"use client";

/**
 * 완료 프로젝트 목록 — 운영 > 완료 프로젝트.
 *
 * 납품(delivered)·정산(settled) 단계 리드만 모아 본다. 활성 큐(제작 문의)에서
 * 끝난 건을 빼 두어야 손이 필요한 건이 묻히지 않는다 (docs/sales-pipeline-plan.md §2 원칙 2).
 * 여기서 하는 일은 셋:
 *   · 납품 ↔ 정산 단계 전환
 *   · 잘못 옮긴 건을 제작중으로 되돌리기 — 2단계 버튼(첫 클릭은 4초간 대기, 다시 누르면 실행)
 *   · 매출·수금 확인 (편집은 작업 관리·월 정산에서)
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  DONE_STAGES,
  STAGE_COLORS,
  STAGE_LABELS,
  formatWon,
  type QuoteStage,
} from "@/lib/assignment-types";
import type { QuoteBilling } from "@/lib/completed";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";
import { setQuoteStage } from "@/app/admin/quotes/actions";

export interface CompletedRow {
  id: string;
  name: string;
  org: string;
  product: string;
  stage: QuoteStage;
  /** 완료일 (ISO) — closedAt ?? stageChangedAt ?? createdAt */
  completedAt: string;
  billing: QuoteBilling;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

/** 되돌리기 버튼이 실행 대기 상태로 머무는 시간 */
const ARM_MS = 4000;

export default function CompletedList({ rows: initial }: { rows: CompletedRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /* 낙관적 상태 — 단계 변경은 덮어쓰고, 되돌린 건은 목록에서 감춘다 */
  const [stageOverride, setStageOverride] = useState<Record<string, QuoteStage>>({});
  const [reopened, setReopened] = useState<Set<string>>(new Set());
  const [armedId, setArmedId] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (armTimer.current) clearTimeout(armTimer.current);
  }, []);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return initial.filter((r) => {
      if (reopened.has(r.id)) return false;
      if (!term) return true;
      return [r.name, r.org, r.product, label(PRODUCT_LABELS, r.product)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [initial, search, reopened]);

  const onStage = (r: CompletedRow, next: QuoteStage) => {
    const prev = stageOverride[r.id];
    setStageOverride((s) => ({ ...s, [r.id]: next }));
    setError(null);
    startTransition(async () => {
      const res = await setQuoteStage(r.id, next);
      if (!res.ok) {
        setStageOverride((s) => {
          const n = { ...s };
          if (prev) n[r.id] = prev;
          else delete n[r.id];
          return n;
        });
        setError(res.error);
      }
    });
  };

  const onReopen = (r: CompletedRow) => {
    if (armedId !== r.id) {
      // 첫 클릭 — 실행하지 않고 대기 상태로만 바꾼다
      setArmedId(r.id);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmedId(null), ARM_MS);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmedId(null);
    setReopened((s) => new Set(s).add(r.id));
    setError(null);
    startTransition(async () => {
      const res = await setQuoteStage(r.id, "producing");
      if (!res.ok) {
        setReopened((s) => {
          const n = new Set(s);
          n.delete(r.id);
          return n;
        });
        setError(res.error);
      }
    });
  };

  const th =
    "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap border-b border-slate-200";
  const td = "px-3 py-2.5 text-sm text-slate-700 align-top border-b border-slate-100";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="고객·기관·제품 검색"
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
              <th className={th}>고객 · 기관</th>
              <th className={th}>제품</th>
              <th className={th}>단계</th>
              <th className={th}>완료일</th>
              <th className={`${th} text-right`}>매출 합</th>
              <th className={th}>수금</th>
              <th className={th}>아티스트</th>
              <th className={th}>조치</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center text-slate-400">
                  {initial.length === 0
                    ? "아직 완료된 프로젝트가 없습니다. 제작 문의에서 납품완료로 옮기면 여기에 모입니다."
                    : "조건에 맞는 프로젝트가 없습니다."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const stage = stageOverride[r.id] ?? r.stage;
                const b = r.billing;
                const armed = armedId === r.id;
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className={td}>
                      <p className="font-semibold text-slate-900">{r.name || "(이름 없음)"}</p>
                      {r.org && <p className="mt-0.5 text-xs text-slate-400">{r.org}</p>}
                    </td>
                    <td className={td}>
                      <span
                        className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ background: "#F0F2FF", color: "#1E22B2" }}
                      >
                        {label(PRODUCT_LABELS, r.product) || "—"}
                      </span>
                    </td>
                    <td className={td}>
                      <select
                        value={stage}
                        onChange={(e) => onStage(r, e.target.value as QuoteStage)}
                        disabled={isPending}
                        aria-label={`${r.name} 단계`}
                        className={`cursor-pointer rounded-full border px-2 py-1 text-xs font-semibold outline-none disabled:opacity-60 ${STAGE_COLORS[stage]}`}
                      >
                        {DONE_STAGES.map((s) => (
                          <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>{fmtDate(r.completedAt)}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                      {b.revenue > 0 ? `${formatWon(b.revenue)}원` : <span className="text-slate-300">—</span>}
                      {b.revenue > 0 && (
                        <p className="mt-0.5 text-[11px] text-slate-400">공급가 · 부가세 별도</p>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {b.received ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          수금 완료
                        </span>
                      ) : b.receivableCount > 0 ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
                          미수 {b.receivableCount}건
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className={td}>
                      {b.artistNames.length > 0 ? b.artistNames.join(", ") : <span className="text-slate-300">미배정</span>}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onReopen(r)}
                          disabled={isPending}
                          className={`rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                            armed
                              ? "border-amber-300 bg-amber-50 text-amber-800"
                              : "border-slate-200 text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {armed ? "한 번 더 누르면 되돌립니다" : "제작중으로 되돌리기"}
                        </button>
                        <Link
                          href="/admin/works"
                          className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          작업 관리 →
                        </Link>
                      </div>
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
