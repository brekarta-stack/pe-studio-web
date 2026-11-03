"use client";

/**
 * 리드 활동 타임라인 — 제안 영업 보드와 제작 문의 시트의 펼친 행에서 함께 쓴다.
 *
 * append-only 다. 고치거나 지우는 버튼을 두지 않는다 — 감사 기록이자 CRM 타임라인이라
 * 사후에 바뀌면 기록의 의미가 없어진다. 잘못 적었으면 정정 메모를 한 줄 더 남긴다.
 *
 * 추가는 낙관적으로 맨 위에 붙이고, 실패하면 걷어 낸다.
 */

import { useState, useTransition } from "react";
import {
  ACTIVITY_KIND_LABELS,
  type ActivityKind,
  type LeadActivity,
} from "@/lib/lead-activity-types";
import { addLeadActivity } from "@/app/admin/outreach/actions";

/** 사람이 직접 남기는 종류만 — 발송·단계·전환·Drop 은 조치가 자동으로 남긴다 */
const MANUAL_KINDS = ["note", "call", "email", "meeting"] as const satisfies readonly ActivityKind[];
type ManualKind = (typeof MANUAL_KINDS)[number];

const KIND_STYLE: Record<ActivityKind, string> = {
  note:          "bg-slate-100 text-slate-600 border-slate-200",
  call:          "bg-sky-50 text-sky-700 border-sky-200",
  email:         "bg-blue-50 text-blue-700 border-blue-200",
  meeting:       "bg-violet-50 text-violet-700 border-violet-200",
  proposal_sent: "bg-pink-50 text-pink-700 border-pink-200",
  stage:         "bg-amber-50 text-amber-700 border-amber-200",
  convert:       "bg-emerald-50 text-emerald-700 border-emerald-200",
  drop:          "bg-red-50 text-red-600 border-red-200",
  restore:       "bg-teal-50 text-teal-700 border-teal-200",
  system:        "bg-stone-50 text-stone-500 border-stone-200",
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", {
    year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function ActivityKindBadge({ kind }: { kind: ActivityKind }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${KIND_STYLE[kind]}`}>
      {ACTIVITY_KIND_LABELS[kind]}
    </span>
  );
}

export default function ActivityTimeline({
  quoteId,
  activities,
  compact = false,
}: {
  quoteId: string;
  activities: LeadActivity[];
  compact?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<ManualKind>("note");
  const [body, setBody] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  /* 서버 재검증 전까지 보여 줄 방금 추가한 기록 */
  const [added, setAdded] = useState<LeadActivity[]>([]);

  const list = [...added, ...activities];

  const submit = () => {
    const text = body.trim();
    if (!text) {
      setError("내용을 입력하세요.");
      return;
    }
    const now = new Date().toISOString();
    const temp: LeadActivity = {
      id: `temp-${now}`,
      quoteId,
      kind,
      body: text,
      actor: "",
      occurredAt: now,
      createdAt: now,
    };
    setAdded((a) => [temp, ...a]);
    setError(null);
    const savedBody = body;
    const savedNext = nextAt;
    setBody("");
    setNextAt("");
    startTransition(async () => {
      const res = await addLeadActivity(quoteId, kind, text, savedNext ? savedNext : undefined);
      /* 성공이든 실패든 임시 줄은 걷어 낸다 — 성공이면 액션의 revalidatePath 가 같은 전환 안에서
         새 목록(props)을 내려 주므로 진짜 기록으로 바뀌어 보인다 */
      setAdded((a) => a.filter((x) => x.id !== temp.id));
      if (!res.ok) {
        setBody(savedBody);
        setNextAt(savedNext);
        setError(res.error);
      }
    });
  };

  const field =
    "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-slate-400";

  return (
    <div className="text-sm" onClick={(e) => e.stopPropagation()}>
      <p className="mb-2 text-xs font-bold text-slate-400">활동 기록</p>

      {/* ── 추가 폼 ── */}
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ManualKind)}
            aria-label="활동 종류"
            className={`${field} cursor-pointer`}
          >
            {MANUAL_KINDS.map((k) => (
              <option key={k} value={k}>{ACTIVITY_KIND_LABELS[k]}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            다음 액션일
            <input
              type="date"
              value={nextAt}
              onChange={(e) => setNextAt(e.target.value)}
              className={field}
            />
          </label>
        </div>
        <textarea
          rows={compact ? 2 : 3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="통화 내용, 받은 답장, 다음에 할 일"
          className={`${field} mt-2 w-full resize-y`}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={isPending || !body.trim()}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200"
            style={!isPending && body.trim() ? { background: "#1E22B2" } : {}}
          >
            {isPending ? "저장 중…" : "기록 추가"}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>

      {/* ── 목록 (최신순) ── */}
      {list.length === 0 ? (
        <p className="text-xs text-slate-400">기록이 없습니다.</p>
      ) : (
        <ul className={`space-y-2 ${compact ? "max-h-64 overflow-y-auto pr-1" : ""}`}>
          {list.map((a) => (
            <li key={a.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <ActivityKindBadge kind={a.kind} />
                <span className="text-xs text-slate-500">{fmtDateTime(a.occurredAt)}</span>
                {a.actor && <span className="text-[11px] text-slate-400">{a.actor}</span>}
                {a.id.startsWith("temp-") && <span className="text-[11px] text-slate-300">저장 중</span>}
              </div>
              {a.body && <p className="mt-1 whitespace-pre-wrap text-slate-700">{a.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
