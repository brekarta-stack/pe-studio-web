/**
 * 제안 영업 보드(/admin/outreach) 순수 헬퍼 — 클라이언트/서버 공용.
 * supabase·React 에 의존하지 않는다 (node --test 로 바로 검증하기 위해).
 *
 * 영업의 핵심은 "보낸 것"보다 "다시 연락할 때를 놓치지 않는 것"이다
 * (docs/sales-pipeline-plan.md §2 원칙 5). 그래서 보드의 정렬·필터가 전부
 * 다음 액션 예정일(next_action_at)을 중심으로 돈다.
 */

import { DONE_STAGES, OUTREACH_STAGES, STAGE_LABELS, type QuoteStage } from "./assignment-types.ts";
import type { QuoteSubmission } from "./quote-types.ts";
import { addDaysKey, diffDaysKey, kstDateKey, kstDateOf } from "./kst.ts";

export { kstDateKey, kstMonthKey } from "./kst.ts";

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

/** 다음 액션 예정일까지 남은 일수 (한국 달력 기준 — 서버가 UTC 여도 같은 답). 없거나 해석 불가면 null */
export function daysToNextAction(nextActionAt: string | null, today = new Date()): number | null {
  const d = dateOnly(nextActionAt);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return diffDaysKey(kstDateKey(today), d);
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

/**
 * Date → 한국 달력 YYYY-MM-DD. 이름은 옛 그대로 두지만 기준은 KST 다
 * (toISOString 은 UTC, getDate() 는 서버 타임존이라 둘 다 Vercel 에서 하루 밀린다).
 */
export function localDate(d: Date): string {
  return kstDateKey(d);
}

/** 발송일로부터 기본 팔로업일 — 제안서를 보내고 일주일 뒤 다시 연락하는 것이 기본값 */
export function defaultFollowupDate(sentAt: string | Date, days = 7): string {
  const base = sentAt instanceof Date ? kstDateKey(sentAt) : kstDateOf(sentAt);
  return addDaysKey(base ?? kstDateKey(new Date()), days);
}

/** 화면용 짧은 날짜 "26. 10. 13." — 한국 달력 기준 */
export function fmtDateKo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

/* ── 입력 길이 제한 ────────────────────────────────────────────
 * 서버 액션·인테이크는 브라우저 maxLength 를 거치지 않고 직접 불릴 수 있다.
 * 거절하지 않고 잘라 넣는다 — 메모가 길다고 조치 자체가 실패하면 그게 더 손해다. */
export const LIMITS = {
  reason: 500,
  note: 500,
  memo: 500,
  body: 2000,
  sentTo: 200,
  org: 200,
  segment: 200,
  contact: 200,
  subject: 300,
  bodyText: 20000,
  slug: 120,
} as const;

/** trim 후 max 글자(코드포인트)까지 */
export function clip(s: string | null | undefined, max: number): string {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return Array.from(t).slice(0, max).join("");
}

/* ── 링크 ────────────────────────────────────────────────────
 * 보드에서 그대로 <a href> 로 여는 값이라 javascript: 같은 스킴은 막는다. */

/** http(s) 절대 주소면 trim 한 원문, 아니면 "" */
export function safeHttpUrl(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}

/* ── 단계 변경 시 완료 시각 ───────────────────────────────────
 * 완료(delivered·settled) 안에서 오갈 때는 처음 완료된 시각을 지킨다 — 납품 → 정산으로
 * 넘어가면서 완료일이 바뀌면 완료 목록 정렬과 월 집계가 흔들린다.
 * 완료 밖으로 나가면(되돌리기) 지운다. */
const DONE: readonly string[] = DONE_STAGES;

export function nextClosedAt(
  prevClosedAt: string | null | undefined,
  nextStage: QuoteStage | string,
  now: Date = new Date()
): string | null {
  if (!DONE.includes(nextStage)) return null;
  return prevClosedAt || now.toISOString();
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
