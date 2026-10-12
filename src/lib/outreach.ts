/**
 * 제안 영업 보드(/admin/outreach) 순수 헬퍼 — 클라이언트/서버 공용.
 * supabase·React 에 의존하지 않는다 (node --test 로 바로 검증하기 위해).
 *
 * 영업의 핵심은 "보낸 것"보다 "다시 연락할 때를 놓치지 않는 것"이다
 * (docs/sales-pipeline-plan.md §2 원칙 5). 그래서 보드의 정렬·필터가 전부
 * 다음 액션 예정일(next_action_at)을 중심으로 돈다.
 */

import { daysUntil, OUTREACH_STAGES, STAGE_LABELS } from "./assignment-types.ts";
import type { QuoteSubmission } from "./quote-types.ts";

/* ── 조치 후 다시 그릴 화면 ───────────────────────────────────
 * 단계 하나가 바뀌면 리드가 보드 사이를 옮겨 다닌다(제안 영업 → 제작 문의 → 완료).
 * 액션 파일마다 목록을 손으로 적으면 하나씩 빠지므로 여기 한 곳에만 둔다.
 * ("use server" 파일은 async 함수만 내보낼 수 있어 상수는 순수 모듈에 둔다) */
export const SALES_PATHS = [
  "/admin",
  "/admin/quotes",
  "/admin/outreach",
  "/admin/completed",
  "/admin/settlements",
  "/admin/drops",
  "/admin/works",
] as const;

/* ── 다음 액션 상태 ─────────────────────────────────────────── */

export type DueState = "none" | "overdue" | "today" | "upcoming";

/** DATE 컬럼은 "YYYY-MM-DD" 로 오지만, 타임스탬프가 섞여 와도 날짜 부분만 본다 */
function dateOnly(v: string | null): string | null {
  if (!v) return null;
  return v.slice(0, 10);
}

/** 다음 액션 예정일까지 남은 일수 (로컬 자정 기준). 없거나 해석 불가면 null */
export function daysToNextAction(nextActionAt: string | null, today = new Date()): number | null {
  return daysUntil(dateOnly(nextActionAt), today);
}

/**
 * 다음 액션 예정일 상태. 날짜끼리 비교한다 — 시:분:초가 끼면 D-day 가 하루씩 밀린다
 * (assignment-types 의 daysUntil 과 같은 기준).
 */
export function dueState(nextActionAt: string | null, today = new Date()): DueState {
  const d = daysToNextAction(nextActionAt, today);
  if (d == null) return "none";
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  return "upcoming";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date → 로컬 YYYY-MM-DD (toISOString 은 UTC 라 한국 오전 9시 전이면 하루 전날이 된다) */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 발송일로부터 기본 팔로업일 — 제안서를 보내고 일주일 뒤 다시 연락하는 것이 기본값 */
export function defaultFollowupDate(sentAt: string | Date, days = 7): string {
  const base = sentAt instanceof Date ? new Date(sentAt.getTime()) : new Date(sentAt);
  if (Number.isNaN(base.getTime())) return localDate(new Date());
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return localDate(d);
}

/* ── 정렬 ─────────────────────────────────────────────────────
 * 지연 → 오늘 → 예정 → 미지정. 지연은 오래 밀린 것부터(가장 급하다),
 * 예정은 가까운 날짜부터, 미지정은 최근 등록부터. 같은 값이면 원래 순서 유지(stable). */

const DUE_RANK: Record<DueState, number> = { overdue: 0, today: 1, upcoming: 2, none: 3 };

export function sortOutreach<T extends Pick<QuoteSubmission, "nextActionAt" | "createdAt">>(
  rows: T[],
  today = new Date()
): T[] {
  const keyed = rows.map((row, i) => {
    const state = dueState(row.nextActionAt, today);
    return { row, i, state, date: dateOnly(row.nextActionAt) ?? "" };
  });
  keyed.sort((a, b) => {
    const r = DUE_RANK[a.state] - DUE_RANK[b.state];
    if (r !== 0) return r;
    if (a.state === "none") {
      const ta = new Date(a.row.createdAt).getTime() || 0;
      const tb = new Date(b.row.createdAt).getTime() || 0;
      if (ta !== tb) return tb - ta;
    } else if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1;
    }
    return a.i - b.i;
  });
  return keyed.map((k) => k.row);
}

/* ── 필터 칩 ──────────────────────────────────────────────── */

export const OUTREACH_FILTERS = ["all", "overdue", ...OUTREACH_STAGES] as const;
export type OutreachFilter = (typeof OUTREACH_FILTERS)[number];

export const OUTREACH_FILTER_LABELS: Record<OutreachFilter, string> = {
  all: "전체",
  overdue: "팔로업 지연",
  sourced: STAGE_LABELS.sourced,
  drafted: STAGE_LABELS.drafted,
  sent: STAGE_LABELS.sent,
  followup: STAGE_LABELS.followup,
};

/* ── 마이그레이션 전 상태 감지 ─────────────────────────────────
 * 20261013 마이그레이션 전에는 새 컬럼이 없어 PostgREST 가 이런 신호를 준다:
 *   42703      Postgres "column … does not exist"
 *   PGRST204   "Could not find the '…' column of 'quotes' in the schema cache"
 * 이때는 화면을 죽이지 않고 "마이그레이션 필요" 안내로 돌리거나, 옛 컬럼만으로 다시 쓴다. */
export function isMissingColumnError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  if (code === "42703" || code === "PGRST204") return true;
  const msg = typeof message === "string" ? message : "";
  return msg.includes("does not exist") || msg.includes("schema cache");
}
