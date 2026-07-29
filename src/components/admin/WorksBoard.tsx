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
  OFFER_STATUS_COLORS,
  OFFER_STATUS_LABELS,
  PAYOUT_STATUS_COLORS,
  PAYOUT_STATUS_LABELS,
  FEE_TAX_MODES,
  FEE_TAX_LABELS,
  balanceOf,
  daysUntil,
  derivePayoutStatus,
  dueUrgency,
  feeNetOf,
  feeTaxAmountOf,
  formatWon,
  isActive,
  margin,
  unpaidFee,
  vatOf,
  withVat,
  type AssignmentStatus,
  type AssignmentView,
  type FeeTaxMode,
} from "@/lib/assignment-types";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";
import {
  createWork,
  updateWork,
  deleteWork,
  sendOffer,
  withdrawOffer,
} from "@/app/admin/works/actions";

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

/**
 * 매출 부가세 토글 — 켠 경우에만 10% 를 더해 청구한다.
 * (부가세는 내 돈이 아니라 나중에 납부할 돈이라 매출·마진 집계에는 넣지 않는다)
 */
function VatToggle({
  on, amount, quoteName, onToggle,
}: {
  on: boolean;
  amount: number | null;
  quoteName: string;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => onToggle(!on)}
        aria-pressed={on}
        aria-label={`${quoteName} 매출 부가세 ${on ? "제외" : "포함"}`}
        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
          on
            ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            : "border-slate-200 text-slate-400 hover:bg-slate-50"
        }`}
      >
        {on ? "✓ VAT 포함" : "VAT 포함"}
      </button>
      {on && amount != null && (
        <p className="mt-1 text-[11px] text-slate-400 whitespace-nowrap">
          +VAT {formatWon(vatOf(amount))} · 청구{" "}
          <b className="text-slate-500">{formatWon(withVat(amount))}</b>
        </p>
      )}
    </div>
  );
}

/** 작업비 세금 처리(사업자 +VAT / 프리랜서 −3.3% / 없음) 선택 + 실지급액 안내 */
function FeeTaxPicker({
  mode, amount, quoteName, onChange,
}: {
  mode: FeeTaxMode;
  amount: number | null;
  quoteName: string;
  onChange: (next: FeeTaxMode) => void;
}) {
  const net = feeNetOf(amount, mode);
  const diff = feeTaxAmountOf(amount, mode);
  return (
    <div className="mt-1">
      <select
        value={mode}
        onChange={(e) => onChange(e.target.value as FeeTaxMode)}
        aria-label={`${quoteName} 작업비 세금 처리`}
        className={`w-28 cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-semibold outline-none ${
          mode === "withholding"
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : mode === "vat"
              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
              : "border-slate-200 text-slate-400"
        }`}
      >
        {FEE_TAX_MODES.map((m) => (
          <option key={m} value={m}>{FEE_TAX_LABELS[m]}</option>
        ))}
      </select>
      {mode !== "none" && amount != null && (
        <p className="mt-1 text-[11px] text-slate-400 whitespace-nowrap">
          {diff >= 0 ? "+" : "−"}
          {formatWon(Math.abs(diff))} · 실지급 <b className="text-slate-500">{formatWon(net)}</b>
        </p>
      )}
    </div>
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
 * 선금·잔금 지급일 — 날짜를 넣으면 그날 지급된 것으로 본다(비우면 미지급).
 * 언제 나갔는지가 정산에서 중요하므로 날짜 자체를 기록·수정할 수 있게 한다.
 * "오늘" 버튼은 방금 송금한 흔한 경우를 한 번에 처리하기 위한 지름길.
 */
function PaidDate({
  label, quoteName, paidAt, disabled, onChange,
}: {
  label: string;
  quoteName: string;
  paidAt: string | null;
  disabled: boolean;
  onChange: (next: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        value={paidAt ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={`${quoteName} ${label} 지급일`}
        className={`w-32 rounded-lg border px-1.5 py-0.5 text-xs outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300 ${
          paidAt ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-500"
        }`}
      />
      {!paidAt && !disabled && (
        <button
          type="button"
          onClick={() => onChange(todayISO())}
          aria-label={`${quoteName} ${label} 오늘 지급 처리`}
          className="flex-shrink-0 rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50"
        >
          오늘
        </button>
      )}
    </div>
  );
}

/**
 * 제안 셀 — 이 배정을 아티스트 포털에 노출하고 응답을 기다릴지 조작한다.
 *
 * 아티스트는 draft 를 아예 보지 못한다. 그래서 "제안 보내기"를 누르는 순간이
 * 곧 아티스트에게 업무가 보이기 시작하는 시점이다.
 * 작업비가 비어 있으면 보낼 수 없다 — 판단 근거 없이 수락/거절을 시킬 수는 없다.
 */
function OfferCell({
  work,
  feeReady,
  pending,
  onSend,
  onWithdraw,
}: {
  work: AssignmentView;
  feeReady: boolean;
  pending: boolean;
  onSend: () => void;
  onWithdraw: () => void;
}) {
  const responded = work.respondedAt?.slice(0, 10);
  return (
    <div className="min-w-[7.5rem]">
      <span
        className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
          OFFER_STATUS_COLORS[work.offerStatus]
        }`}
      >
        {OFFER_STATUS_LABELS[work.offerStatus]}
      </span>

      {work.offerStatus === "draft" && (
        <button
          onClick={onSend}
          disabled={pending || !feeReady}
          title={feeReady ? undefined : "작업비를 저장해야 제안할 수 있습니다"}
          className="mt-1.5 block w-full rounded-lg px-2 py-1 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200"
          style={!pending && feeReady ? { background: "#1E22B2" } : {}}
        >
          제안 보내기
        </button>
      )}

      {work.offerStatus === "offered" && (
        <>
          <p className="mt-1 text-[11px] text-slate-400">
            {work.offeredAt?.slice(0, 10)} 발송
          </p>
          <button
            onClick={onWithdraw}
            disabled={pending}
            className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            회수
          </button>
        </>
      )}

      {work.offerStatus === "accepted" && responded && (
        <p className="mt-1 text-[11px] text-slate-400">{responded} 수락</p>
      )}

      {work.offerStatus === "declined" && (
        <>
          <p className="mt-1 text-[11px] text-red-500">{responded} 거절</p>
          {work.declineReason && (
            <p className="mt-0.5 text-[11px] text-slate-400">{work.declineReason}</p>
          )}
          <button
            onClick={onSend}
            disabled={pending || !feeReady}
            className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            다시 제안
          </button>
        </>
      )}
    </div>
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
          feeTaxMode: d.feeTaxMode,
          clientVat: d.clientVat,
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
     구조: 내가 프로젝트를 수주(매출)하고 아티스트에게 하청(작업비)을 준다.
           매출 − 작업비 = 내 마진. 부가세는 나중에 납부할 돈이라 어느 쪽에도 더하지 않는다. */
  const stats = useMemo(() => {
    const active = works.filter(isActive);
    const live = works.filter((w) => w.status !== "cancelled");
    const thisMonth = todayISO().slice(0, 7); // 로컬(KST) 기준 YYYY-MM

    // 총 매출 = 매출 열에 입력된 금액의 단순 합계 (부가세 제외)
    const revenue = live.reduce((sum, w) => sum + (w.clientAmount ?? 0), 0);
    // 총 작업비 = 아티스트에게 나가는 하청 원가 (세전)
    const cost = live.reduce((sum, w) => sum + (w.artistFee ?? 0), 0);
    const monthlyRevenue = live
      .filter((w) => (w.dueDate ?? w.createdAt).slice(0, 7) === thisMonth)
      .reduce((sum, w) => sum + (w.clientAmount ?? 0), 0);

    // 미지급 작업비 — 아직 안 나간 회차만, 실제 송금액(세금 처리 반영) 기준
    const unpaidNet = live.reduce((sum, w) => {
      const remain = unpaidFee(w);
      return sum + (feeNetOf(remain, w.feeTaxMode) ?? 0);
    }, 0);

    const urgent = works.filter((w) => dueUrgency(w) !== "none");
    const overdue = urgent.filter((w) => dueUrgency(w) === "overdue").length;
    return {
      activeCount: active.length,
      revenue,
      cost,
      margin: revenue - cost,
      monthlyRevenue,
      projectCount: live.length,
      unpaidNet,
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
        /* 아티스트 기준 지표는 "내가 이 사람에게 줄 돈" — 매출이 아니라 작업비다 */
        const unpaidSum = mine
          .filter((w) => w.status !== "cancelled")
          .reduce((s, w) => s + (feeNetOf(unpaidFee(w), w.feeTaxMode) ?? 0), 0);
        const billed = mine
          .filter((w) => w.status !== "cancelled")
          .reduce((s, w) => s + (w.artistFee ?? 0), 0);
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
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard title="진행중 작업" value={`${stats.activeCount}건`} hint="배정·작업중·검수" />
        <StatCard
          title="총 매출 (프로젝트 총액)"
          value={`${formatWon(stats.revenue)}원`}
          hint={`부가세 제외 · ${stats.projectCount}건 · 이번 달 납기 ${formatWon(stats.monthlyRevenue)}원`}
        />
        <StatCard
          title="총 마진"
          value={`${formatWon(stats.margin)}원`}
          hint={`매출 − 작업비 ${formatWon(stats.cost)} (부가세 제외)`}
          tone={stats.margin < 0 ? "danger" : "good"}
        />
        <StatCard
          title="미지급 작업비"
          value={`${formatWon(stats.unpaidNet)}원`}
          hint="선금·잔금 미지급분 · 실지급 기준"
          tone={stats.unpaidNet > 0 ? "warn" : "default"}
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
                  작업비 {formatWon(l.billed)}원 · 미지급 {formatWon(l.unpaidSum)}원
                  <span className="ml-1 text-slate-400">(실지급 기준)</span>
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
              <th className={th}>제안</th>
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
                <td colSpan={12} className="px-4 py-16 text-center text-slate-400">
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
                const feeTaxMode = val(w, "feeTaxMode");
                const clientVat = val(w, "clientVat");
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
                      {/* 제안 가능 여부는 **저장된** 작업비로 판단한다 —
                          입력만 하고 저장하지 않은 값으로 보내면 아티스트가
                          빈 금액을 보게 된다 */}
                      <OfferCell
                        work={w}
                        feeReady={w.artistFee != null}
                        pending={isPending}
                        onSend={() => run(() => sendOffer(w.id))}
                        onWithdraw={() => run(() => withdrawOffer(w.id))}
                      />
                    </td>
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
                        aria-label={`${w.quoteName} 작업비`}
                        className={`${input} w-28 text-right`}
                      />
                      <FeeTaxPicker
                        mode={feeTaxMode}
                        amount={fee}
                        quoteName={w.quoteName}
                        onChange={(next) => setDraftValue(w.id, "feeTaxMode", next)}
                      />
                    </td>
                    <td className={td}>
                      <input
                        value={amount == null ? "" : amount.toLocaleString("ko-KR")}
                        onChange={(e) => setDraftValue(w.id, "clientAmount", parseWon(e.target.value))}
                        placeholder="—"
                        inputMode="numeric"
                        aria-label={`${w.quoteName} 매출`}
                        className={`${input} w-28 text-right`}
                      />
                      <VatToggle
                        on={clientVat}
                        amount={amount}
                        quoteName={w.quoteName}
                        onToggle={(next) => setDraftValue(w.id, "clientVat", next)}
                      />
                    </td>
                    <td className={`${td} whitespace-nowrap text-right font-semibold ${m != null && m < 0 ? "text-red-600" : "text-slate-700"}`}>
                      {m == null ? "—" : `${formatWon(m)}원`}
                      {m != null && (
                        <p className="mt-1 text-[11px] font-normal text-slate-400">공급가 기준</p>
                      )}
                    </td>
                    <td className={td}>
                      {/* 선금 — 금액 + 지급일. 잔금은 작업비 − 선금으로 자동 계산 */}
                      <div className="flex items-center gap-1.5">
                        <span className="w-7 flex-shrink-0 text-[11px] font-semibold text-slate-400">선금</span>
                        <input
                          value={deposit == null ? "" : deposit.toLocaleString("ko-KR")}
                          onChange={(e) => setDraftValue(w.id, "depositAmount", parseWon(e.target.value))}
                          placeholder="0"
                          inputMode="numeric"
                          aria-label={`${w.quoteName} 선금`}
                          className={`${input} w-24 text-right`}
                        />
                        <PaidDate
                          label="선금"
                          quoteName={w.quoteName}
                          paidAt={depositPaidAt}
                          disabled={(deposit ?? 0) <= 0}
                          onChange={(next) => setDraftValue(w.id, "depositPaidAt", next)}
                        />
                      </div>

                      {/* 잔금 — 작업비 − 선금 */}
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="w-7 flex-shrink-0 text-[11px] font-semibold text-slate-400">잔금</span>
                        <span className="w-24 rounded-lg bg-slate-50 px-2 py-1 text-right text-sm tabular-nums text-slate-600">
                          {balance == null ? "—" : formatWon(balance)}
                        </span>
                        <PaidDate
                          label="잔금"
                          quoteName={w.quoteName}
                          paidAt={balancePaidAt}
                          disabled={(balance ?? 0) <= 0}
                          onChange={(next) => setDraftValue(w.id, "balancePaidAt", next)}
                        />
                      </div>

                      {/* 상태 배지 + 남은 실지급액(세금 처리 반영) */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PAYOUT_STATUS_COLORS[payout]}`}>
                          {PAYOUT_STATUS_LABELS[payout]}
                        </span>
                        {remaining > 0 && (
                          <span className="text-[11px] text-slate-400 whitespace-nowrap">
                            남은 실지급 {formatWon(feeNetOf(remaining, feeTaxMode))}원
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
    feeTaxMode: FeeTaxMode; clientVat: boolean;
    dueDate: string | null; memo: string;
    sendOffer: boolean;
  }) => void;
}) {
  const [quoteId, setQuoteId] = useState("");
  const [artistId, setArtistId] = useState("");
  const [fee, setFee] = useState("");
  const [amount, setAmount] = useState("");
  const [deposit, setDeposit] = useState("");
  const [feeTaxMode, setFeeTaxMode] = useState<FeeTaxMode>("none");
  const [clientVat, setClientVat] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [memo, setMemo] = useState("");
  /* 기본은 "바로 제안" — 조건을 다 채워 만드는 경우가 대부분이라 여기서
     한 번에 끝내는 게 자연스럽다. 조건을 더 다듬을 때만 꺼서 미제안으로 둔다. */
  const [offerNow, setOfferNow] = useState(true);

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
              <label className={lbl}>작업비 · 아티스트 지급 (세전)</label>
              <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" placeholder="예: 1500000" className={field} />
              <FeeTaxPicker
                mode={feeTaxMode}
                amount={feeWon}
                quoteName="새 배정"
                onChange={setFeeTaxMode}
              />
            </div>
            <div>
              <label className={lbl}>매출 · 내 수주액</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="예: 2500000" className={field} />
              <VatToggle
                on={clientVat}
                amount={amountWon}
                quoteName="새 배정"
                onToggle={setClientVat}
              />
            </div>
          </div>

          {feeWon != null && amountWon != null && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              마진 <b className="text-slate-900">{formatWon(amountWon - feeWon)}원</b>
              <span className="text-slate-400"> = 매출 − 작업비 (부가세 제외)</span>
            </p>
          )}

          <div>
            <label className={lbl}>선금 (세전, 선택)</label>
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
                {" · "}금액은 세전 기준으로 입력하고, 세금은 위 버튼으로 켠 경우에만 계산합니다.
              </p>
            )}
          </div>

          <div>
            <label className={lbl}>납품 기한</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={field} />
          </div>

          <div>
            <label className={lbl}>메모 (아티스트에게 전달됩니다)</label>
            <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} className={`${field} resize-y`} />
          </div>

          <label
            className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${
              offerNow ? "border-[#1E22B2] bg-[#F0F2FF]" : "border-slate-200"
            }`}
          >
            <input
              type="checkbox"
              checked={offerNow}
              onChange={(e) => setOfferNow(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#1E22B2]"
            />
            <span className="text-sm">
              <b className="text-slate-800">바로 제안 보내기</b>
              <span className="mt-0.5 block text-xs text-slate-500">
                {offerNow
                  ? "아티스트 포털에 바로 표시되고, 수락/거절 응답을 기다립니다."
                  : "미제안 상태로 만듭니다. 아티스트에게는 보이지 않습니다."}
              </span>
            </span>
          </label>

          {offerNow && feeWon == null && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              작업비를 입력해야 제안할 수 있습니다. 비워 두면 미제안으로 만들어집니다.
            </p>
          )}
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
                feeTaxMode,
                clientVat,
                dueDate: dueDate || null,
                memo,
                // 작업비 없이 제안하면 아티스트가 판단할 근거가 없다 — 미제안으로 만든다
                sendOffer: offerNow && feeWon != null,
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
