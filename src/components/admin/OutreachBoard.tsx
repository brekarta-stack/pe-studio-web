"use client";

/**
 * 제안 영업 보드 — 내가 먼저 보내는 제안(아웃바운드)의 진행판.
 *
 * 정렬은 "다음 액션일" 중심이다: 팔로업 예정일이 지난 건 → 오늘 → 예정 → 미지정.
 * 영업은 보낸 것보다 다시 연락할 때를 놓치지 않는 것이 수주를 만든다(계획 §2 원칙 5).
 *
 * 조치(단계·발송 기록·팔로업일·전환·Drop)는 화면을 먼저 바꾸고(낙관적 갱신)
 * 서버가 실패하면 되돌린다. 확인창(window.confirm)은 쓰지 않고 행 아래 패널에서 한 번 더 누르게 한다.
 */

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { QuoteSubmission } from "@/lib/quote-types";
import {
  OUTREACH_STAGES,
  STAGE_LABELS,
  STAGE_COLORS,
  isQuoteStage,
  type QuoteStage,
} from "@/lib/assignment-types";
import type { LeadActivity } from "@/lib/lead-activity-types";
import {
  OUTREACH_FILTERS,
  OUTREACH_FILTER_LABELS,
  daysToNextAction,
  defaultFollowupDate,
  dueState,
  sortOutreach,
  type OutreachFilter,
} from "@/lib/outreach";
import { setQuoteStage, dropQuote } from "@/app/admin/quotes/actions";
import {
  createOutreachLead,
  updateOutreachLead,
  markProposalSent,
  setNextAction,
  convertLead,
} from "@/app/admin/outreach/actions";
import ActivityTimeline, { ActivityKindBadge } from "@/components/admin/ActivityTimeline";

type OutreachStage = (typeof OUTREACH_STAGES)[number];

interface Props {
  rows: QuoteSubmission[];
  activities: Record<string, LeadActivity[]>;
}

/** 행 아래에 펼치는 조치 패널 */
type Panel = { id: string; kind: "send" | "next" | "drop" } | null;

const BRAND = "#1E22B2";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

/** DATE(YYYY-MM-DD) 는 new Date 가 UTC 자정으로 읽어 하루 밀릴 수 있으므로 문자열 그대로 짧게 쓴다 */
function fmtDay(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  if (!y || !m || !d) return ymd;
  return `${y.slice(2)}. ${m}. ${d}.`;
}

/** 다음 액션 D-day 표시 — 지연은 빨강, 오늘은 주황, 예정은 회색 */
function NextActionCell({ date }: { date: string | null }) {
  const state = dueState(date);
  if (state === "none") return <span className="text-slate-300">—</span>;
  const d = daysToNextAction(date) ?? 0;
  const text =
    state === "overdue" ? `D+${-d} 지연` : state === "today" ? "오늘" : `D-${d}`;
  const tone =
    state === "overdue"
      ? "font-bold text-red-600"
      : state === "today"
        ? "font-bold text-amber-600"
        : "text-slate-600";
  return (
    <div>
      <p className={`whitespace-nowrap text-sm ${tone}`}>{text}</p>
      <p className="text-[11px] text-slate-400">{fmtDay(date)}</p>
    </div>
  );
}

export default function OutreachBoard({ rows, activities }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [filter, setFilter] = useState<OutreachFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [showNew, setShowNew] = useState(false);

  /* 낙관적 갱신용 오버레이 — 서버 재검증 전까지 화면을 즉시 바꾼다 */
  const [stageOv, setStageOv] = useState<Record<string, QuoteStage>>({});
  const [nextOv, setNextOv] = useState<Record<string, string | null>>({});
  const [sentOv, setSentOv] = useState<Record<string, { at: string; to: string }>>({});
  /** 전환·Drop 으로 이 보드를 떠난 행 */
  const [goneIds, setGoneIds] = useState<Set<string>>(new Set());

  const curStage = (q: QuoteSubmission): QuoteStage => stageOv[q.id] ?? q.stage;
  const curNext = (q: QuoteSubmission): string | null =>
    q.id in nextOv ? nextOv[q.id] : q.nextActionAt;

  /* 오버레이를 반영한 행 — 정렬·필터·집계가 모두 이 값을 본다 */
  const live = useMemo(
    () =>
      sortOutreach(
        rows
          .filter((q) => !goneIds.has(q.id))
          .map((q) => ({
            ...q,
            stage: stageOv[q.id] ?? q.stage,
            nextActionAt: q.id in nextOv ? nextOv[q.id] : q.nextActionAt,
            proposalSentAt: sentOv[q.id]?.at ?? q.proposalSentAt,
            proposalSentTo: sentOv[q.id]?.to ?? q.proposalSentTo,
          }))
      ),
    [rows, goneIds, stageOv, nextOv, sentOv]
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(OUTREACH_FILTERS.map((f) => [f, 0])) as Record<OutreachFilter, number>;
    for (const q of live) {
      c.all += 1;
      if (dueState(q.nextActionAt) === "overdue") c.overdue += 1;
      if ((OUTREACH_STAGES as readonly string[]).includes(q.stage)) c[q.stage as OutreachStage] += 1;
    }
    return c;
  }, [live]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return live.filter((q) => {
      if (filter === "overdue" && dueState(q.nextActionAt) !== "overdue") return false;
      if (filter !== "all" && filter !== "overdue" && q.stage !== filter) return false;
      if (!term) return true;
      return [q.org, q.name, q.segment, q.email]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(term));
    });
  }, [live, filter, search]);

  /* ── 조치 ── */

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, rollback: () => void, onOk?: () => void) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        rollback();
        setError(res.error ?? "저장하지 못했습니다.");
      } else {
        onOk?.();
      }
    });
  };

  const onChangeStage = (q: QuoteSubmission, stage: QuoteStage) => {
    const prev = curStage(q);
    if (prev === stage) return;
    setStageOv((p) => ({ ...p, [q.id]: stage }));
    run(
      () => setQuoteStage(q.id, stage),
      () => setStageOv((p) => ({ ...p, [q.id]: prev }))
    );
  };

  const onMarkSent = (q: QuoteSubmission, sentTo: string, note: string) => {
    const prevStage = curStage(q);
    const prevNext = curNext(q);
    const hadSent = sentOv[q.id];
    const now = new Date().toISOString();
    setStageOv((p) => ({ ...p, [q.id]: "sent" }));
    setSentOv((p) => ({ ...p, [q.id]: { at: now, to: sentTo } }));
    // 서버와 같은 규칙 — 팔로업일이 비어 있으면 7일 뒤로 잡힌다
    if (!prevNext) setNextOv((p) => ({ ...p, [q.id]: defaultFollowupDate(now) }));
    setPanel(null);
    run(
      () => markProposalSent(q.id, { sentTo, note }),
      () => {
        setStageOv((p) => ({ ...p, [q.id]: prevStage }));
        setNextOv((p) => ({ ...p, [q.id]: prevNext }));
        setSentOv((p) => {
          const n = { ...p };
          if (hadSent) n[q.id] = hadSent;
          else delete n[q.id];
          return n;
        });
      }
    );
  };

  const onSetNext = (q: QuoteSubmission, date: string | null) => {
    const prev = curNext(q);
    setNextOv((p) => ({ ...p, [q.id]: date }));
    setPanel(null);
    run(
      () => setNextAction(q.id, date),
      () => setNextOv((p) => ({ ...p, [q.id]: prev }))
    );
  };

  const hide = (id: string) => setGoneIds((s) => new Set(s).add(id));
  const unhide = (id: string) =>
    setGoneIds((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });

  const onConvert = (q: QuoteSubmission) => {
    hide(q.id);
    run(
      () => convertLead(q.id),
      () => unhide(q.id),
      () => setNotice(`'${q.org || q.name}'을(를) 상담중으로 전환했습니다. 제작 문의에서 이어서 진행하세요.`)
    );
  };

  const onDrop = (q: QuoteSubmission, reason: string) => {
    hide(q.id);
    setPanel(null);
    run(
      () => dropQuote(q.id, reason),
      () => unhide(q.id),
      () => setNotice(`'${q.org || q.name}'을(를) Drop 했습니다. 운영 > Drop 에서 복구할 수 있습니다.`)
    );
  };

  const th =
    "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap border-b border-slate-200";
  const td = "px-3 py-2 text-sm text-slate-700 align-top border-b border-slate-100";
  const actBtn =
    "whitespace-nowrap rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50";
  const COLS = 9;

  return (
    <div>
      {/* ── 단계 칩 ── */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {OUTREACH_FILTERS.map((f) => {
          const on = filter === f;
          const warn = f === "overdue" && counts.overdue > 0;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                on
                  ? "border-transparent text-white"
                  : warn
                    ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              style={on ? { background: f === "overdue" ? "#DC2626" : BRAND } : undefined}
            >
              {OUTREACH_FILTER_LABELS[f]} <span className={on ? "opacity-80" : "text-slate-400"}>{counts[f]}</span>
            </button>
          );
        })}
      </div>

      {/* ── 툴바 ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="기관·담당자·세그먼트 검색"
          className="h-9 w-60 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
        />
        <button
          onClick={() => setShowNew(true)}
          className="h-9 rounded-lg px-4 text-sm font-semibold text-white"
          style={{ background: BRAND }}
        >
          + 새 리드 등록
        </button>
        <span className="ml-auto text-sm text-slate-400">
          {visibleRows.length}건 {visibleRows.length !== live.length && `/ 전체 ${live.length}건`}
          {isPending && <span className="ml-2 text-slate-300">저장 중…</span>}
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          저장하지 못했습니다: {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {/* ── 표 ── */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <th className={`${th} w-8`} aria-label="펼치기" />
              <th className={th}>기관</th>
              <th className={th}>단계</th>
              <th className={th}>제안서</th>
              <th className={th}>발송</th>
              <th className={th}>다음 액션</th>
              <th className={th}>담당자·연락처</th>
              <th className={th}>최근 활동</th>
              <th className={th}>조치</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="px-4 py-16 text-center text-sm text-slate-400">
                  {live.length === 0
                    ? "아직 제안 영업 리드가 없습니다. '새 리드 등록'으로 시작하거나 발굴 에이전트가 넣은 리드를 기다리세요."
                    : "조건에 맞는 리드가 없습니다."}
                </td>
              </tr>
            ) : (
              visibleRows.map((q) => {
                const stage = q.stage;
                const isOpen = expanded === q.id;
                const acts = activities[q.id] ?? [];
                const latest = acts[0];
                const openPanel = panel?.id === q.id ? panel.kind : null;
                return (
                  <Fragment key={q.id}>
                    <tr className={isOpen ? "bg-slate-50" : "hover:bg-slate-50/60"}>
                      <td className={td}>
                        <button
                          onClick={() => setExpanded(isOpen ? null : q.id)}
                          aria-label={isOpen ? "접기" : "펼치기"}
                          aria-expanded={isOpen}
                          className="rounded px-1 text-slate-400 hover:text-slate-700"
                        >
                          {isOpen ? "▴" : "▾"}
                        </button>
                      </td>
                      <td className={`${td} min-w-[10rem]`}>
                        <p className="font-semibold text-slate-900">{q.org || "(기관명 없음)"}</p>
                        {(q.segment || q.score != null) && (
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            {q.segment}
                            {q.segment && q.score != null && " · "}
                            {q.score != null && `점수 ${q.score}/5`}
                          </p>
                        )}
                      </td>
                      <td className={td}>
                        <select
                          value={stage}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (isQuoteStage(v)) onChangeStage(q, v);
                          }}
                          aria-label={`${q.org} 단계`}
                          className={`min-w-[6.5rem] cursor-pointer whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold outline-none ${STAGE_COLORS[stage]}`}
                        >
                          {OUTREACH_STAGES.map((s) => (
                            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                          ))}
                        </select>
                      </td>
                      <td className={td}>
                        {q.proposalUrl ? (
                          <a
                            href={q.proposalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="whitespace-nowrap text-xs font-semibold text-[#1E22B2] hover:underline"
                          >
                            열기 ↗
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className={td}>
                        {q.proposalSentAt ? (
                          <div>
                            <p className="whitespace-nowrap text-sm">{fmtDate(q.proposalSentAt)}</p>
                            {q.proposalSentTo && (
                              <p className="max-w-[10rem] truncate text-[11px] text-slate-400" title={q.proposalSentTo}>
                                {q.proposalSentTo}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className={td}>
                        <NextActionCell date={q.nextActionAt} />
                      </td>
                      <td className={td}>
                        <p className="text-sm">{q.name || "—"}</p>
                        {q.email && (
                          <a href={`mailto:${q.email}`} className="block max-w-[11rem] truncate text-[11px] text-slate-400 hover:text-blue-700 hover:underline">
                            {q.email}
                          </a>
                        )}
                        {q.phone && (
                          <a href={`tel:${q.phone}`} className="block text-[11px] text-slate-400 hover:text-blue-700 hover:underline">
                            {q.phone}
                          </a>
                        )}
                      </td>
                      <td className={`${td} max-w-[14rem]`}>
                        {latest ? (
                          <div>
                            <div className="flex items-center gap-1.5">
                              <ActivityKindBadge kind={latest.kind} />
                              <span className="text-[11px] text-slate-400">{fmtDate(latest.occurredAt)}</span>
                            </div>
                            {latest.body && (
                              <p className="mt-0.5 truncate text-xs text-slate-500" title={latest.body}>
                                {latest.body}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          <button
                            className={actBtn}
                            onClick={() => setPanel(openPanel === "send" ? null : { id: q.id, kind: "send" })}
                          >
                            발송 기록
                          </button>
                          <button
                            className={actBtn}
                            onClick={() => setPanel(openPanel === "next" ? null : { id: q.id, kind: "next" })}
                          >
                            팔로업일
                          </button>
                          <button
                            className={`${actBtn} border-emerald-200 text-emerald-700 hover:bg-emerald-50`}
                            onClick={() => onConvert(q)}
                            disabled={isPending}
                            title="답장이 왔으면 상담중으로 넘깁니다"
                          >
                            전환
                          </button>
                          <button
                            className={`${actBtn} border-red-200 text-red-600 hover:bg-red-50`}
                            onClick={() => setPanel(openPanel === "drop" ? null : { id: q.id, kind: "drop" })}
                          >
                            Drop
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* ── 조치 패널 ── 표 안쪽 팝오버는 가로 스크롤 영역에 잘리므로 행 아래에 펼친다 */}
                    {openPanel && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={COLS} className="border-b border-slate-200 px-5 py-3">
                          {openPanel === "send" && (
                            <SendPanel
                              key={`send-${q.id}`}
                              defaultTo={q.email}
                              hasNext={!!q.nextActionAt}
                              pending={isPending}
                              onCancel={() => setPanel(null)}
                              onSubmit={(to, note) => onMarkSent(q, to, note)}
                            />
                          )}
                          {openPanel === "next" && (
                            <NextPanel
                              key={`next-${q.id}`}
                              current={q.nextActionAt}
                              pending={isPending}
                              onCancel={() => setPanel(null)}
                              onSubmit={(d) => onSetNext(q, d)}
                            />
                          )}
                          {openPanel === "drop" && (
                            <DropPanel
                              key={`drop-${q.id}`}
                              org={q.org || q.name}
                              pending={isPending}
                              onCancel={() => setPanel(null)}
                              onSubmit={(reason) => onDrop(q, reason)}
                            />
                          )}
                        </td>
                      </tr>
                    )}

                    {/* ── 상세 ── */}
                    {isOpen && (
                      <tr className="bg-slate-50">
                        <td colSpan={COLS} className="border-b border-slate-200 px-5 py-4">
                          <div className="grid gap-6 lg:grid-cols-2">
                            <div className="space-y-4">
                              <LeadEditForm
                                key={`${q.id}-${q.org}-${q.segment}-${q.score}-${q.name}-${q.email}-${q.phone}-${q.proposalUrl}`}
                                lead={q}
                                onSaved={() => router.refresh()}
                              />
                              {q.notes && (
                                <div>
                                  <p className="mb-1 text-xs font-bold text-slate-400">메모</p>
                                  <p className="whitespace-pre-wrap text-sm text-slate-700">{q.notes}</p>
                                </div>
                              )}
                              <AgentOutput outreach={q.outreach} />
                            </div>
                            <ActivityTimeline quoteId={q.id} activities={acts} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewLeadModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            setNotice("새 리드를 등록했습니다.");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ─── 조치 패널들 ─── */

const field =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-slate-400";
const lbl = "mb-1 block text-xs font-bold text-slate-500";

function SendPanel({
  defaultTo,
  hasNext,
  pending,
  onCancel,
  onSubmit,
}: {
  defaultTo: string;
  hasNext: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (to: string, note: string) => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className={lbl}>수신처 *</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} className={`${field} w-64`} placeholder="담당자 이메일 또는 대표 메일" />
      </div>
      <div className="min-w-[14rem] flex-1">
        <label className={lbl}>메모</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={`${field} w-full`} placeholder="예: 덱 링크와 함께 메일 발송" />
      </div>
      <button
        disabled={pending || !to.trim()}
        onClick={() => onSubmit(to.trim(), note.trim())}
        className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200"
        style={!pending && to.trim() ? { background: BRAND } : {}}
      >
        발송 기록
      </button>
      <button onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
        취소
      </button>
      {!hasNext && (
        <p className="w-full text-[11px] text-slate-400">팔로업일이 비어 있으면 7일 뒤로 잡습니다.</p>
      )}
    </div>
  );
}

function NextPanel({
  current,
  pending,
  onCancel,
  onSubmit,
}: {
  current: string | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (date: string | null) => void;
}) {
  const [date, setDate] = useState(current?.slice(0, 10) ?? "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className={lbl}>다음 팔로업일</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
      </div>
      <button
        disabled={pending}
        onClick={() => onSubmit(date || null)}
        className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200"
        style={!pending ? { background: BRAND } : {}}
      >
        저장
      </button>
      {current && (
        <button
          disabled={pending}
          onClick={() => onSubmit(null)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          날짜 지우기
        </button>
      )}
      <button onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
        취소
      </button>
    </div>
  );
}

/** Drop — 사유를 받고 한 번 더 눌러야 실행된다 (복구 가능하지만 보드에서 사라지므로) */
function DropPanel({
  org,
  pending,
  onCancel,
  onSubmit,
}: {
  org: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [armed, setArmed] = useState(false);
  return (
    <div className="max-w-xl">
      <label className={lbl}>Drop 사유(선택)</label>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={`${field} w-full resize-y`}
        placeholder="예: 올해 예산 없음, 담당자 답 없음"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!armed ? (
          <button
            onClick={() => setArmed(true)}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            Drop
          </button>
        ) : (
          <>
            <span className="text-xs text-red-600">&apos;{org || "이 리드"}&apos;를 보드에서 뺍니다. 운영 &gt; Drop 에서 복구할 수 있습니다.</span>
            <button
              disabled={pending}
              onClick={() => onSubmit(reason.trim())}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Drop 확정
            </button>
          </>
        )}
        <button onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          취소
        </button>
      </div>
    </div>
  );
}

/* ─── 리드 정보 수정 ─── */

function LeadEditForm({ lead, onSaved }: { lead: QuoteSubmission; onSaved: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [org, setOrg] = useState(lead.org);
  const [segment, setSegment] = useState(lead.segment);
  const [score, setScore] = useState(lead.score == null ? "" : String(lead.score));
  const [contactName, setContactName] = useState(lead.name);
  const [contactEmail, setContactEmail] = useState(lead.email);
  const [phone, setPhone] = useState(lead.phone);
  const [proposalUrl, setProposalUrl] = useState(lead.proposalUrl);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty =
    org !== lead.org ||
    segment !== lead.segment ||
    score !== (lead.score == null ? "" : String(lead.score)) ||
    contactName !== lead.name ||
    contactEmail !== lead.email ||
    phone !== lead.phone ||
    proposalUrl !== lead.proposalUrl;

  const save = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await updateOutreachLead(lead.id, {
        org,
        segment,
        score: score ? Number(score) : null,
        contactName,
        contactEmail,
        phone,
        proposalUrl,
      });
      if (res.ok) {
        setMsg({ ok: true, text: "저장했습니다." });
        onSaved();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  };

  return (
    <div>
      <p className="mb-2 text-xs font-bold text-slate-400">리드 정보</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className={lbl}>기관 *</label>
          <input value={org} onChange={(e) => setOrg(e.target.value)} className={`${field} w-full`} />
        </div>
        <div>
          <label className={lbl}>세그먼트</label>
          <input value={segment} onChange={(e) => setSegment(e.target.value)} className={`${field} w-full`} placeholder="공공·박물관·대학…" />
        </div>
        <div>
          <label className={lbl}>점수</label>
          <ScoreSelect value={score} onChange={setScore} />
        </div>
        <div>
          <label className={lbl}>담당자</label>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={`${field} w-full`} />
        </div>
        <div>
          <label className={lbl}>전화</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={`${field} w-full`} />
        </div>
        <div className="col-span-2">
          <label className={lbl}>이메일</label>
          <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={`${field} w-full`} />
        </div>
        <div className="col-span-2">
          <label className={lbl}>제안서 링크</label>
          <input value={proposalUrl} onChange={(e) => setProposalUrl(e.target.value)} className={`${field} w-full`} placeholder="https://docs.google.com/presentation/…" />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          disabled={!dirty || !org.trim() || isPending}
          onClick={save}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200"
          style={dirty && org.trim() && !isPending ? { background: BRAND } : {}}
        >
          {isPending ? "저장 중…" : "정보 저장"}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

function ScoreSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${field} w-full cursor-pointer`}>
      <option value="">없음</option>
      {[5, 4, 3, 2, 1].map((n) => (
        <option key={n} value={String(n)}>{n}/5</option>
      ))}
    </select>
  );
}

/* ─── 발굴 에이전트 산출물 ─── 형태가 자주 바뀌는 JSONB 라 아는 키만 문자열일 때 보여 준다 */
function AgentOutput({ outreach }: { outreach: Record<string, unknown> | null }) {
  if (!outreach) return null;
  const subject = typeof outreach.subject === "string" ? outreach.subject : "";
  const body = typeof outreach.body_text === "string" ? outreach.body_text : "";
  if (!subject && !body) return null;
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-xs font-bold text-slate-500">발굴 에이전트 산출물</summary>
      {subject && <p className="mt-2 text-sm font-semibold text-slate-800">{subject}</p>}
      {body && (
        <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">{body}</p>
      )}
    </details>
  );
}

/* ─── 새 리드 등록 ───
 * 같은 기관에 180일 안에 제안한 기록이 있으면 서버가 등록 대신 중복 정보를 돌려준다.
 * 그때 "그래도 등록"을 눌러야만 force 로 다시 보낸다 — 중복 제안 사고(국립생태원)를 막는 장치. */
function NewLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [org, setOrg] = useState("");
  const [segment, setSegment] = useState("");
  const [score, setScore] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [proposalUrl, setProposalUrl] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<{ org: string; daysAgo: number; stage: string } | null>(null);

  const canSubmit = org.trim() !== "" && !isPending;

  const submit = (force: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await createOutreachLead({
        org,
        segment,
        score: score ? Number(score) : null,
        contactName,
        contactEmail,
        phone,
        proposalUrl,
        memo,
        nextActionAt: nextActionAt || null,
        force,
      });
      if (res.ok) {
        onCreated();
        return;
      }
      if ("duplicate" in res) {
        setDup(res.duplicate);
        return;
      }
      setError(res.error);
    });
  };

  const stageLabel = (s: string) => (isQuoteStage(s) ? STAGE_LABELS[s] : s);
  const full = `${field} w-full`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !isPending && onClose()}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900">새 리드 등록</h2>
        <p className="mt-0.5 mb-4 text-sm text-slate-500">
          먼저 제안할 기관을 등록합니다. 제안서 링크가 있으면 &apos;제안서 준비&apos;, 없으면 &apos;발굴&apos; 단계로 들어갑니다.
        </p>

        <div className="space-y-3">
          <div>
            <label className={lbl}>기관 *</label>
            <input
              value={org}
              onChange={(e) => {
                setOrg(e.target.value);
                setDup(null); // 기관명을 고치면 이전 중복 경고는 더 이상 맞지 않는다
              }}
              className={full}
              placeholder="예: 국립생태원"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>세그먼트</label>
              <input value={segment} onChange={(e) => setSegment(e.target.value)} className={full} placeholder="공공·박물관·대학…" />
            </div>
            <div>
              <label className={lbl}>점수</label>
              <ScoreSelect value={score} onChange={setScore} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>담당자</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={full} />
            </div>
            <div>
              <label className={lbl}>전화</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={full} />
            </div>
          </div>
          <div>
            <label className={lbl}>이메일</label>
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={full} placeholder="담당자 또는 대표 메일" />
          </div>
          <div>
            <label className={lbl}>제안서 링크</label>
            <input value={proposalUrl} onChange={(e) => setProposalUrl(e.target.value)} className={full} placeholder="https://docs.google.com/presentation/…" />
          </div>
          <div>
            <label className={lbl}>팔로업 예정일</label>
            <input type="date" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} className={field} />
          </div>
          <div>
            <label className={lbl}>메모</label>
            <textarea rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} className={`${full} resize-y`} placeholder="이 기관을 고른 이유, 참고할 사례 등" />
          </div>
        </div>

        {dup && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p>
              같은 기관(<b>{dup.org}</b>)에 {dup.daysAgo === 0 ? "오늘" : `${dup.daysAgo}일 전`} 제안한 기록이 있습니다
              (현재 단계: {stageLabel(dup.stage)}).
            </p>
            <div className="mt-2 flex gap-2">
              <button
                disabled={isPending}
                onClick={() => submit(true)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                그래도 등록
              </button>
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            닫기
          </button>
          <button
            disabled={!canSubmit || !!dup}
            onClick={() => submit(false)}
            className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200"
            style={canSubmit && !dup ? { background: BRAND } : {}}
          >
            {isPending ? "등록 중…" : "등록하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
