"use client";

/**
 * 월 정산 보드 — 운영 > 월 정산.
 *
 * 한 달 단위로 매출·작업비·마진과 실제로 오간 돈(수금·지급)을 본다.
 * 숫자는 전부 src/lib/settlement.ts 의 순수 함수로 계산한다 — 대시보드·CSV 와
 * 같은 함수를 써야 세 곳의 숫자가 어긋나지 않는다.
 *
 * 날짜 셀(수금일·선금일·잔금일)은 바꾸는 즉시 저장한다(낙관적 반영, 실패하면 되돌림).
 * 금액 자체는 여기서 고치지 않는다 — 금액 편집은 작업 관리 한 곳에서만 한다.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  PAYOUT_STATUS_COLORS,
  PAYOUT_STATUS_LABELS,
  balanceOf,
  derivePayoutStatus,
  feeTaxAmountOf,
  formatWon,
  margin,
  type AssignmentView,
} from "@/lib/assignment-types";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";
import { formatMonthLabel, settlementCsv, summarizeMonth } from "@/lib/settlement";
import { updateWork } from "@/app/admin/works/actions";

type DateField = "clientPaidAt" | "depositPaidAt" | "balancePaidAt";

const DATE_LABELS: Record<DateField, string> = {
  clientPaidAt: "수금일",
  depositPaidAt: "선금일",
  balancePaidAt: "잔금일",
};

interface Props {
  month: string;
  months: string[];
  /** 이 달에 귀속된 배정 (취소 제외) */
  rows: AssignmentView[];
  /** 귀속 달은 다르지만 이 달에 수금·지급된 배정 */
  otherRows: AssignmentView[];
  /** 수금일 컬럼이 있는가 (마이그레이션 20261013) */
  canEditReceipt: boolean;
}

/** 낙관적 날짜 값을 배정 목록에 덮어쓴다 */
function applyOverrides(
  list: AssignmentView[],
  overrides: Record<string, string | null>
): AssignmentView[] {
  return list.map((a) => {
    const next = { ...a };
    for (const f of Object.keys(DATE_LABELS) as DateField[]) {
      const k = `${a.id}:${f}`;
      if (k in overrides) next[f] = overrides[k];
    }
    return next;
  });
}

/** 바꾼 날짜 한 칸 → updateWork 패치 */
function datePatch(field: DateField, value: string | null) {
  if (field === "clientPaidAt") return { clientPaidAt: value };
  if (field === "depositPaidAt") return { depositPaidAt: value };
  return { balancePaidAt: value };
}

function won(n: number): string {
  return `${formatWon(n)}원`;
}

function Tile({
  title, value, sub, unit, tone = "default",
}: {
  title: string;
  value: string;
  sub?: string;
  unit: string;
  tone?: "default" | "warn" | "good";
}) {
  const tones = {
    default: "border-slate-200 bg-white",
    good:    "border-emerald-200 bg-emerald-50",
    warn:    "border-amber-200 bg-amber-50",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs tabular-nums text-slate-500">{sub}</p>}
      <p className="mt-1 text-[11px] text-slate-400">{unit}</p>
    </div>
  );
}

export default function SettlementBoard({ month, months, rows, otherRows, canEditReceipt }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /* 낙관적 날짜 값 — `${id}:${field}` → 값. 서버가 새 props 를 내려주면 같은 값이 되므로 그대로 둬도 된다 */
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});

  const liveRows = useMemo(() => applyOverrides(rows, overrides), [rows, overrides]);
  const liveOther = useMemo(() => applyOverrides(otherRows, overrides), [otherRows, overrides]);

  /* 요약은 이 달 귀속 배정 + 이 달에 돈이 오간 배정이면 충분하다 —
     summarizeMonth 가 보는 범위가 정확히 그 둘의 합이다. 편집 즉시 타일도 따라 바뀐다 */
  const summary = useMemo(
    () => summarizeMonth([...liveRows, ...liveOther], month),
    [liveRows, liveOther, month]
  );

  const onDate = (a: AssignmentView, field: DateField, value: string | null) => {
    const key = `${a.id}:${field}`;
    const had = key in overrides;
    const prev = overrides[key];
    setOverrides((o) => ({ ...o, [key]: value }));
    setError(null);
    startTransition(async () => {
      const res = await updateWork(a.id, datePatch(field, value));
      if (!res.ok) {
        setOverrides((o) => {
          const n = { ...o };
          if (had) n[key] = prev;
          else delete n[key];
          return n;
        });
        setError(`${a.quoteName} ${DATE_LABELS[field]}: ${res.error}`);
      }
    });
  };

  const onDownload = () => {
    const csv = settlementCsv(liveRows, month);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `settlement-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const monthLabel = formatMonthLabel(month);
  const unit = `${monthLabel} · 공급가액, 부가세 별도`;

  const th =
    "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap border-b border-slate-200";
  const td = "px-3 py-2.5 text-sm text-slate-700 align-top border-b border-slate-100";

  const dateInput = (a: AssignmentView, field: DateField, disabled: boolean) => {
    const v = a[field];
    return (
      <input
        type="date"
        value={v ?? ""}
        disabled={disabled}
        onChange={(e) => onDate(a, field, e.target.value || null)}
        aria-label={`${a.quoteName} ${DATE_LABELS[field]}`}
        className={`w-32 rounded-lg border px-1.5 py-0.5 text-xs outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300 ${
          v ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-500"
        }`}
      />
    );
  };

  const renderRow = (a: AssignmentView) => {
    const m = margin(a);
    const tax = a.artistFee == null ? 0 : feeTaxAmountOf(a.artistFee, a.feeTaxMode);
    const deposit = Math.min(a.depositAmount ?? 0, a.artistFee ?? 0);
    const balance = balanceOf(a) ?? 0;
    const payout = derivePayoutStatus(a);
    return (
      <tr key={a.id} className="hover:bg-slate-50/60">
        <td className={`${td} font-semibold text-slate-900`}>{a.quoteName}</td>
        <td className={`${td} whitespace-nowrap`}>{label(PRODUCT_LABELS, a.quoteProduct) || "—"}</td>
        <td className={`${td} whitespace-nowrap`}>{a.artistName}</td>
        <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>{a.dueDate ?? "—"}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
          {a.clientAmount == null ? "—" : won(a.clientAmount)}
        </td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
          {a.artistFee == null ? "—" : won(a.artistFee)}
          {tax !== 0 && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              세금 {tax > 0 ? "+" : "−"}{formatWon(Math.abs(tax))}
            </p>
          )}
        </td>
        <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums ${m != null && m < 0 ? "text-red-600" : ""}`}>
          {m == null ? "—" : won(m)}
        </td>
        <td className={td}>{dateInput(a, "clientPaidAt", !canEditReceipt)}</td>
        <td className={td}>{dateInput(a, "depositPaidAt", deposit <= 0)}</td>
        <td className={td}>{dateInput(a, "balancePaidAt", balance <= 0)}</td>
        <td className={`${td} whitespace-nowrap`}>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PAYOUT_STATUS_COLORS[payout]}`}>
            {PAYOUT_STATUS_LABELS[payout]}
          </span>
        </td>
      </tr>
    );
  };

  const head = (
    <thead className="bg-slate-50">
      <tr>
        <th className={th}>고객</th>
        <th className={th}>제품</th>
        <th className={th}>아티스트</th>
        <th className={th}>납기</th>
        <th className={`${th} text-right`}>매출</th>
        <th className={`${th} text-right`}>작업비</th>
        <th className={`${th} text-right`}>마진</th>
        <th className={th}>수금일</th>
        <th className={th}>선금일</th>
        <th className={th}>잔금일</th>
        <th className={th}>상태</th>
      </tr>
    </thead>
  );

  return (
    <div>
      {/* 월 선택 — GET 폼이라 주소(?month=)가 곧 화면 상태다. 링크로 공유·북마크할 수 있다 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form method="get" className="flex items-center gap-2">
          <label htmlFor="settlement-month" className="text-sm text-slate-500">정산 월</label>
          <select
            id="settlement-month"
            name="month"
            defaultValue={month}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
          >
            {months.map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m)}</option>
            ))}
          </select>
          <noscript>
            <button type="submit" className="h-9 rounded-lg border border-slate-200 px-3 text-sm">보기</button>
          </noscript>
        </form>

        <span className="ml-auto text-sm text-slate-400">
          {summary.count}건
          {isPending && <span className="ml-2 text-slate-300">저장 중…</span>}
        </span>
        <button
          type="button"
          onClick={onDownload}
          disabled={liveRows.length === 0}
          className="h-9 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: "#1E22B2" }}
        >
          CSV 내려받기
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile title="매출(공급가)" value={won(summary.revenue)} sub={`${summary.count}건`} unit={unit} />
        {/* 부가세는 공급가가 아니므로 단위 줄을 따로 둔다 */}
        <Tile title="부가세" value={won(summary.revenueVat)} sub="부가세 청구분만" unit={`${monthLabel} · 매출 부가세 10%`} />
        <Tile
          title="작업비"
          value={won(summary.cost)}
          sub={summary.costTax === 0 ? "세금 가감 없음" : `세금 ${summary.costTax > 0 ? "+" : "−"}${formatWon(Math.abs(summary.costTax))}원`}
          unit={unit}
        />
        <Tile
          title="마진"
          value={won(summary.margin)}
          sub="매출 − 작업비"
          unit={unit}
          tone={summary.margin < 0 ? "warn" : "default"}
        />
        <Tile
          title="수금 / 미수"
          value={won(summary.received)}
          sub={`미수 ${won(summary.receivable)}`}
          unit={unit}
          tone={summary.receivable > 0 ? "warn" : summary.received > 0 ? "good" : "default"}
        />
        <Tile
          title="지급 / 미지급"
          value={won(summary.paidOut)}
          sub={`미지급 ${won(summary.unpaid)}`}
          unit={unit}
          tone={summary.unpaid > 0 ? "warn" : summary.paidOut > 0 ? "good" : "default"}
        />
      </div>

      <p className="mt-3 text-xs text-slate-500">
        월 귀속 기준 — 매출·작업비는 납기(없으면 배정 생성일)의 달, 수금은 수금일의 달,
        지급은 선금·잔금 지급일의 달입니다. 대시보드 &ldquo;이번 달 매출&rdquo;과 같은 기준입니다.
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          저장하지 못했습니다 — {error}
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full border-collapse">
          {head}
          <tbody>
            {liveRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-16 text-center text-slate-400">
                  {monthLabel}에 잡힌 배정이 없습니다. 납기가 이 달인 배정이 생기면 여기에 나옵니다.{" "}
                  <Link href="/admin/works" className="underline hover:text-slate-600">작업 관리</Link>
                </td>
              </tr>
            ) : (
              liveRows.map(renderRow)
            )}
          </tbody>
        </table>
      </div>

      {liveOther.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-bold text-slate-700">이 달에 수금·지급된 다른 달 배정</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            매출은 다른 달에 잡혀 있지만, 이 달 수금·지급 타일에는 포함된 건입니다.
          </p>
          <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full border-collapse">
              {head}
              <tbody>{liveOther.map(renderRow)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
