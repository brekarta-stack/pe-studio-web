/**
 * 작업 공고 데이터 접근 (server-only) — /admin/jobs 와 포털 /artist/jobs 의 단일 출처.
 * 설계: docs/job-board-plan.md
 *
 * 두 가지 규칙:
 *  1. 작업자 시점 데이터는 listOpenJobs / getOpenJob 에서만 만든다. 여기서 고객 이름·연락처와
 *     견적가(client_amount)를 조회 단계부터 뺀다 — 타입(OpenJob)에도 없다.
 *  2. 가져가기는 `status='open'` 조건부 UPDATE 한 번이 판정한다. 동시에 눌러도 한 명만 이긴다.
 */

import { supabaseAdmin } from "./supabase-admin";
import { getAllArtists } from "./artists";
import { createAssignment, getAssignment, listAssignmentsByQuote, updateAssignment } from "./assignments";
import { isActiveStage } from "./assignment-types";
import { toBrief } from "./artist-portal";
import type { WorkBrief } from "./artist-portal-types";
import { kstDateKey } from "./kst";
import { PRODUCT_LABELS, label } from "./quote-labels";
import {
  ALERT_COLUMN,
  deadlineMs,
  dueAlertStage,
  isJobStatus,
  isVisibleToWorkers,
  workerEmail,
  WORKER_ROSTER,
  type AlertStage,
  type JobPosting,
  type PostingDraft,
  wonText,
} from "./job-board-types";
import { createCalendarEvent, deleteCalendarEvent, siteBase } from "./google-drive";
import { dueAlertMail, newJobMail, type JobSummary } from "./job-mail-content";
import { sendJobMail } from "./job-mail";

const TABLE = "job_postings";

/** 표가 아직 없다(마이그레이션 전) — 화면은 설정 안내로 폴백한다 */
export class JobBoardNotReadyError extends Error {
  constructor() {
    super("작업 공고 표가 없습니다. supabase/migrations/20261113_job_board.sql 을 먼저 실행하세요.");
  }
}

/** 이미 다른 작업자가 가져갔거나 공고가 내려갔다 */
export class JobUnavailableError extends Error {}

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    (error.message ?? "").includes("does not exist") ||
    (error.message ?? "").includes("schema cache")
  );
}

function raise(error: { message?: string; code?: string }): never {
  if (isMissingTable(error)) throw new JobBoardNotReadyError();
  throw new Error(error.message ?? String(error));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPosting(row: any): JobPosting {
  return {
    id: row.id,
    quoteId: row.quote_id,
    status: isJobStatus(row.status) ? row.status : "draft",
    clientAmount: row.client_amount == null ? null : Number(row.client_amount),
    artistFee: row.artist_fee == null ? null : Number(row.artist_fee),
    dueDate: row.due_date ?? null,
    memo: row.memo ?? "",
    openedAt: row.opened_at ?? null,
    claimedBy: row.claimed_by ?? null,
    claimedAt: row.claimed_at ?? null,
    assignmentId: row.assignment_id ?? null,
    calendarEventId: row.calendar_event_id ?? null,
    calendarError: row.calendar_error ?? null,
    alert50At: row.alert_50_at ?? null,
    alert25At: row.alert_25_at ?? null,
    alert10At: row.alert_10_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 표가 있는가 — 관리자 화면이 안내를 띄울지 정한다 */
export async function jobBoardReady(): Promise<boolean> {
  const { error } = await supabaseAdmin.from(TABLE).select("id").limit(1);
  return !error;
}

export async function listPostings(): Promise<JobPosting[]> {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*");
  if (error) {
    if (isMissingTable(error)) return [];
    raise(error);
  }
  return (data ?? []).map(toPosting);
}

export async function getPostingByQuote(quoteId: string): Promise<JobPosting | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("quote_id", quoteId).maybeSingle();
  if (error) raise(error);
  return data ? toPosting(data) : null;
}

async function getPosting(id: string): Promise<JobPosting | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) raise(error);
  return data ? toPosting(data) : null;
}

async function artistNames(): Promise<Map<string, string>> {
  const { artists } = await getAllArtists();
  return new Map(artists.map((a) => [a.id, a.name]));
}

/* ── 관리자: 공고 작성·내리기 ─────────────────────────────────── */

/**
 * 공고 저장. open=true 면 공고로 올린다(작업자에게 보이기 시작).
 * 이미 가져간 공고는 고칠 수 없다 — 조건이 바뀌면 배정을 취소하고 다시 올린다.
 * newlyOpened 는 이번 저장으로 처음 공고가 열렸는지 — 새 공고 메일을 보낼지 판단한다.
 */
export async function savePosting(
  quoteId: string,
  draft: PostingDraft,
  open: boolean,
): Promise<{ posting: JobPosting; newlyOpened: boolean }> {
  const existing = await getPostingByQuote(quoteId);
  if (existing?.status === "claimed") {
    throw new Error("이미 작업자가 가져간 공고입니다. 조건을 바꾸려면 배정을 취소한 뒤 다시 올리세요.");
  }

  if (open) {
    // 이미 진행 중인 담당자(제안 응답 대기·수락)가 있으면 공고를 열지 않는다 — 두 사람이 같은 일을 맡게 된다
    const busy = (await listAssignmentsByQuote(quoteId)).filter(
      (a) => (a.offerStatus === "offered" || a.offerStatus === "accepted") && a.status !== "cancelled",
    );
    if (busy.length > 0) {
      throw new Error("이 문의에는 이미 진행 중인 담당자가 있습니다. 작업 관리에서 먼저 정리하세요.");
    }
  }

  const wasOpen = existing?.status === "open";
  const row = {
    quote_id: quoteId,
    client_amount: draft.clientAmount,
    artist_fee: draft.artistFee,
    due_date: draft.dueDate,
    memo: draft.memo,
    status: open ? "open" : "draft",
    opened_at: open ? (wasOpen ? existing!.openedAt : new Date().toISOString()) : null,
  };

  // 가져가기와 겹치는 경우를 막으려고 기존 행은 "아직 가져가지 않았을 때만" 고친다
  const q = existing
    ? supabaseAdmin.from(TABLE).update(row).eq("id", existing.id).neq("status", "claimed").select("*")
    : supabaseAdmin.from(TABLE).insert(row).select("*");
  const { data, error } = await q;
  if (error) raise(error);
  if (!data || data.length === 0) {
    throw new Error("저장하는 사이 작업자가 공고를 가져갔습니다. 화면을 새로 고쳐 주세요.");
  }
  return { posting: toPosting(data[0]), newlyOpened: open && !wasOpen };
}

/** 공고 내리기 — 공고 중일 때만. 입력값은 남겨 두어 다시 올릴 수 있다 */
export async function closePosting(quoteId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: "draft", opened_at: null })
    .eq("quote_id", quoteId)
    .eq("status", "open")
    .select("id");
  if (error) raise(error);
  if (!data || data.length === 0) throw new JobUnavailableError("공고 중인 건이 아닙니다(이미 가져갔을 수 있습니다).");
}

/* ── 가져가기 ─────────────────────────────────────────────── */

/** 문의가 아직 살아 있는가 (활성 단계 + Drop 아님) */
async function quoteLiveness(quoteId: string): Promise<{ active: boolean; dropped: boolean; product: string; quantity: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("id, stage, dropped_at, product, quantity")
    .eq("id", quoteId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    active: isActiveStage(data.stage),
    dropped: !!data.dropped_at,
    product: data.product ?? "",
    quantity: data.quantity ?? "",
  };
}

export interface ClaimResult {
  assignmentId: string;
  /** 캘린더 등록 실패 사유 — 가져가기 자체는 성공 */
  calendarError: string | null;
}

/**
 * 선착순 가져가기. 늦게 누른 사람은 JobUnavailableError.
 * 배정 생성이 실패하면 공고를 다시 열어 둔다(누구도 못 가져간 상태로 잠기지 않게).
 */
export async function claimPosting(postingId: string, artistId: string): Promise<ClaimResult> {
  const posting = await getPosting(postingId);
  if (!posting) throw new JobUnavailableError("공고를 찾을 수 없습니다.");
  const quote = await quoteLiveness(posting.quoteId);
  if (!isVisibleToWorkers(posting, quote)) {
    throw new JobUnavailableError("이미 다른 작업자가 가져갔거나 공고가 내려갔습니다.");
  }

  const claimedAt = new Date().toISOString();
  const { data: won, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: "claimed", claimed_by: artistId, claimed_at: claimedAt })
    .eq("id", postingId)
    .eq("status", "open")
    .select("*");
  if (error) raise(error);
  if (!won || won.length === 0) throw new JobUnavailableError("이미 다른 작업자가 가져갔습니다.");
  const p = toPosting(won[0]);

  let assignmentId: string;
  try {
    const assignment = await createAssignment({
      quoteId: p.quoteId,
      artistId,
      status: "working",
      progress: 0,
      artistFee: p.artistFee,
      clientAmount: p.clientAmount,
      feeTaxMode: "none",
      clientVat: false,
      depositAmount: null,
      depositPaidAt: null,
      balancePaidAt: null,
      clientPaidAt: null,
      payoutStatus: "unpaid",
      paidAt: null,
      dueDate: p.dueDate,
      startedAt: kstDateKey(new Date(claimedAt)),
      memo: p.memo,
      // 스스로 고른 일이라 제안·수락이 가져간 순간 함께 일어난 것으로 기록한다
      offerStatus: "accepted",
      offeredAt: p.openedAt ?? claimedAt,
      respondedAt: claimedAt,
      declineReason: "",
      deliverables: [],
    });
    assignmentId = assignment.id;
  } catch (e) {
    await supabaseAdmin
      .from(TABLE)
      .update({ status: "open", claimed_by: null, claimed_at: null })
      .eq("id", postingId)
      .eq("claimed_by", artistId)
      .then(({ error: revertErr }) => revertErr && console.error("[job-board] claim revert failed:", revertErr.message));
    throw e;
  }

  const calendarError = await recordCalendar(p, artistId, assignmentId);
  const { error: linkErr } = await supabaseAdmin
    .from(TABLE)
    .update({ assignment_id: assignmentId })
    .eq("id", postingId);
  if (linkErr) console.error("[job-board] assignment link failed:", linkErr.message);

  return { assignmentId, calendarError };
}

/** 캘린더 일정 등록 — 실패해도 가져가기는 유지하고 사유를 공고에 남긴다 */
async function recordCalendar(p: JobPosting, artistId: string, assignmentId: string): Promise<string | null> {
  let eventId: string | null = null;
  let calendarError: string | null = null;
  try {
    const [names, quote] = await Promise.all([artistNames(), quoteLiveness(p.quoteId)]);
    const worker = names.get(artistId) ?? artistId;
    const product = label(PRODUCT_LABELS, quote?.product ?? "") || "제작 의뢰";
    eventId = await createCalendarEvent({
      summary: `[작업 마감] ${worker} · ${product}${quote?.quantity ? ` ${quote.quantity}` : ""}`,
      description: [
        `작업자: ${worker}`,
        `작업비: ${wonText(p.artistFee)} (세전)`,
        `마감일: ${p.dueDate}`,
        p.memo ? `전달 사항: ${p.memo}` : "",
        `가져간 시각: ${new Date(p.claimedAt ?? Date.now()).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
        `작업 관리: ${siteBase()}/admin/works`,
        `(배정 ${assignmentId})`,
      ]
        .filter(Boolean)
        .join("\n"),
      date: p.dueDate!,
    });
  } catch (e) {
    calendarError = e instanceof Error ? e.message : String(e);
    console.error("[job-board] calendar failed:", calendarError);
  }
  await supabaseAdmin
    .from(TABLE)
    .update({ calendar_event_id: eventId, calendar_error: calendarError })
    .eq("id", p.id)
    .then(({ error }) => error && console.error("[job-board] calendar record failed:", error.message));
  return calendarError;
}

/** 관리자가 캘린더 등록을 다시 시도 (권한을 붙인 뒤 등) */
export async function retryCalendar(quoteId: string): Promise<string | null> {
  const p = await getPostingByQuote(quoteId);
  if (!p || p.status !== "claimed" || !p.claimedBy || !p.assignmentId) {
    throw new Error("가져간 공고만 캘린더에 기록할 수 있습니다.");
  }
  if (p.calendarEventId) return null;
  return recordCalendar(p, p.claimedBy, p.assignmentId);
}

/**
 * 배정 취소(회수) — 배정은 취소, 캘린더 일정 삭제, 공고는 작성 상태로 되돌려 다시 올릴 수 있게 한다.
 * 이미 완료된 배정은 회수하지 않는다(정산 대상이라 기록을 흔들면 안 된다).
 */
export async function releasePosting(quoteId: string): Promise<{ calendarError: string | null }> {
  const p = await getPostingByQuote(quoteId);
  if (!p || p.status !== "claimed") throw new JobUnavailableError("가져간 공고가 아닙니다.");

  if (p.assignmentId) {
    const a = await getAssignment(p.assignmentId);
    if (a?.status === "done") throw new Error("이미 완료된 작업은 회수할 수 없습니다.");
    if (a && a.status !== "cancelled") await updateAssignment(a.id, { status: "cancelled" });
  }

  let calendarError: string | null = null;
  if (p.calendarEventId) {
    try {
      await deleteCalendarEvent(p.calendarEventId);
    } catch (e) {
      calendarError = e instanceof Error ? e.message : String(e);
      console.error("[job-board] calendar delete failed:", calendarError);
    }
  }

  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({
      status: "draft",
      opened_at: null,
      claimed_by: null,
      claimed_at: null,
      assignment_id: null,
      calendar_event_id: null,
      calendar_error: null,
      alert_50_at: null,
      alert_25_at: null,
      alert_10_at: null,
    })
    .eq("id", p.id)
    .eq("status", "claimed");
  if (error) raise(error);
  return { calendarError };
}

/* ── 작업자 시점 ──────────────────────────────────────────── */

/** 작업자에게 보여 주는 공고 — 견적가·고객 신원은 타입에 없다 */
export interface OpenJob {
  id: string;
  artistFee: number;
  dueDate: string;
  memo: string;
  openedAt: string | null;
  brief: WorkBrief;
}

/**
 * 고객 신원·견적가를 뺀 컬럼만 조회한다. artist-portal 의 QUOTE_BRIEF_COLUMNS 에
 * 공고 노출 판정용 stage·dropped_at 을 더한 것 — supabase-js 타입 파싱 때문에 한 줄 리터럴로 둔다.
 */
const QUOTE_JOB_COLUMNS =
  "id, stage, dropped_at, product, quantity, delivery_date, purpose, custom_design, style_type, product_text, color_request, notes, packaging, sampling, rushed, files, designs, file_name, file_url, logo_file_name, logo_file_url, created_at";

/** 공고 행 중 작업자에게 넘겨도 되는 컬럼 — client_amount 는 여기서부터 없다 */
const POSTING_WORKER_COLUMNS = "id, quote_id, status, artist_fee, due_date, memo, opened_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOpenJobs(postings: any[], quotes: any[]): OpenJob[] {
  const byId = new Map(quotes.map((q) => [q.id as string, q]));
  const jobs: OpenJob[] = [];
  for (const p of postings) {
    const q = byId.get(p.quote_id);
    const live = q ? { active: isActiveStage(q.stage), dropped: !!q.dropped_at } : null;
    const view = { status: isJobStatus(p.status) ? p.status : "draft", artistFee: p.artist_fee == null ? null : Number(p.artist_fee), dueDate: p.due_date ?? null };
    if (!isVisibleToWorkers(view, live)) continue;
    jobs.push({
      id: p.id,
      artistFee: view.artistFee!,
      dueDate: view.dueDate!,
      memo: p.memo ?? "",
      openedAt: p.opened_at ?? null,
      brief: toBrief(q),
    });
  }
  // 마감이 가까운 순
  return jobs.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export async function listOpenJobs(): Promise<OpenJob[]> {
  const { data: postings, error } = await supabaseAdmin
    .from(TABLE)
    .select(POSTING_WORKER_COLUMNS)
    .eq("status", "open");
  if (error) {
    if (isMissingTable(error)) return [];
    raise(error);
  }
  if (!postings || postings.length === 0) return [];
  const { data: quotes, error: qErr } = await supabaseAdmin
    .from("quotes")
    .select(QUOTE_JOB_COLUMNS)
    .in("id", postings.map((p) => p.quote_id));
  if (qErr) raise(qErr);
  return toOpenJobs(postings, quotes ?? []);
}

/** 공고 하나 — 공고 중이 아니면(가져갔거나 내렸으면) null: 다른 작업자에게는 더 이상 보이지 않는다 */
export async function getOpenJob(id: string): Promise<OpenJob | null> {
  const { data: p, error } = await supabaseAdmin
    .from(TABLE)
    .select(POSTING_WORKER_COLUMNS)
    .eq("id", id)
    .eq("status", "open")
    .maybeSingle();
  if (error) {
    if (isMissingTable(error) || error.code === "22P02") return null; // 22P02: uuid 형식 아님
    raise(error);
  }
  if (!p) return null;
  const { data: q, error: qErr } = await supabaseAdmin
    .from("quotes")
    .select(QUOTE_JOB_COLUMNS)
    .eq("id", p.quote_id)
    .maybeSingle();
  if (qErr) raise(qErr);
  return toOpenJobs([p], q ? [q] : [])[0] ?? null;
}

/* ── 알림 메일 ────────────────────────────────────────────── */

function summaryOf(p: JobPosting, quote: { product: string; quantity: string } | null): JobSummary {
  return {
    product: label(PRODUCT_LABELS, quote?.product ?? "") || "제작 의뢰",
    quantity: quote?.quantity ?? "",
    artistFee: p.artistFee,
    dueDate: p.dueDate ?? "",
    memo: p.memo,
  };
}

/** 승인·매칭된 포털 계정의 이메일 — artistId → email */
async function accountEmails(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from("artist_accounts")
    .select("artist_id, email, status")
    .eq("status", "approved");
  if (error) return new Map();
  return new Map(
    (data ?? [])
      .filter((r) => r.artist_id && r.email)
      .map((r) => [r.artist_id as string, r.email as string]),
  );
}

/** 새 공고 안내 — 명단 + 승인된 포털 계정 전원. 보낸 주소 수와 실패 목록을 돌려준다 */
export async function notifyNewPosting(p: JobPosting): Promise<{ sent: number; failed: string[] }> {
  const quote = await quoteLiveness(p.quoteId);
  const accounts = await accountEmails();
  const recipients = new Set<string>();
  for (const w of WORKER_ROSTER) recipients.add(w.email.toLowerCase());
  for (const [artistId, email] of accounts) {
    const e = workerEmail(artistId, email);
    if (e) recipients.add(e.toLowerCase());
  }
  const content = newJobMail(summaryOf(p, quote), `${siteBase()}/artist/jobs/${p.id}`);
  let sent = 0;
  const failed: string[] = [];
  for (const to of recipients) {
    try {
      await sendJobMail(to, content);
      sent++;
    } catch (e) {
      console.error("[job-board] new posting mail failed:", e instanceof Error ? e.message : e);
      failed.push(to);
    }
  }
  return { sent, failed };
}

export interface AlertRunResult {
  checked: number;
  sent: { postingId: string; stage: AlertStage; to: string }[];
  skipped: number;
  errors: string[];
}

/**
 * 마감 알림 점검 — 크론(맥 15분, Vercel 하루 1회)이 부른다. 몇 번을 불러도 같은 단계는 한 번만 나간다:
 * 보내기 전에 "이 단계 보냄"을 조건부(아직 NULL 일 때만)로 먼저 찍고, 발송이 실패하면 되돌린다.
 */
export async function processDueAlerts(now = Date.now()): Promise<AlertRunResult> {
  const result: AlertRunResult = { checked: 0, sent: [], skipped: 0, errors: [] };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("status", "claimed")
    .is("alert_10_at", null);
  if (error) {
    if (isMissingTable(error)) return result;
    raise(error);
  }

  const postings = (data ?? []).map(toPosting);
  if (postings.length === 0) return result;
  const [names, accounts] = await Promise.all([artistNames(), accountEmails()]);

  for (const p of postings) {
    result.checked++;
    if (!p.claimedBy || !p.assignmentId || !p.dueDate) continue;
    const plan = dueAlertStage(p, now);
    if (!plan) continue;

    const assignment = await getAssignment(p.assignmentId);
    if (!assignment || assignment.status === "done" || assignment.status === "cancelled") continue;

    const to = workerEmail(p.claimedBy, accounts.get(p.claimedBy));
    const stamp = new Date(now).toISOString();
    const col = ALERT_COLUMN[plan.send];
    const patch: Record<string, string> = { [col]: stamp };
    for (const s of plan.skip) patch[ALERT_COLUMN[s]] = stamp;

    // 선점: 이 단계가 아직 비어 있을 때만 찍는다 — 겹친 점검 중 하나만 통과
    const { data: claimed, error: stampErr } = await supabaseAdmin
      .from(TABLE)
      .update(patch)
      .eq("id", p.id)
      .is(col, null)
      .select("id");
    if (stampErr) {
      result.errors.push(`${p.id}: ${stampErr.message}`);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;
    result.skipped += plan.skip.length;

    if (!to) {
      result.errors.push(`${p.id}: ${p.claimedBy} 의 알림 메일 주소가 없습니다`);
      continue;
    }

    try {
      const quote = await quoteLiveness(p.quoteId);
      const isAdminWorker = WORKER_ROSTER.some((w) => w.admin && w.artistId === p.claimedBy);
      const url = isAdminWorker ? `${siteBase()}/admin/works` : `${siteBase()}/artist/works/${p.assignmentId}`;
      const content = dueAlertMail(
        { ...summaryOf(p, quote), workerName: names.get(p.claimedBy) ?? "작업자" },
        plan.send,
        deadlineMs(p.dueDate) - now,
        url,
      );
      await sendJobMail(to, content);
      result.sent.push({ postingId: p.id, stage: plan.send, to });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${p.id}: ${msg}`);
      // 다음 점검이 다시 보내도록 이 단계 표시만 되돌린다 (건너뛴 단계는 그대로 둔다)
      await supabaseAdmin
        .from(TABLE)
        .update({ [col]: null })
        .eq("id", p.id)
        .then(({ error: e2 }) => e2 && console.error("[job-board] alert revert failed:", e2.message));
    }
  }
  return result;
}
