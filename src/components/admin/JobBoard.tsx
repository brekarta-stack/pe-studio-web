"use client";

/**
 * 작업 공고 보드 — 문의 한 건에 카드 한 장 (docs/job-board-plan.md).
 *
 * 카드에서 하는 일: 견적가·작업비·마감일·전달 메모를 적고 공고로 올리기 / 내리기,
 * 관리자(오세기)로 가져가기, 가져간 건의 회수·캘린더 재시도.
 * 입력 칸이 많고 메모가 길어 표가 아니라 카드로 둔다.
 */

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { STAGE_COLORS, STAGE_LABELS, ASSIGNMENT_STATUS_LABELS, formatWon, type AssignmentStatus, type QuoteStage } from "@/lib/assignment-types";
import {
  ADMIN_WORKER,
  JOB_STATUS_COLORS,
  JOB_STATUS_LABELS,
  feeBreakdown,
  parseWon,
  type JobPosting,
  type JobStatus,
} from "@/lib/job-board-types";
import {
  claimJobAsAdmin,
  closeJobPosting,
  releaseJob,
  retryJobCalendar,
  saveJobPosting,
  type JobActionResult,
} from "@/app/admin/jobs/actions";

export interface JobRow {
  quoteId: string;
  customer: string;
  product: string;
  quantity: string;
  deliveryDate: string;
  createdAt: string;
  stage: QuoteStage;
  dropped: boolean;
  /** 연결된 최근 견적서 공급가액 — 견적가 칸의 기본값 */
  estimateSupply: number | null;
  posting: JobPosting | null;
  claimedByName: string | null;
  assignmentStatus: AssignmentStatus | null;
  assignmentProgress: number | null;
}

type Filter = "all" | JobStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "draft", label: "미공고" },
  { key: "open", label: "공고 중" },
  { key: "claimed", label: "배정됨" },
];

const statusOf = (r: JobRow): JobStatus => r.posting?.status ?? "draft";

function kst(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
}

function numText(n: number | null | undefined): string {
  return n == null ? "" : n.toLocaleString("ko-KR");
}

function Notice({ result }: { result: JobActionResult | null }) {
  if (!result) return null;
  return result.ok ? (
    result.message ? <p className="mt-3 text-sm text-emerald-700">{result.message}</p> : null
  ) : (
    <p className="mt-3 text-sm text-red-600">{result.error}</p>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

/** 작업비 입력 아래 — 작업자가 실제로 받는 부가세 포함가를 바로 보여 준다 */
function feeHint(raw: string): string {
  const n = parseWon(raw);
  if (n == null || Number.isNaN(n)) return "작업자는 세금계산서를 발행하고 부가세 10%를 더해 받습니다.";
  const b = feeBreakdown(n);
  return `부가세 포함 ${formatWon(b.total)}원 (부가세 ${formatWon(b.vat)}원) — 작업자에게 이 금액으로 보입니다.`;
}

const inputCls =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#1E22B2] focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";

function PostingEditor({ row, ready }: { row: JobRow; ready: boolean }) {
  const p = row.posting;
  const [clientAmount, setClientAmount] = useState(numText(p?.clientAmount ?? row.estimateSupply));
  const [artistFee, setArtistFee] = useState(numText(p?.artistFee));
  const [dueDate, setDueDate] = useState(p?.dueDate ?? "");
  const [memo, setMemo] = useState(p?.memo ?? "");
  const [notify, setNotify] = useState(true);
  const [result, setResult] = useState<JobActionResult | null>(null);
  const [pending, start] = useTransition();
  const isOpen = p?.status === "open";

  const run = (fn: () => Promise<JobActionResult>) =>
    start(async () => {
      setResult(null);
      setResult(await fn());
    });

  const input = { clientAmount, artistFee, dueDate, memo };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="견적가 (고객, 부가세 별도)" hint="작업자에게 보이지 않습니다">
          <input inputMode="numeric" value={clientAmount} onChange={(e) => setClientAmount(e.target.value)} placeholder="예: 3,800,000" className={inputCls} disabled={!ready || pending} />
        </Field>
        <Field label="작업비 공급가 (작업자에게 공개, 부가세 별도)" hint={feeHint(artistFee)}>
          <input inputMode="numeric" value={artistFee} onChange={(e) => setArtistFee(e.target.value)} placeholder="예: 1,500,000" className={inputCls} disabled={!ready || pending} />
        </Field>
        <Field label="마감일">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} disabled={!ready || pending} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="작업자 전달 메모 (작업자에게 공개)" hint="고객 이름·연락처는 적지 마세요.">
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} className={inputCls} disabled={!ready || pending} />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run(() => saveJobPosting(row.quoteId, input, true, notify))}
          disabled={!ready || pending}
          className="rounded-lg bg-[#1E22B2] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isOpen ? "공고 고치기" : "공고 올리기"}
        </button>
        {!isOpen && (
          <button
            type="button"
            onClick={() => run(() => saveJobPosting(row.quoteId, input, false, false))}
            disabled={!ready || pending}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50"
          >
            저장만
          </button>
        )}
        {isOpen && p && (
          <>
            <button
              type="button"
              onClick={() => run(() => claimJobAsAdmin(p.id))}
              disabled={pending}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-50"
            >
              내가 가져가기 ({ADMIN_WORKER.name})
            </button>
            <button
              type="button"
              onClick={() => run(() => closeJobPosting(row.quoteId))}
              disabled={pending}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50"
            >
              공고 내리기
            </button>
          </>
        )}
        {!isOpen && (
          <label className="ml-1 flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={pending} />
            올릴 때 작업자에게 메일로 알리기
          </label>
        )}
        {pending && <span className="text-xs text-slate-400">처리 중…</span>}
      </div>
      {isOpen && p?.openedAt && <p className="mt-2 text-xs text-slate-400">공고 시각 {kst(p.openedAt)}</p>}
      <Notice result={result} />
    </div>
  );
}

function ClaimedPanel({ row }: { row: JobRow }) {
  const p = row.posting!;
  const [result, setResult] = useState<JobActionResult | null>(null);
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);

  const run = (fn: () => Promise<JobActionResult>) =>
    start(async () => {
      setResult(null);
      setResult(await fn());
    });

  const alerts = [
    ["50%", p.alert50At],
    ["25%", p.alert25At],
    ["10%", p.alert10At],
  ] as const;

  return (
    <div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex gap-3"><dt className="w-20 flex-shrink-0 text-slate-400">작업자</dt><dd className="font-semibold text-slate-900">{row.claimedByName}</dd></div>
        <div className="flex gap-3"><dt className="w-20 flex-shrink-0 text-slate-400">가져간 시각</dt><dd>{kst(p.claimedAt)}</dd></div>
        <div className="flex gap-3"><dt className="w-20 flex-shrink-0 text-slate-400">견적가</dt><dd>{p.clientAmount == null ? "—" : `${formatWon(p.clientAmount)}원`}</dd></div>
        <div className="flex gap-3">
          <dt className="w-20 flex-shrink-0 text-slate-400">작업비</dt>
          <dd>
            {p.artistFee == null ? "—" : `${formatWon(feeBreakdown(p.artistFee).total)}원`}
            <span className="ml-1 text-xs text-slate-400">부가세 포함 · 공급가 {formatWon(p.artistFee)}원</span>
          </dd>
        </div>
        <div className="flex gap-3"><dt className="w-20 flex-shrink-0 text-slate-400">마감일</dt><dd>{p.dueDate}</dd></div>
        <div className="flex gap-3">
          <dt className="w-20 flex-shrink-0 text-slate-400">진행</dt>
          <dd>
            {row.assignmentStatus ? ASSIGNMENT_STATUS_LABELS[row.assignmentStatus] : "배정 없음"}
            {row.assignmentProgress != null && ` · ${row.assignmentProgress}%`}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-20 flex-shrink-0 text-slate-400">캘린더</dt>
          <dd className={p.calendarError ? "text-red-600" : ""}>
            {p.calendarEventId ? "기록됨" : p.calendarError ? `실패 — ${p.calendarError}` : "미기록"}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-20 flex-shrink-0 text-slate-400">마감 알림</dt>
          <dd>{alerts.map(([k, at]) => `${k} ${at ? "✓" : "–"}`).join(" · ")}</dd>
        </div>
      </dl>
      {p.memo && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{p.memo}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href="/admin/works" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">
          작업 관리에서 보기
        </Link>
        {!p.calendarEventId && (
          <button
            type="button"
            onClick={() => run(() => retryJobCalendar(row.quoteId))}
            disabled={pending}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50"
          >
            캘린더 다시 기록
          </button>
        )}
        {row.assignmentStatus !== "done" && (
          <button
            type="button"
            onClick={() => {
              if (!armed) {
                setArmed(true);
                setTimeout(() => setArmed(false), 4000);
                return;
              }
              setArmed(false);
              run(() => releaseJob(row.quoteId));
            }}
            disabled={pending}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
              armed ? "border-red-300 bg-red-600 text-white" : "border-red-200 text-red-600"
            }`}
          >
            {armed ? "한 번 더 누르면 배정 취소" : "배정 취소(회수)"}
          </button>
        )}
        {pending && <span className="text-xs text-slate-400">처리 중…</span>}
      </div>
      <Notice result={result} />
    </div>
  );
}

function JobCard({ row, ready }: { row: JobRow; ready: boolean }) {
  const status = statusOf(row);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${JOB_STATUS_COLORS[status]}`}>{JOB_STATUS_LABELS[status]}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STAGE_COLORS[row.stage]}`}>{STAGE_LABELS[row.stage]}</span>
            {row.dropped && <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Drop</span>}
          </div>
          <p className="mt-1.5 font-bold text-slate-900">
            {row.product || "제품 미정"}
            {row.quantity && <span className="font-normal text-slate-500"> · {row.quantity}</span>}
          </p>
          <p className="text-xs text-slate-400">
            {row.customer || "이름 없음"} · 접수 {row.createdAt.slice(0, 10)}
            {row.deliveryDate && ` · 고객 희망 납품 ${row.deliveryDate}`}
          </p>
        </div>
      </div>
      {status === "claimed" ? <ClaimedPanel row={row} /> : <PostingEditor row={row} ready={ready} />}
    </div>
  );
}

export default function JobBoard({ rows, ready }: { rows: JobRow[]; ready: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, draft: 0, open: 0, claimed: 0 };
    for (const r of rows) c[statusOf(r)]++;
    return c;
  }, [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => statusOf(r) === filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              filter === f.key ? "border-[#1E22B2] bg-[#1E22B2] text-white" : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            {f.label} {counts[f.key]}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">해당하는 문의가 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {shown.map((r) => (
            // 키를 문의 id 로만 둔다 — 저장 후 다시 그려져도 입력값과 결과 문구(메일 발송 수 등)가 남게
            <JobCard key={r.quoteId} row={r} ready={ready} />
          ))}
        </div>
      )}
    </div>
  );
}
