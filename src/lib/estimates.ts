/**
 * 견적서 저장소 (서버 전용) — DB 읽기·쓰기, 문서 번호 발급, 시트 동기화, 감사 기록.
 *
 * DB 가 원본이고 시트는 DB 로 그린 결과물이다. 앱에서 저장하면 시트를 다시 그린다.
 * 단, 발송되는 PDF 는 시트에서 뽑는다 — 사람이 시트에서 직접 고친 것까지 그대로 나간다.
 * 그래서 확인 단계에서 시트의 합계를 읽어 DB 금액을 맞추고, 그 시점의 드라이브
 * 수정 시각을 찍어 둔다. 발송 직전에 수정 시각이 달라졌으면 다시 확인하게 한다.
 */

import { supabaseAdmin } from "./supabase-admin";
import {
  EDITABLE_STATUSES,
  ESTIMATE_STATUSES,
  STATUS_PRIORITY,
  buildDocNumber,
  buildFileName,
  computeTotals,
  docNumberBase,
  isEstimateCategory,
  isEstimateStatus,
  nextDocSeq,
  type EstimateCategory,
  type EstimateInput,
  type EstimateItem,
  type EstimateStatus,
} from "./estimate-types";
import {
  createSpreadsheetFile,
  ensureCategoryFolder,
  getFileMeta,
  renderEstimateSheet,
} from "./google-drive";

export interface Estimate {
  id: string;
  category: EstimateCategory;
  docNumber: string;
  clientCompany: string;
  clientContact: string;
  clientEmail: string;
  issuedOn: string;
  deliveryTerm: string;
  deliveryPlace: string;
  paymentTerm: string;
  items: EstimateItem[];
  supply: number;
  vat: number;
  total: number;
  status: EstimateStatus;
  /** 내용 판번호 — 저장할 때마다 1씩 오른다. 시트를 그린 판과 지금 내용이 같은지 가린다 */
  contentRev: number;
  /** 메일 서버가 확실히 거절한 발송 시도 수 — 멱등 키에 넣어, 거절 뒤 재시도가 새 요청이 되게 한다 */
  sendAttempt: number;
  quoteId: string | null;
  sheetId: string | null;
  sheetGid: number | null;
  sheetUrl: string | null;
  sheetModifiedAt: string | null;
  confirmedAt: string | null;
  sentAt: string | null;
  sentTo: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function estimateFromRow(r: any): Estimate {
  return {
    id: r.id,
    category: isEstimateCategory(r.category) ? r.category : "papertoy",
    docNumber: r.doc_number,
    clientCompany: r.client_company,
    clientContact: r.client_contact ?? "",
    clientEmail: r.client_email ?? "",
    issuedOn: String(r.issued_on).slice(0, 10),
    deliveryTerm: r.delivery_term ?? "",
    deliveryPlace: r.delivery_place ?? "",
    paymentTerm: r.payment_term ?? "",
    items: Array.isArray(r.items) ? (r.items as EstimateItem[]) : [],
    supply: Number(r.supply_amount ?? 0),
    vat: Number(r.vat_amount ?? 0),
    total: Number(r.total_amount ?? 0),
    status: isEstimateStatus(r.status) ? r.status : "draft",
    contentRev: Number(r.content_rev ?? 0),
    sendAttempt: Number(r.send_attempt ?? 0),
    quoteId: r.quote_id ?? null,
    sheetId: r.sheet_id ?? null,
    sheetGid: r.sheet_gid === null || r.sheet_gid === undefined ? null : Number(r.sheet_gid),
    sheetUrl: r.sheet_url ?? null,
    sheetModifiedAt: r.sheet_modified_at ?? null,
    confirmedAt: r.confirmed_at ?? null,
    sentAt: r.sent_at ?? null,
    sentTo: r.sent_to ?? null,
    lastError: r.last_error ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ── 조회 ───────────────────────────────────────────────────── */

export interface EstimateFilter {
  status?: EstimateStatus | "";
  category?: EstimateCategory | "";
  q?: string;
}

export const LIST_LIMIT = 300;

/**
 * 목록 — 사람 손이 필요한 상태(멈춤·확인 대기·발송 대기)를 위로, 같은 상태 안에서는 최신순.
 * 표가 없으면(마이그레이션 전) error 를 그대로 돌려 화면이 안내하게 한다.
 */
export async function listEstimates(
  f: EstimateFilter = {},
): Promise<{ rows: Estimate[]; truncated: boolean; error: string | null }> {
  const build = () => {
    let query = supabaseAdmin.from("estimates").select("*").order("created_at", { ascending: false }).limit(LIST_LIMIT);
    if (f.category) query = query.eq("category", f.category);
    const q = (f.q ?? "").trim();
    if (q) {
      // PostgREST or() 문법을 깨는 문자는 빼고 검색한다
      const safe = q.replace(/[,()*%"\\]/g, " ").trim();
      if (safe) {
        const pat = `"*${safe}*"`;
        query = query.or(`client_company.ilike.${pat},doc_number.ilike.${pat},client_email.ilike.${pat}`);
      }
    }
    return query;
  };

  // 상태를 고르지 않았으면 "처리할 것"과 "발송 완료"를 따로 읽는다 — 발송 완료가 많이 쌓여도
  // 오래된 확인 대기·발송 중 건이 상한에 잘려 안 보이는 일이 없게
  const parts = f.status
    ? [await build().eq("status", f.status)]
    : await Promise.all([build().neq("status", "sent"), build().eq("status", "sent")]);
  const failed = parts.find((p) => p.error);
  if (failed?.error) return { rows: [], truncated: false, error: failed.error.message };

  const rows = parts.flatMap((p) => (p.data ?? []).map(estimateFromRow));
  // 안정 정렬이라 같은 상태 안에서는 DB 의 최신순이 유지된다
  rows.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);
  return { rows, truncated: parts.some((p) => (p.data ?? []).length >= LIST_LIMIT), error: null };
}

/** 상태별 건수 — 로우를 읽지 않고 count 만 (목록 상한과 무관하게 정확하다) */
export async function countByStatus(): Promise<Record<EstimateStatus, number>> {
  const entries = await Promise.all(
    ESTIMATE_STATUSES.map(async (st) => {
      const { count, error } = await supabaseAdmin
        .from("estimates")
        .select("id", { count: "exact", head: true })
        .eq("status", st);
      return [st, error ? 0 : count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<EstimateStatus, number>;
}

/** 없으면 null, DB 오류면 예외 — "없음"과 "못 읽음"을 화면이 구분해 보여 준다 */
export async function getEstimate(id: string): Promise<Estimate | null> {
  const { data, error } = await supabaseAdmin.from("estimates").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`견적서를 읽지 못했습니다: ${error.message}`);
  return data ? estimateFromRow(data) : null;
}

/* ── 감사 기록 ──────────────────────────────────────────────── */

export interface EstimateEvent {
  id: number;
  estimateId: string | null;
  docNumber: string;
  action: string;
  detail: Record<string, unknown>;
  actor: string;
  createdAt: string;
}

export const EVENT_LABELS: Record<string, string> = {
  created: "생성",
  sheet_generated: "시트 생성",
  sheet_failed: "시트 생성 실패",
  updated: "수정",
  confirmed: "확인 완료",
  unconfirmed: "확인 취소",
  sent: "발송",
  send_failed: "발송 실패",
  send_blocked: "발송 차단",
  send_uncertain: "발송 결과 불명",
  sending_reset: "발송 잠금 해제",
  deleted: "삭제",
  delete_aborted: "삭제 취소됨",
  pdf_viewed: "PDF 열람",
  reconfirm_required: "재확인 필요",
  google_connect_failed: "구글 연결 실패",
  google_connected: "구글 연결",
  google_disconnected: "구글 연결 해제",
  seal_uploaded: "도장 이미지 등록",
};

/**
 * 기록 쓰기. 기본은 실패해도 조치를 막지 않는다(로그만 크게 남긴다).
 * strict 이면 실패 시 throw — 삭제처럼 "기록 없이 일어나면 안 되는" 조치에 쓴다.
 */
export async function logEstimateEvent(
  e: { estimateId: string | null; docNumber?: string; action: string; detail?: Record<string, unknown>; actor: string },
  opts: { strict?: boolean } = {},
): Promise<void> {
  const { error } = await supabaseAdmin.from("estimate_events").insert({
    estimate_id: e.estimateId,
    doc_number: e.docNumber ?? "",
    action: e.action,
    detail: e.detail ?? {},
    actor: e.actor,
  });
  if (error) {
    console.error(`[estimates] 감사 기록 실패 (${e.action} ${e.docNumber ?? ""}):`, error.message);
    if (opts.strict) throw new Error(`감사 기록을 남기지 못해 중단했습니다: ${error.message}`);
  }
}

export async function listEstimateEvents(opts: { estimateId?: string; limit?: number } = {}): Promise<EstimateEvent[]> {
  let q = supabaseAdmin
    .from("estimate_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.estimateId) q = q.eq("estimate_id", opts.estimateId);
  const { data, error } = await q;
  if (error || !data) return [];
  return data.map((r) => ({
    id: Number(r.id),
    estimateId: r.estimate_id ?? null,
    docNumber: r.doc_number ?? "",
    action: r.action,
    detail: (r.detail ?? {}) as Record<string, unknown>,
    actor: r.actor ?? "",
    createdAt: r.created_at,
  }));
}

/* ── 쓰기 ───────────────────────────────────────────────────── */

function inputColumns(input: EstimateInput) {
  const t = computeTotals(input.items);
  return {
    client_company: input.clientCompany,
    client_contact: input.clientContact,
    client_email: input.clientEmail,
    issued_on: input.issuedOn,
    delivery_term: input.deliveryTerm,
    delivery_place: input.deliveryPlace,
    payment_term: input.paymentTerm,
    items: input.items,
    supply_amount: t.supply,
    vat_amount: t.vat,
    total_amount: t.total,
    quote_id: input.quoteId,
  };
}

/** 이 구분·날짜의 다음 문서 번호. exceptId 는 자기 자신(날짜를 바꾸는 중인 견적서)을 셈에서 뺀다 */
async function nextDocNumber(category: EstimateCategory, issuedOn: string, exceptId?: string): Promise<string> {
  const base = docNumberBase(category, issuedOn);
  let q = supabaseAdmin.from("estimates").select("doc_number").like("doc_number", `${base}%`);
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return buildDocNumber(category, issuedOn, nextDocSeq(base, (data ?? []).map((r) => r.doc_number as string)));
}

/** 23505 = unique 위반 → 동시에 같은 번호를 잡았다. 다시 센다 */
const isUniqueViolation = (e: { code?: string } | null | undefined) => e?.code === "23505";

/** 새 견적서 (시트 없이 draft 로). 문서 번호가 겹치면 다음 순번으로 다시 시도한다 */
export async function insertEstimate(input: EstimateInput): Promise<Estimate> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const docNumber = await nextDocNumber(input.category, input.issuedOn);
    const { data, error } = await supabaseAdmin
      .from("estimates")
      .insert({ ...inputColumns(input), category: input.category, doc_number: docNumber, status: "draft" })
      .select("*")
      .single();
    if (!error && data) return estimateFromRow(data);
    if (!isUniqueViolation(error)) throw new Error(error?.message ?? "견적서를 저장하지 못했습니다.");
  }
  throw new Error("문서 번호를 발급하지 못했습니다. 잠시 후 다시 시도하세요.");
}

/**
 * 조건부 갱신 — 현재 상태가 allowed 중 하나일 때만 바꾼다.
 * 두 화면에서 동시에 누르거나 두 번 눌러도 한쪽만 통과한다. 통과 못 하면 null.
 */
export async function updateEstimateIf(
  id: string,
  allowed: EstimateStatus[],
  patch: Record<string, unknown>,
  match: Record<string, string | number> = {},
): Promise<Estimate | null> {
  let q = supabaseAdmin
    .from("estimates")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", allowed);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data, error } = await q.select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? estimateFromRow(data) : null;
}

/**
 * 내용 수정 — 항상 draft 로 되돌린다. 시트를 다시 그리는 데 성공해야 generated 가 되므로,
 * 그리기가 실패하면 옛 시트가 "확인 대기"로 남아 그대로 확인·발송되는 일이 없다.
 * 견적 일자가 바뀌면 문서 번호(TO+날짜)도 새 날짜로 다시 발급한다 — 발송 전이라 바꿔도 된다.
 */
export async function updateEstimateContent(cur: Estimate, input: EstimateInput): Promise<Estimate | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const docNumber =
      input.issuedOn === cur.issuedOn ? cur.docNumber : await nextDocNumber(cur.category, input.issuedOn, cur.id);
    const { data, error } = await supabaseAdmin
      .from("estimates")
      .update({
        ...inputColumns(input),
        doc_number: docNumber,
        content_rev: cur.contentRev + 1,
        status: "draft",
        confirmed_at: null,
        sheet_modified_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cur.id)
      .eq("content_rev", cur.contentRev) // 두 탭에서 동시에 고치면 뒤에 저장한 쪽이 거절된다
      .in("status", [...EDITABLE_STATUSES])
      .select("*")
      .maybeSingle();
    if (!error) return data ? estimateFromRow(data) : null;
    if (!isUniqueViolation(error)) throw new Error(error.message);
  }
  throw new Error("문서 번호를 다시 발급하지 못했습니다. 잠시 후 다시 시도하세요.");
}

/**
 * 시트를 다시 그리기 전에 draft 로 내린다 — 그리는 동안 발송 잠금이 잡히지 않게,
 * 그리다 실패하면 확인 전 상태로 남게. 통과 못 하면(발송 중·발송 완료) null.
 */
export async function markForRender(id: string): Promise<Estimate | null> {
  return updateEstimateIf(id, [...EDITABLE_STATUSES], {
    status: "draft",
    confirmed_at: null,
    sheet_modified_at: null,
  });
}

export async function deleteEstimateRow(id: string, allowed: EstimateStatus[]): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("estimates")
    .delete()
    .eq("id", id)
    .in("status", allowed)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/* ── 시트 동기화 ────────────────────────────────────────────── */

/**
 * DB 내용으로 시트를 만들거나 다시 그린다. draft 인 견적서만 받는다(호출 전에 markForRender
 * 또는 updateEstimateContent 로 내려 둔다). 성공하면 generated, 실패하면 draft 에 남기고
 * last_error 를 적은 뒤 예외를 다시 던진다.
 */
export async function syncEstimateSheet(e: Estimate): Promise<Estimate> {
  if (e.status !== "draft") throw new Error("시트를 그리려면 먼저 '시트 미반영' 상태여야 합니다.");
  const fileName = buildFileName(e);
  try {
    let sheetId = e.sheetId;
    let sheetUrl = e.sheetUrl;
    let managedGid = e.sheetGid;
    if (sheetId) {
      // 드라이브에서 지웠거나 휴지통에 넣었으면 새 파일로 다시 만든다
      const meta = await getFileMeta(sheetId);
      if (!meta || meta.trashed) sheetId = null;
    }
    if (!sheetId) {
      const folderId = await ensureCategoryFolder(e.category);
      const created = await createSpreadsheetFile(fileName, folderId);
      sheetId = created.id;
      sheetUrl = created.url;
      managedGid = null;
      // 파일 id 부터 저장 — 그리다 실패해도 다음 시도가 새 파일을 또 만들지 않게
      await supabaseAdmin
        .from("estimates")
        .update({ sheet_id: sheetId, sheet_url: sheetUrl, sheet_gid: null, updated_at: new Date().toISOString() })
        .eq("id", e.id)
        .eq("status", "draft");
    }
    const { gid } = await renderEstimateSheet(sheetId, managedGid, e, fileName);
    const next = await updateEstimateIf(
      e.id,
      ["draft"],
      {
        sheet_id: sheetId,
        sheet_url: sheetUrl,
        sheet_gid: gid,
        status: "generated",
        confirmed_at: null,
        sheet_modified_at: null,
        last_error: null,
      },
      { content_rev: e.contentRev }, // 그리는 사이 내용이 바뀌었으면 이 그림은 옛 판이다
    );
    if (!next) {
      // 옛 판으로 시트를 덮었을 수 있다 — 다른 요청이 먼저 "확인 대기"로 올렸다면 미반영으로 되돌린다.
      // (이미 확인까지 됐다면 시트 수정 시각이 바뀌었으므로 발송 전 대조에서 막힌다)
      await supabaseAdmin
        .from("estimates")
        .update({
          status: "draft",
          last_error: "시트를 동시에 여러 번 그려 최신 내용이 아닐 수 있습니다. '시트에 반영'을 다시 누르세요.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", e.id)
        .eq("status", "generated");
      throw new Error("시트를 그리는 동안 견적서 내용이나 상태가 바뀌었습니다. 새로고침 후 '시트에 반영'을 다시 누르세요.");
    }
    return next;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("estimates")
      .update({ last_error: msg, updated_at: new Date().toISOString() })
      .eq("id", e.id)
      .eq("status", "draft");
    throw err;
  }
}
