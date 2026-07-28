"use client";

/**
 * 작업 관리 보드 — 어떤 리드를 어떤 아티스트가 맡았고, 얼마나 진행됐으며,
 * 작업비·청구금액·납기·지급상태가 어떤지 한 화면에서 관리한다.
 *
 * 아티스트 "프로필"을 편집하는 /admin/artists 와는 목적이 다르다.
 * 여기서 다루는 단위는 사람이 아니라 배정(assignment) 한 건이다.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_COLORS,
  ASSIGNMENT_STATUS_LABELS,
  PAYOUT_STATUS_COLORS,
  PAYOUT_STATUS_LABELS,
  balanceOf,
  daysUntil,
  derivePayoutStatus,
  dueUrgency,
  formatWon,
  isActive,
  margin,
  unpaidFee,
  vatOf,
  withVat,
  type AssignmentStatus,
  type AssignmentView,
} from "@/lib/assignment-types";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";
import { createWork, updateWork, deleteWork } from "@/app/admin/works/actions";

export interface ArtistOption {
  id: string;
  name: string;
}

/** 아직 배정이 없는 리드 — 새 배정 모달의 선택지 */
export interface UnassignedLead {
  id: string;
  name: string;
  product: string;
  createdAt: string;
}

interface Props {
  works: AssignmentView[];
  artists: ArtistOption[];
  unassigned: UnassignedLead[];
}

/* 숫자 입력 → 원 단위 정수. 빈 값은 null(미입력) */
function parseWon(v: string): number | null {
  const digits = v.replace(/[^0-9-]/g, "");
  if (digits === "" || digits === "-") return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** 오늘 날짜 (YYYY-MM-DD, 로컬 기준) — toISOString 은 UTC 라 KST 에서 하루 밀린다 */
function todayISO(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** 공급가액 아래에 붙는 부가세·합계 안내 */
function VatHint({ supply }: { supply: number | null }) {
  if (supply == null) return <p className="mt-1 text-[11px] text-slate-300">부가세 —</p>;
  return (
    <p className="mt-1 text-[11px] text-slate-400 whitespace-nowrap">
      VAT {formatWon(vatOf(supply))} · 합계{" "}
      <b className="text-slate-500">{formatWon(withVat(supply))}</b>
    </p>
  );
}

function StatCard({
  title, value, hint, tone = "default",
}: {
  title: string; value: string; hint?: string;
  tone?: "default" | "warn" | "danger" | "good";
}) {
  const tones = {
    default: "border-slate-200 bg-white",
    good:    "border-emerald-200 bg-emerald-50",
    warn:    "border-amber-200 bg-amber-50",
    danger:  "border-red-200 bg-red-50",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * 선금·잔금 지급 토글 — 누르면 오늘 날짜를 찍고, 다시 누르면 지운다.
 * 날짜를 직접 고르게 하지 않는 이유는 "오늘 보냈다"가 실무의 거의 전부이기 때문.
 * (금액이 0이면 지급할 것이 없으므로 비활성)
 */
function PaidToggle({
  label, quoteName, paidAt, disabled, onToggle,
}: {
  label: string;
  quoteName: string;
  paidAt: string | null;
  disabled: boolean;
  onToggle: (next: string | null) => void;
}) {
  const paid = !!paidAt;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(paid ? null : todayISO())}
      title={paid ? `${paidAt} 지급 — 누르면 취소` : `${label} 지급 처리`}
      aria-label={`${quoteName} ${label} 지급 ${paid ? "취소" : "처리"}`}
      className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300 ${
        paid
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-slate-200 text-slate-500 hover:bg-slate-50"
      }`}
    >
      {paid ? "✓ 지급" : "미지급"}
    </button>
  );
}

/** D-day 표시 — 납기가 지났거나 임박하면 색으로 알린다 */
function DueBadge({ work }: { work: AssignmentView }) {
  if (!work.dueDate) return <span className="text-slate-300">—</span>;
  const d = daysUntil(work.dueDate);
  const urgency = dueUrgency(work);
  const cls =
    urgency === "overdue" ? "text-red-600 font-bold"
    : urgency === "soon"  ? "text-amber-600 font-semibold"
    : "text-slate-600";
  const dday =
    d == null ? "" : d === 0 ? "D-DAY" : d > 0 ? `D-${d}` : `D+${Math.abs(d)}`;
  return (
    <span className={`whitespace-nowrap ${cls}`}>
      {work.dueDate}
      <span className="ml-1.5 text-xs">{dday}</span>
    </span>
  );
}

export default function WorksBoard({ works, artists, unassigned }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [artistFilter, setArtistFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AssignmentStatus>("all");
  const [lateOnly, setLateOnly] = useState(false);
  const [showNew, setShowNew] = useState(false);

  /* 편집 중인 값 — 저장 전까지 로컬에 두고, 저장 시 서버로 보낸다.
     드롭다운·진행률처럼 즉시 반영해야 자연스러운 것은 바로 저장한다. */
  const [draft, setDraft] = useState<Record<string, Partial<AssignmentView>>>({});
  const val = <K extends keyof AssignmentView>(w: AssignmentView, key: K): AssignmentView[K] =>
    (draft[w.id]?.[key] ?? w[key]) as AssignmentView[K];
  const setDraftValue = <K extends keyof AssignmentView>(
    id: string, key: K, value: AssignmentView[K]
  ) => setDraft((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));
  const dirty = (id: string) => Object.keys(draft[id] ?? {}).length > 0;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else after?.();
    });
  };

  const saveRow = (w: AssignmentView) => {
    const d = draft[w.id];
    if (!d) return;
    run(
      () =>
        updateWork(w.id, {
          status: d.status,
          progress: d.progress,
          artistFee: d.artistFee,
          clientAmount: d.clientAmount,
          depositAmount: d.depositAmount,
          depositPaidAt: d.depositPaidAt,
          balancePaidAt: d.balancePaidAt,
          dueDate: d.dueDate,
          memo: d.memo,
        }),
      () => setDraft((s) => {
        const next = { ...s };
        delete next[w.id];
        return next;
      })
    );
  };

  /* ── 필터 ── */
  const rows = useMemo(
    () =>
      works.filter((w) => {
        if (artistFilter !== "all" && w.artistId !== artistFilter) return false;
        if (statusFilter !== "all" && w.status !== statusFilter) return false;
        if (lateOnly && dueUrgency(w) === "none") return false;
        return true;
      }),
    [works, artistFilter, statusFilter, lateOnly]
  );

  /* ── 요약 지표 (필터와 무관하게 전체 기준) ──
     금액은 전부 공급가액으로 저장돼 있으므로, 합산한 뒤 부가세를 얹어 보여준다. */
  const stats = useMemo(() => {
    const active = works.filter(isActive);
    const thisMonth = todayISO().slice(0, 7); // 로컬(KST) 기준 YYYY-MM
    const monthly = works.filter(
      (w) =>
        w.status !== "cancelled" &&
        (w.dueDate ?? w.createdAt).slice(0, 7) === thisMonth
    );
    // 이번 달 매출 — 공급가액 합계에서 부가세·총액을 파생
    const revenueSupply = monthly.reduce((sum, w) => sum + (w.clientAmount ?? 0), 0);
    const revenueVat = vatOf(revenueSupply) ?? 0;
    const revenueTotal = revenueSupply + revenueVat;
    // 미지급 작업비 — 선금/잔금 중 아직 안 나간 금액만 (실제 송금액이라 VAT 포함)
    const unpaidSupply = works
      .filter((w) => w.status !== "cancelled")
      .reduce((sum, w) => sum + unpaidFee(w), 0);
    const urgent = works.filter((w) => dueUrgency(w) !== "none");
    const overdue = urgent.filter((w) => dueUrgency(w) === "overdue").length;
    return {
      activeCount: active.length,
      revenueSupply,
      revenueVat,
      revenueTotal,
      monthlyCount: monthly.length,
      unpaidSupply,
      unpaidTotal: withVat(unpaidSupply) ?? 0,
      urgent: urgent.length,
      overdue,
    };
  }, [works]);

  /* ── 아티스트별 부하 ── */
  const load = useMemo(() => {
    return artists
      .map((a) => {
        const mine = works.filter((w) => w.artistId === a.id);
        const active = mine.filter(isActive);
        const unpaidSum = mine
          .filter((w) => w.status !== "cancelled")
          .reduce((s, w) => s + unpaidFee(w), 0);
        const billed = mine
          .filter((w) => w.status !== "cancelled")
          .reduce((s, w) => s + (w.clientAmount ?? 0), 0);
        const nextDue = active
          .map((w) => w.dueDate)
          .filter((d): d is string => !!d)
          .sort()[0] ?? null;
        return { artist: a, activeCount: active.length, unpaidSum, billed, nextDue };
      })
      .filter((l) => l.activeCount > 0 || l.billed > 0 || l.unpaidSum > 0)
      .sort((x, y) => y.activeCount - x.activeCount);
  }, [artists, works]);

  const th = "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap border-b border-slate-200";
  const td = "px-3 py-2.5 text-sm text-slate-700 align-top border-b border-slate-100";
  const input = "w-full rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400";

  return (
    <div>
      {/* ── 요약 ── */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="진행중 작업" value={`${stats.activeCount}건`} hint="배정·작업중·검수" />
        <StatCard
          title="이번 달 총 매출 (프로젝트 총액)"
          value={`${formatWon(stats.revenueTotal)}원`}
          hint={`공급가 ${formatWon(stats.revenueSupply)} + VAT ${formatWon(stats.revenueVat)} · ${stats.monthlyCount}건 (납기 기준, 취소 제외)`}
        />
        <StatCard
          title="미지급 작업비"
          value={`${formatWon(stats.unpaidTotal)}원`}
          hint={`공급가 ${formatWon(stats.unpaidSupply)} + VAT · 선금·잔금 미지급분`}
          tone={stats.unpaidSupply > 0 ? "warn" : "default"}
        />
        <StatCard
          title="납기 임박·초과"
          value={`${stats.urgent}건`}
          hint={stats.overdue > 0 ? `이 중 ${stats.overdue}건 기한 초과` : "D-7 이내"}
          tone={stats.overdue > 0 ? "danger" : stats.urgent > 0 ? "warn" : "good"}
        />
      </div>

      {/* ── 아티스트별 부하 ── */}
      {load.length > 0 && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-bold text-slate-900">아티스트별 부하</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {load.map((l) => (
              <button
                key={l.artist.id}
                onClick={() => setArtistFilter(artistFilter === l.artist.id ? "all" : l.artist.id)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  artistFilter === l.artist.id
                    ? "border-[#1E22B2] bg-[#F0F2FF]"
                    : l.activeCount >= 3
                      ? "border-amber-200 bg-amber-50 hover:bg-amber-100"
                      : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-slate-900">{l.artist.name}</span>
                  <span className={`text-sm font-bold ${l.activeCount >= 3 ? "text-amber-700" : "text-slate-600"}`}>
                    진행 {l.activeCount}건
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  매출 {formatWon(withVat(l.billed))}원 · 미지급 {formatWon(withVat(l.unpaidSum))}원
                  <span className="ml-1 text-slate-400">(VAT 포함)</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {l.nextDue ? `가장 임박한 납기 ${l.nextDue}` : "예정된 납기 없음"}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 툴바 ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={artistFilter}
          onChange={(e) => setArtistFilter(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-400"
        >
          <option value="all">아티스트 전체</option>
          {artists.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | AssignmentStatus)}
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-400"
        >
          <option value="all">상태 전체</option>
          {ASSIGNMENT_STATUSES.map((s) => (
            <option key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={lateOnly}
            onChange={(e) => setLateOnly(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#1E22B2]"
          />
          납기 임박·초과만
        </label>

        <button
          onClick={() => setShowNew(true)}
          className="ml-auto h-9 rounded-lg px-4 text-sm font-semibold text-white"
          style={{ background: "#1E22B2" }}
        >
          + 새 배정
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── 배정 테이블 ── */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>리드</th>
              <th className={th}>아티스트</th>
              <th className={th}>상태</th>
              <th className={`${th} w-40`}>진행률</th>
              <th className={th}>작업비 (원가)</th>
              <th className={th}>매출</th>
              <th className={th}>마진</th>
              <th className={`${th} w-64`}>지급 (선금·잔금)</th>
              <th className={th}>납기</th>
              <th className={`${th} w-56`}>메모</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-16 text-center text-slate-400">
                  {works.length === 0
                    ? "아직 배정된 작업이 없습니다. 오른쪽 위 “+ 새 배정”으로 시작하세요."
                    : "조건에 맞는 작업이 없습니다."}
                </td>
              </tr>
            ) : (
              rows.map((w) => {
                const fee = val(w, "artistFee");
                const amount = val(w, "clientAmount");
                const m = margin({ artistFee: fee, clientAmount: amount });
                const progress = val(w, "progress");
                const status = val(w, "status");
                /* 지급은 선금/잔금에서 파생 — 편집 중인 값 기준으로 즉시 다시 계산한다 */
                const deposit = val(w, "depositAmount");
                const depositPaidAt = val(w, "depositPaidAt");
                const balancePaidAt = val(w, "balancePaidAt");
                const payoutParts = {
                  artistFee: fee,
                  depositAmount: deposit,
                  depositPaidAt,
                  balancePaidAt,
                };
                const balance = balanceOf({ artistFee: fee, depositAmount: deposit });
                const payout = derivePayoutStatus(payoutParts);
                const remaining = unpaidFee(payoutParts);
                return (
                  <tr key={w.id} className="hover:bg-slate-50/60">
                    <td className={td}>
                      <Link href="/admin/quotes" className="font-semibold text-slate-900 hover:underline">
                        {w.quoteName}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {label(PRODUCT_LABELS, w.quoteProduct) || "제품 미정"}
                      </p>
                    </td>
                    <td className={`${td} whitespace-nowrap font-medium`}>{w.artistName}</td>
                    <td className={td}>
                      <select
                        value={status}
                        onChange={(e) => setDraftValue(w.id, "status", e.target.value as AssignmentStatus)}
                        aria-label={`${w.quoteName} 작업 상태`}
                        className={`cursor-pointer rounded-full border px-2 py-1 text-xs font-semibold outline-none ${ASSIGNMENT_STATUS_COLORS[status]}`}
                      >
                        {ASSIGNMENT_STATUSES.map((s) => (
                          <option key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={progress}
                          onChange={(e) => setDraftValue(w.id, "progress", Number(e.target.value))}
                          aria-label={`${w.quoteName} 진행률`}
                          className="w-20 accent-[#1E22B2]"
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={progress}
                          onChange={(e) => setDraftValue(w.id, "progress", Number(e.target.value))}
                          className="w-14 rounded-lg border border-slate-200 px-1.5 py-0.5 text-right text-sm outline-none focus:border-slate-400"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "#1E22B2" }} />
                      </div>
                    </td>
                    <td className={td}>
                      <input
                        value={fee == null ? "" : fee.toLocaleString("ko-KR")}
                        onChange={(e) => setDraftValue(w.id, "artistFee", parseWon(e.target.value))}
                        placeholder="공급가액"
                        inputMode="numeric"
                        aria-label={`${w.quoteName} 작업비 공급가액`}
                        className={`${input} w-28 text-right`}
                      />
                      <VatHint supply={fee} />
                    </td>
                    <td className={td}>
                      <input
                        value={amount == null ? "" : amount.toLocaleString("ko-KR")}
                        onChange={(e) => setDraftValue(w.id, "clientAmount", parseWon(e.target.value))}
                        placeholder="공급가액"
                        inputMode="numeric"
                        aria-label={`${w.quoteName} 매출 공급가액`}
                        className={`${input} w-28 text-right`}
                      />
                      <VatHint supply={amount} />
                    </td>
                    <td className={`${td} whitespace-nowrap text-right font-semibold ${m != null && m < 0 ? "text-red-600" : "text-slate-700"}`}>
                      {m == null ? "—" : `${formatWon(m)}원`}
                      {m != null && (
                        <p className="mt-1 text-[11px] font-normal text-slate-400">공급가 기준</p>
                      )}
                    </td>
                    <td className={td}>
                      {/* 선금 — 금액 직접 입력, 잔금은 작업비에서 자동 계산 */}
                      <div className="flex items-center gap-1.5">
                        <span className="w-7 flex-shrink-0 text-[11px] font-semibold text-slate-400">선금</span>
                        <input
                          value={deposit == null ? "" : deposit.toLocaleString("ko-KR")}
                          onChange={(e) => setDraftValue(w.id, "depositAmount", parseWon(e.target.value))}
                          placeholder="0"
                          inputMode="numeric"
                          aria-label={`${w.quoteName} 선금 공급가액`}
                          className={`${input} w-24 text-right`}
                        />
                        <PaidToggle
                          label="선금"
                          quoteName={w.quoteName}
                          paidAt={depositPaidAt}
                          disabled={(deposit ?? 0) <= 0}
                          onToggle={(next) => setDraftValue(w.id, "depositPaidAt", next)}
                        />
                      </div>

                      {/* 잔금 — 작업비 − 선금 */}
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="w-7 flex-shrink-0 text-[11px] font-semibold text-slate-400">잔금</span>
                        <span className="w-24 rounded-lg bg-slate-50 px-2 py-1 text-right text-sm tabular-nums text-slate-600">
                          {balance == null ? "—" : formatWon(balance)}
                        </span>
                        <PaidToggle
                          label="잔금"
                          quoteName={w.quoteName}
                          paidAt={balancePaidAt}
                          disabled={(balance ?? 0) <= 0}
                          onToggle={(next) => setDraftValue(w.id, "balancePaidAt", next)}
                        />
                      </div>

                      {/* 상태 배지 + 실제 송금 기준(VAT 포함) 잔여 */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PAYOUT_STATUS_COLORS[payout]}`}>
                          {PAYOUT_STATUS_LABELS[payout]}
                        </span>
                        {remaining > 0 && (
                          <span className="text-[11px] text-slate-400 whitespace-nowrap">
                            잔여 {formatWon(withVat(remaining))}원 (VAT 포함)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={td}>
                      <input
                        type="date"
                        value={val(w, "dueDate") ?? ""}
                        onChange={(e) => setDraftValue(w.id, "dueDate", e.target.value || null)}
                        aria-label={`${w.quoteName} 납품 기한`}
                        className={`${input} w-36`}
                      />
                      <div className="mt-1 text-xs">
                        <DueBadge work={{ ...w, dueDate: val(w, "dueDate"), status }} />
                      </div>
                    </td>
                    <td className={td}>
                      <textarea
                        rows={2}
                        value={val(w, "memo")}
                        onChange={(e) => setDraftValue(w.id, "memo", e.target.value)}
                        placeholder="작업 상황 메모"
                        aria-label={`${w.quoteName} 메모`}
                        className={`${input} resize-y`}
                      />
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      <button
                        onClick={() => saveRow(w)}
                        disabled={!dirty(w.id) || isPending}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200"
                        style={dirty(w.id) && !isPending ? { background: "#1E22B2" } : {}}
                      >
                        저장
                      </button>
                      <button
                        onClick={() => run(() => deleteWork(w.id))}
                        className="mt-1 block w-full rounded-lg px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewWorkModal
          artists={artists}
          leads={unassigned}
          pending={isPending}
          onClose={() => setShowNew(false)}
          onSubmit={(payload) => run(() => createWork(payload), () => setShowNew(false))}
        />
      )}
    </div>
  );
}

/* ─── 새 배정 모달 ─── */
function NewWorkModal({
  artists, leads, pending, onClose, onSubmit,
}: {
  artists: ArtistOption[];
  leads: UnassignedLead[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (p: {
    quoteId: string; artistId: string;
    artistFee: number | null; clientAmount: number | null;
    depositAmount: number | null;
    dueDate: string | null; memo: string;
  }) => void;
}) {
  const [quoteId, setQuoteId] = useState("");
  const [artistId, setArtistId] = useState("");
  const [fee, setFee] = useState("");
  const [amount, setAmount] = useState("");
  const [deposit, setDeposit] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [memo, setMemo] = useState("");

  const feeWon = parseWon(fee);
  const amountWon = parseWon(amount);
  const depositWon = parseWon(deposit);
  const depositTooBig = feeWon != null && depositWon != null && depositWon > feeWon;

  const field = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400";
  const lbl = "mb-1 block text-xs font-bold text-slate-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-slate-900">새 배정</h2>

        <div className="space-y-3">
          <div>
            <label className={lbl}>리드 (미배정 제작 문의)</label>
            <select value={quoteId} onChange={(e) => setQuoteId(e.target.value)} className={field}>
              <option value="">선택하세요</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} · {label(PRODUCT_LABELS, l.product) || "제품 미정"} ({l.createdAt.slice(0, 10)})
                </option>
              ))}
            </select>
            {leads.length === 0 && (
              <p className="mt-1 text-xs text-slate-400">배정 가능한 리드가 없습니다.</p>
            )}
          </div>

          <div>
            <label className={lbl}>아티스트</label>
            <select value={artistId} onChange={(e) => setArtistId(e.target.value)} className={field}>
              <option value="">선택하세요</option>
              {artists.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>작업비 · 원가 (공급가액)</label>
              <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" placeholder="예: 1500000" className={field} />
              <VatHint supply={feeWon} />
            </div>
            <div>
              <label className={lbl}>매출 (공급가액)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="예: 2500000" className={field} />
              <VatHint supply={amountWon} />
            </div>
          </div>

          <div>
            <label className={lbl}>선금 (공급가액, 선택)</label>
            <input
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              inputMode="numeric"
              placeholder="비워두면 잔금 일괄 지급"
              className={field}
            />
            {depositTooBig ? (
              <p className="mt-1 text-xs text-red-600">선금이 작업비보다 클 수 없습니다.</p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400">
                잔금 {feeWon == null ? "—" : formatWon(Math.max(0, feeWon - (depositWon ?? 0)))}원
                {" · "}금액은 모두 부가세 별도(공급가액)로 입력합니다.
              </p>
            )}
          </div>

          <div>
            <label className={lbl}>납품 기한</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={field} />
          </div>

          <div>
            <label className={lbl}>메모</label>
            <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} className={`${field} resize-y`} />
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
            취소
          </button>
          <button
            disabled={!quoteId || !artistId || pending || depositTooBig}
            onClick={() =>
              onSubmit({
                quoteId, artistId,
                artistFee: feeWon,
                clientAmount: amountWon,
                depositAmount: depositWon,
                dueDate: dueDate || null,
                memo,
              })
            }
            className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200"
            style={quoteId && artistId && !pending && !depositTooBig ? { background: "#1E22B2" } : {}}
          >
            배정하기
          </button>
        </div>
      </div>
    </div>
  );
}
