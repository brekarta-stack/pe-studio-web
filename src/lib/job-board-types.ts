/**
 * 작업 공고(선착순 배정) 타입·순수 로직 — 클라이언트/서버 공용.
 * (DB 접근은 server-only 인 src/lib/job-board.ts, 설계는 docs/job-board-plan.md)
 *
 * 공고 = "이 문의를 이 작업비·마감일로 맡을 사람" 을 작업자 전원에게 여는 것.
 * 가져가는 순간 assignments 에 수락 완료 배정이 생기고, 공고는 다른 작업자에게서 사라진다.
 *
 * 이 파일은 node --test 가 그대로 불러온다 — 런타임 import 를 두지 않는다.
 */

/* ── 상태 ───────────────────────────────────────────────────── */

export const JOB_STATUSES = ["draft", "open", "claimed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft:   "미공고",
  open:    "공고 중",
  claimed: "배정됨",
};

export const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  draft:   "bg-slate-100 text-slate-500 border-slate-200",
  open:    "bg-amber-50 text-amber-700 border-amber-200",
  claimed: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function isJobStatus(v: unknown): v is JobStatus {
  return typeof v === "string" && (JOB_STATUSES as readonly string[]).includes(v);
}

export interface JobPosting {
  id: string;
  quoteId: string;
  status: JobStatus;
  /** 견적가(고객 청구, 공급가액) — **작업자 화면으로 절대 넘기지 않는다** */
  clientAmount: number | null;
  /** 작업자에게 보이는 작업비 (세전) */
  artistFee: number | null;
  /** 마감일 YYYY-MM-DD */
  dueDate: string | null;
  /** 작업자 전달 메모 */
  memo: string;
  openedAt: string | null;
  /** 가져간 작업자 (artists.id) */
  claimedBy: string | null;
  claimedAt: string | null;
  assignmentId: string | null;
  calendarEventId: string | null;
  calendarError: string | null;
  alert50At: string | null;
  alert25At: string | null;
  alert10At: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── 작업자 명단 ─────────────────────────────────────────────
 * 알림 메일 주소와, 관리자 계정이 가져갈 때 누구로 칠지를 정한다.
 * 명단에 없는 작업자도 승인된 포털 계정이 있으면 공고를 보고 가져갈 수 있다(알림은 계정 이메일). */

export interface WorkerEntry {
  artistId: string;
  name: string;
  /** 알림 메일 */
  email: string;
  /** 관리자 로그인으로 가져가는 사람 — 포털이 아니라 /admin/jobs 에서 가져간다 */
  admin?: boolean;
}

export const WORKER_ROSTER: readonly WorkerEntry[] = [
  { artistId: "artist-04", name: "오세기", email: "ask@papercraft.kr", admin: true },
  { artistId: "artist-01", name: "김철호", email: "finalpaper@naver.com" },
  { artistId: "artist-03", name: "박형미", email: "dinonabi@naver.com" },
];

/** 관리자 계정이 "내가 가져가기"를 누르면 이 작업자로 배정된다 */
export const ADMIN_WORKER: WorkerEntry = WORKER_ROSTER.find((w) => w.admin)!;

/** 캘린더 일정을 기록할 계정 — 연결된 구글 계정이 이것과 다르면 관리자 화면에 경고 */
export const CALENDAR_ACCOUNT = "ask@papercraft.kr";

/** 작업자 알림 메일 — 명단이 우선, 없으면 포털 계정 이메일 */
export function workerEmail(artistId: string, accountEmail?: string | null): string | null {
  const entry = WORKER_ROSTER.find((w) => w.artistId === artistId);
  return entry?.email ?? (accountEmail?.trim() || null);
}

/* ── 공고 입력 검증 ─────────────────────────────────────────── */

export const MAX_AMOUNT = 10_000_000_000; // 100억 — 오타(0 하나 더) 방지용 상한
export const MAX_MEMO = 2000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_ONLY.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "1,200,000" / "120만" 같은 입력 → 정수 원. 비었으면 null, 못 읽으면 NaN */
export function parseWon(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : NaN;
  const s = String(raw).replace(/[\s,원₩]/g, "");
  if (!s) return null;
  const man = /^(\d+(?:\.\d+)?)만$/.exec(s);
  if (man) return Math.round(Number(man[1]) * 10_000);
  if (!/^\d+$/.test(s)) return NaN;
  return Number(s);
}

export interface PostingDraft {
  clientAmount: number | null;
  artistFee: number | null;
  dueDate: string | null;
  memo: string;
}

/**
 * 공고 입력 검증. open=true 면 공고로 올릴 수 있는지까지 본다(작업비·마감일 필수, 마감일은 오늘 이후).
 * todayKst 는 한국 달력의 오늘(YYYY-MM-DD) — 서버가 UTC 라 호출부가 넘긴다.
 */
export function validatePosting(
  input: { clientAmount: unknown; artistFee: unknown; dueDate: unknown; memo: unknown },
  opts: { open: boolean; todayKst: string },
): { ok: true; value: PostingDraft } | { ok: false; error: string } {
  const clientAmount = parseWon(input.clientAmount);
  const artistFee = parseWon(input.artistFee);
  if (Number.isNaN(clientAmount)) return { ok: false, error: "견적가는 숫자로 적어 주세요." };
  if (Number.isNaN(artistFee)) return { ok: false, error: "작업비는 숫자로 적어 주세요." };
  for (const [name, v] of [["견적가", clientAmount], ["작업비", artistFee]] as const) {
    if (v != null && (v < 0 || v > MAX_AMOUNT)) return { ok: false, error: `${name}가 범위를 벗어났습니다.` };
  }

  const dueRaw = typeof input.dueDate === "string" ? input.dueDate.trim() : "";
  const dueDate = dueRaw || null;
  if (dueDate && !isIsoDate(dueDate)) return { ok: false, error: "마감일 형식이 올바르지 않습니다." };

  const memo = (typeof input.memo === "string" ? input.memo : "").trim();
  if (memo.length > MAX_MEMO) return { ok: false, error: `전달 메모는 ${MAX_MEMO}자까지입니다.` };

  if (opts.open) {
    if (artistFee == null || artistFee <= 0) return { ok: false, error: "작업비를 적어야 공고를 올릴 수 있습니다." };
    if (!dueDate) return { ok: false, error: "마감일을 정해야 공고를 올릴 수 있습니다." };
    if (dueDate < opts.todayKst) return { ok: false, error: "마감일이 이미 지났습니다." };
  }

  return { ok: true, value: { clientAmount, artistFee, dueDate, memo } };
}

/* ── 마감 시각과 알림 단계 ───────────────────────────────────
 * 마감 시각 = 마감일 23:59:59 KST. 가져간 시각부터 마감까지를 100% 로 보고
 * 50%·25%·10% 가 남은 시점에 한 번씩 메일을 보낸다. */

export const ALERT_STAGES = [50, 25, 10] as const;
export type AlertStage = (typeof ALERT_STAGES)[number];

/** 마감일(YYYY-MM-DD) → 그날 23:59:59 KST 의 epoch ms */
export function deadlineMs(dueDate: string): number {
  return Date.parse(`${dueDate}T23:59:59+09:00`);
}

type AlertState = Pick<JobPosting, "alert50At" | "alert25At" | "alert10At">;

export function alertSentAt(p: AlertState, stage: AlertStage): string | null {
  return stage === 50 ? p.alert50At : stage === 25 ? p.alert25At : p.alert10At;
}

export const ALERT_COLUMN: Record<AlertStage, "alert_50_at" | "alert_25_at" | "alert_10_at"> = {
  50: "alert_50_at",
  25: "alert_25_at",
  10: "alert_10_at",
};

/**
 * 지금 보낼 알림 단계. 없으면 null.
 *
 * 점검이 한동안 멈췄다가 돌아와 여러 단계를 한꺼번에 지났으면 **가장 급한 단계 하나만** 보낸다 —
 * 같은 시각에 "50% 남음", "25% 남음" 메일이 연달아 가면 잡음이다. 건너뛴 단계는 skip 으로 돌려주고,
 * 호출부가 보낸 것으로 기록한다. 마감이 지났거나 기간이 0 이하이면 아무것도 보내지 않는다.
 */
export function dueAlertStage(
  p: AlertState & { claimedAt: string | null; dueDate: string | null },
  now: number,
): { send: AlertStage; skip: AlertStage[] } | null {
  if (!p.claimedAt || !p.dueDate) return null;
  const start = Date.parse(p.claimedAt);
  const end = deadlineMs(p.dueDate);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const total = end - start;
  if (total <= 0 || now >= end) return null;

  const remainingPct = ((end - now) / total) * 100;
  const crossed = ALERT_STAGES.filter((s) => remainingPct <= s && !alertSentAt(p, s));
  if (crossed.length === 0) return null;
  const send = crossed[crossed.length - 1]; // 가장 급한(작은) 단계
  return { send, skip: crossed.filter((s) => s !== send) };
}

/** 남은 시간 → "2일 5시간" / "3시간" / "40분" */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "마감 지남";
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours > 0) return `${hours}시간`;
  return `${Math.max(1, mins)}분`;
}

/* ── 작업자 화면 가드 ───────────────────────────────────────── */

/**
 * 작업자 목록·상세에 보여도 되는 공고인가 — 공고 중이고, 문의가 아직 살아 있고, 마감일이 지나지 않았을 때만.
 * 마감이 지난 공고를 가져가면 알림도 안 가고 캘린더도 과거에 찍힌다. todayKst 는 한국 달력의 오늘.
 */
export function isVisibleToWorkers(
  p: Pick<JobPosting, "status" | "artistFee" | "dueDate">,
  quote: { active: boolean; dropped: boolean } | null,
  todayKst: string,
): boolean {
  if (p.status !== "open" || p.artistFee == null || !p.dueDate) return false;
  if (p.dueDate < todayKst) return false;
  if (!quote) return false;
  return quote.active && !quote.dropped;
}

/** 원 단위 금액 — 1234567 → "1,234,567원" (메일 본문용, ₩ 기호는 쓰지 않는다) */
export function wonText(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toLocaleString("ko-KR")}원`;
}

/* ── 이메일 로그인 링크 ─────────────────────────────────────── */

export const LOGIN_LINK_TTL_MIN = 15;
/** 같은 이메일로 TTL 안에 보낼 수 있는 링크 수 */
export const LOGIN_LINK_MAX_PER_WINDOW = 5;

/** 메일 문구는 계정 유무와 상관없이 같다 — 가입 여부를 떠보지 못하게 */
export const LOGIN_LINK_SENT_MESSAGE =
  "등록된 이메일이면 로그인 링크를 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요. 링크는 15분 동안 쓸 수 있습니다.";
