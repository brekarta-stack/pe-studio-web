"use server";

/**
 * 견적서 서버 액션 — 생성 → 확인 → 발송.
 *
 * 액션은 프록시·레이아웃을 거치지 않고 직접 호출될 수 있으므로 모든 액션이
 * 스스로 관리자 권한을 확인한다. 결과는 예외 대신 값으로 돌려준다.
 *
 * 상태 규칙
 *  - 내용을 고치거나 시트를 다시 그릴 때는 먼저 draft 로 내린다. 그리기에 성공해야
 *    generated(확인 대기)가 된다 → 옛 시트가 확인·발송되는 경로가 없다.
 *  - 확인은 "이 화면을 열 때 본 시트 판본"에 묶인다. 그 뒤에 시트가 바뀌었으면 거부한다.
 *  - 발송은 sending 잠금을 먼저 잡고, PDF 를 뽑기 전후로 시트 판본·합계를 다시 대조한다.
 *  - 메일이 나갔는지 모르는 실패는 되돌리지 않는다(두 번 나가는 것을 막는다). 사람이 판정한다.
 */

import { revalidatePath } from "next/cache";
import { Resend } from "resend";
import { getAdminEmail } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  deleteEstimateRow,
  getEstimate,
  insertEstimate,
  logEstimateEvent,
  markForRender,
  syncEstimateSheet,
  updateEstimateContent,
  updateEstimateIf,
  type Estimate,
} from "@/lib/estimates";
import {
  EDITABLE_STATUSES,
  SEND_STUCK_MS,
  buildFileName,
  classifySendError,
  formatAmount,
  isEditable,
  isUuid,
  parseEmailList,
  sameTotals,
  sanitizeEstimateInput,
  sheetTotalsConsistent,
} from "@/lib/estimate-types";
import { SUPPLIER } from "@/lib/estimate-sheet";
import {
  deleteConnection,
  exportSheetPdf,
  getConnection,
  getFileMeta,
  readSheetTotals,
  trashFile,
} from "@/lib/google-drive";
import { SEAL_MAX_BYTES, SEAL_TYPES, uploadSeal } from "@/lib/estimate-assets";

export type EstimateActionResult =
  | { ok: true; id?: string; warning?: string }
  | { ok: false; error: string };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fail(e: unknown): EstimateActionResult {
  const msg = errMsg(e);
  console.error("[admin/estimates] action error:", msg);
  return { ok: false, error: msg };
}

/** 관리자 확인 + 감사 기록에 남길 이메일 */
async function requireAdminActor(): Promise<string> {
  const email = await getAdminEmail();
  if (!email) throw new Error("권한이 없습니다. 다시 로그인해 주세요.");
  return email;
}

/** 조치 결과는 목록·상세·대시보드 어디에나 보이므로 어드민 전체를 갱신한다 */
function refresh() {
  revalidatePath("/admin", "layout");
}

async function load(id: string): Promise<Estimate> {
  if (!isUuid(id)) throw new Error("잘못된 견적서 id 입니다.");
  const e = await getEstimate(id);
  if (!e) throw new Error("견적서를 찾을 수 없습니다. (이미 삭제되었을 수 있습니다)");
  return e;
}

const EDITABLE = [...EDITABLE_STATUSES];

/* ── 1. 생성 ─────────────────────────────────────────────────── */

export async function createEstimate(raw: unknown): Promise<EstimateActionResult> {
  try {
    const actor = await requireAdminActor();
    const input = sanitizeEstimateInput(raw);
    if (!input.ok) return { ok: false, error: input.error };

    const est = await insertEstimate(input.value);
    await logEstimateEvent({
      estimateId: est.id,
      docNumber: est.docNumber,
      action: "created",
      actor,
      detail: { category: est.category, client: est.clientCompany, supply: est.supply },
    });

    // DB 에는 이미 들어갔다 — 시트가 실패해도 견적서는 남고(draft + last_error), 상세 화면에서 다시 시도한다
    let warning: string | undefined;
    try {
      const synced = await syncEstimateSheet(est);
      await logEstimateEvent({ estimateId: est.id, docNumber: est.docNumber, action: "sheet_generated", actor, detail: { sheetId: synced.sheetId } });
    } catch (e) {
      warning = `견적서는 저장했지만 구글 시트를 만들지 못했습니다: ${errMsg(e)}`;
      await logEstimateEvent({ estimateId: est.id, docNumber: est.docNumber, action: "sheet_failed", actor, detail: { error: errMsg(e) } });
    }
    refresh();
    return { ok: true, id: est.id, warning };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 시트 (다시) 그리기 — DB 내용으로 새로 그린다. 시트에서 직접 고친 내용은 사라진다.
 * 먼저 draft 로 내리므로 그리는 동안 확인·발송이 끼어들 수 없다.
 */
export async function regenerateSheet(id: string): Promise<EstimateActionResult> {
  try {
    const actor = await requireAdminActor();
    const cur = await load(id);
    const marked = await markForRender(id);
    if (!marked) return { ok: false, error: "발송했거나 발송 중인 견적서의 시트는 다시 그리지 않습니다." };
    try {
      const synced = await syncEstimateSheet(marked);
      await logEstimateEvent({ estimateId: id, docNumber: cur.docNumber, action: "sheet_generated", actor, detail: { sheetId: synced.sheetId, from: cur.status } });
    } catch (e) {
      await logEstimateEvent({ estimateId: id, docNumber: cur.docNumber, action: "sheet_failed", actor, detail: { error: errMsg(e) } });
      refresh();
      return fail(e);
    }
    refresh();
    return {
      ok: true,
      id,
      warning: cur.status === "confirmed" ? "시트를 다시 그려서 확인 완료가 풀렸습니다. 다시 확인하세요." : undefined,
    };
  } catch (e) {
    return fail(e);
  }
}

/* ── 수정 ────────────────────────────────────────────────────── */

export async function updateEstimate(id: string, raw: unknown): Promise<EstimateActionResult> {
  try {
    const actor = await requireAdminActor();
    const cur = await load(id);
    if (!isEditable(cur.status)) return { ok: false, error: "발송했거나 발송 중인 견적서는 고칠 수 없습니다." };

    const input = sanitizeEstimateInput(raw);
    if (!input.ok) return { ok: false, error: input.error };
    if (input.value.category !== cur.category) {
      return { ok: false, error: "구분(우드락/페이퍼토이)은 바꿀 수 없습니다. 새 견적서를 만드세요." };
    }

    const next = await updateEstimateContent(cur, input.value);
    if (!next) return { ok: false, error: "그사이 견적서 상태가 바뀌었습니다. 새로고침 후 다시 시도하세요." };
    await logEstimateEvent({
      estimateId: id,
      docNumber: next.docNumber,
      action: "updated",
      actor,
      detail: {
        supplyBefore: cur.supply,
        supplyAfter: next.supply,
        wasConfirmed: cur.status === "confirmed",
        ...(next.docNumber !== cur.docNumber ? { docNumberBefore: cur.docNumber } : {}),
      },
    });

    let warning: string | undefined;
    try {
      await syncEstimateSheet(next);
    } catch (e) {
      warning = `저장했지만 구글 시트에 반영하지 못했습니다: ${errMsg(e)}`;
      await logEstimateEvent({ estimateId: id, docNumber: next.docNumber, action: "sheet_failed", actor, detail: { error: errMsg(e) } });
    }
    refresh();
    return { ok: true, id, warning };
  } catch (e) {
    return fail(e);
  }
}

/* ── 2. 확인 ─────────────────────────────────────────────────── */

/**
 * 확인 완료.
 *
 * seenVersion: 상세 화면을 그릴 때 읽은 시트의 드라이브 modifiedTime. 사람이 본 PDF 는 그
 * 화면에서 연 것이므로, 지금 시트가 그 판본과 다르면 "본 적 없는 내용"을 확정하게 된다 — 거부한다.
 * 통과하면 시트가 계산한 합계로 DB 금액을 맞추고 그 판본을 발송 기준으로 찍는다.
 */
export async function confirmEstimate(id: string, seenVersion: string | null): Promise<EstimateActionResult> {
  try {
    const actor = await requireAdminActor();
    const cur = await load(id);
    if (cur.status !== "generated") return { ok: false, error: "확인 대기 상태의 견적서만 확인할 수 있습니다." };
    if (!cur.sheetId) return { ok: false, error: "구글 시트가 없습니다. 먼저 시트를 만드세요." };
    if (!seenVersion) return { ok: false, error: "시트 판본을 읽지 못한 화면입니다. 새로고침한 뒤 PDF 를 다시 보고 확인하세요." };

    const meta = await getFileMeta(cur.sheetId);
    if (!meta || meta.trashed) {
      return { ok: false, error: "드라이브에서 시트를 찾을 수 없습니다(삭제·휴지통). '시트 다시 만들기'를 누르세요." };
    }
    if (meta.modifiedTime !== seenVersion) {
      return { ok: false, error: "이 화면을 연 뒤 구글 시트가 수정되었습니다. 새로고침한 뒤 PDF 를 다시 보고 확인하세요." };
    }

    const totals = await readSheetTotals(cur.sheetId);
    if (!sheetTotalsConsistent(totals)) {
      return {
        ok: false,
        error: `시트의 합계가 서로 맞지 않습니다 (공급가액 ${formatAmount(totals.supply)} / 부가세 ${formatAmount(totals.vat)} / 합계 ${formatAmount(totals.total)}). 부가세·합계 칸을 숫자로 덮어썼다면 수식을 되살리거나 '시트 다시 만들기'를 하세요.`,
      };
    }
    const mismatch = !sameTotals(totals, cur);

    const next = await updateEstimateIf(id, ["generated"], {
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      sheet_modified_at: meta.modifiedTime,
      supply_amount: totals.supply,
      vat_amount: totals.vat,
      total_amount: totals.total,
      last_error: null,
    });
    if (!next) return { ok: false, error: "그사이 견적서 상태가 바뀌었습니다. 새로고침 후 다시 시도하세요." };

    await logEstimateEvent({
      estimateId: id,
      docNumber: cur.docNumber,
      action: "confirmed",
      actor,
      detail: {
        supply: totals.supply,
        total: totals.total,
        sheetModifiedAt: meta.modifiedTime,
        ...(mismatch ? { appSupply: cur.supply, sheetSupply: totals.supply } : {}),
      },
    });
    refresh();
    return {
      ok: true,
      id,
      warning: mismatch
        ? `시트에서 직접 고친 금액이 있어 시트 기준으로 맞췄습니다: 공급가액 ${formatAmount(cur.supply)}원 → ${formatAmount(totals.supply)}원. 메일 본문의 금액도 새 금액으로 바뀌었는지 보세요.`
        : undefined,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function unconfirmEstimate(id: string): Promise<EstimateActionResult> {
  try {
    const actor = await requireAdminActor();
    const cur = await load(id);
    const next = await updateEstimateIf(id, ["confirmed"], {
      status: "generated",
      confirmed_at: null,
      sheet_modified_at: null,
    });
    if (!next) return { ok: false, error: "발송 대기 상태에서만 확인을 취소할 수 있습니다." };
    await logEstimateEvent({ estimateId: id, docNumber: cur.docNumber, action: "unconfirmed", actor });
    refresh();
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

/* ── 3. 발송 ─────────────────────────────────────────────────── */

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function emailHtml(body: string): string {
  const paragraphs = esc(body).replace(/\n/g, "<br/>");
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;color:#111;font-size:14px;line-height:1.7;">
<div style="max-width:600px;">${paragraphs}</div>
<div style="max-width:600px;margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.6;">
${esc(SUPPLIER.company)} PE Studio · 대표 ${esc(SUPPLIER.ceo.replace(/\s/g, ""))} · 사업자등록번호 ${esc(SUPPLIER.bizNumber)}<br/>
${esc(SUPPLIER.address)}<br/>
Tel ${esc(SUPPLIER.phone)} · ${esc(SUPPLIER.managerEmail)} · <a href="${SUPPLIER.webUrl}" style="color:#1e22b2;">papercraft.kr</a>
</div></body></html>`;
}

/** 메일 API 한 번의 상한 — 넘기면 "나갔는지 모름"으로 처리한다. 함수 상한(60초) 안에 들어와야 한다 */
const SEND_TIMEOUT_MS = 20_000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

export interface SendInput {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

interface SendContext {
  actor: string;
  cur: Estimate;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  from: string;
  apiKey: string;
}

/** 발송 전 검증 — 잠금을 잡기 전에 입력·설정·상태를 전부 확인한다 */
async function prepareSend(id: string, raw: SendInput): Promise<{ ok: true; ctx: SendContext } | { ok: false; error: string }> {
  const actor = await requireAdminActor();
  const cur = await load(id);

  const to = parseEmailList(String(raw?.to ?? ""));
  if (!to.ok) return to;
  if (to.value.length === 0) return { ok: false, error: "받는 사람 이메일을 입력하세요." };
  const cc = parseEmailList(String(raw?.cc ?? ""));
  if (!cc.ok) return cc;
  const subject = String(raw?.subject ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200);
  const body = String(raw?.body ?? "").trim().slice(0, 5000);
  if (!subject) return { ok: false, error: "메일 제목을 입력하세요." };
  if (!body) return { ok: false, error: "메일 본문을 입력하세요." };

  const apiKey = process.env.RESEND_API_KEY;
  // 보내는 사람은 대표 주소(ask@papercraft.kr)로 고정한다. 문의 폼 알림의 발신 주소
  // (INQUIRY_FROM_EMAIL = no-reply@…)를 물려받으면 고객이 받은 견적서에 "답장 못 받는 주소"가
  // 보이고, 회신(replyTo)·보관 사본(bcc)과 계정이 갈린다. 바꾸려면 ESTIMATE_FROM_EMAIL 로.
  const from = process.env.ESTIMATE_FROM_EMAIL ?? `PE Studio <${SUPPLIER.managerEmail}>`;
  if (!apiKey) return { ok: false, error: "메일 발송 설정(RESEND_API_KEY)이 없습니다." };

  if (cur.status !== "confirmed") return { ok: false, error: "확인 완료(발송 대기)된 견적서만 발송할 수 있습니다." };
  if (!cur.sheetId) return { ok: false, error: "구글 시트가 없습니다." };

  return { ok: true, ctx: { actor, cur, to: to.value, cc: cc.value, subject, body, from, apiKey } };
}

export async function sendEstimate(id: string, raw: SendInput): Promise<EstimateActionResult> {
  let ctx: SendContext;
  try {
    const prepared = await prepareSend(id, raw);
    if (!prepared.ok) return prepared;
    ctx = prepared.ctx;
  } catch (e) {
    return fail(e);
  }
  const { actor, cur, to, cc, subject, body } = ctx;
  const sentTo = [...to, ...cc.map((c) => `cc:${c}`)].join(", ");

  // 발송 잠금 — 여기서부터는 한 번에 한 요청만 들어온다. 받는 사람을 미리 적어 둬
  // 도중에 끊겨도 "발송된 것으로 처리"가 실제 수신자를 남긴다.
  const claimed = await updateEstimateIf(id, ["confirmed"], { status: "sending", sent_to: sentTo, last_error: null }).catch(() => null);
  if (!claimed) return { ok: false, error: "이미 발송 중이거나 그사이 상태가 바뀌었습니다. 새로고침 후 확인하세요." };

  /**
   * 메일이 확실히 안 나갔을 때 되돌린다. rejectedBySendApi 는 메일 서버가 요청을 받고 거절한 경우 —
   * 그 멱등 키는 이미 쓰였으므로 시도 번호를 올려 다음 발송이 새 키로 나가게 한다.
   */
  const abortBeforeSend = async (reason: string, back: "generated" | "confirmed", rejectedBySendApi = false) => {
    const patch =
      back === "generated"
        ? { status: "generated", confirmed_at: null, sheet_modified_at: null, last_error: reason }
        : {
            status: "confirmed",
            last_error: reason,
            ...(rejectedBySendApi ? { send_attempt: claimed.sendAttempt + 1 } : {}),
          };
    await updateEstimateIf(id, ["sending"], patch).catch(() => null);
    await logEstimateEvent({ estimateId: id, docNumber: claimed.docNumber, action: back === "generated" ? "send_blocked" : "send_failed", actor, detail: { reason } });
    refresh();
    return { ok: false as const, error: reason };
  };

  const sheetId = claimed.sheetId;
  if (!sheetId || !claimed.sheetModifiedAt) return abortBeforeSend("시트 정보가 없습니다. 다시 확인하세요.", "generated");

  // 1) 확인한 판본 그대로인가 — 판본·합계를 PDF 를 뽑기 전후로 대조한다
  let pdf: Buffer;
  try {
    const before = await getFileMeta(sheetId);
    if (!before || before.trashed) return abortBeforeSend("드라이브에서 시트를 찾을 수 없습니다.", "generated");
    if (before.modifiedTime !== claimed.sheetModifiedAt) {
      return abortBeforeSend("확인 이후 구글 시트가 수정되었습니다. 발송될 PDF 를 다시 보고 확인해 주세요.", "generated");
    }
    const totals = await readSheetTotals(sheetId);
    if (!sameTotals(totals, claimed)) {
      return abortBeforeSend(
        `시트 합계(${formatAmount(totals.supply)}원)가 확인한 금액(${formatAmount(claimed.supply)}원)과 다릅니다. 다시 확인해 주세요.`,
        "generated",
      );
    }
    pdf = await exportSheetPdf(sheetId, claimed.sheetGid);
    const after = await getFileMeta(sheetId);
    if (!after || after.modifiedTime !== claimed.sheetModifiedAt) {
      return abortBeforeSend("PDF 를 뽑는 사이 구글 시트가 수정되었습니다. 다시 확인해 주세요.", "generated");
    }
  } catch (e) {
    return abortBeforeSend(errMsg(e), "confirmed");
  }

  // 2) 메일 — 멱등 키는 "확인 건 + 거절된 시도 수"로 만든다. 나갔는지 모르는 요청 뒤의 재시도는
  //    같은 키로 나가므로, 앞선 요청이 메일 서버에 접수됐다면 새로 보내지 않고 409 로 돌아온다(24시간).
  const bcc = process.env.ESTIMATE_BCC_EMAIL ?? process.env.INQUIRY_TO_EMAIL ?? SUPPLIER.managerEmail;
  const recipients = new Set([...to, ...cc].map((a) => a.toLowerCase()));
  const idempotencyKey = `estimate-${id}-${new Date(claimed.confirmedAt ?? 0).getTime()}-${claimed.sendAttempt}`;
  let resendId = "";
  try {
    const resend = new Resend(ctx.apiKey);
    const result = await withTimeout(
      resend.emails.send(
        {
          from: ctx.from,
          to,
          cc: cc.length ? cc : undefined,
          // 회사 보관용 사본 — 받는 사람과 겹치면 빼서 두 번 가지 않게
          bcc: bcc && !recipients.has(bcc.toLowerCase()) ? [bcc] : undefined,
          replyTo: process.env.ESTIMATE_REPLY_TO ?? SUPPLIER.managerEmail,
          subject,
          text: body,
          html: emailHtml(body),
          attachments: [{ filename: `${buildFileName(claimed)}.pdf`, content: pdf }],
        },
        { idempotencyKey },
      ),
      SEND_TIMEOUT_MS,
    );
    // Resend SDK 는 실패해도 throw 하지 않고 { error } 를 돌려준다 — 반드시 확인한다
    const sendErr = result === "timeout" ? null : result.error;
    if (result === "timeout" || sendErr) {
      const kind = result === "timeout" ? "ambiguous" : classifySendError(sendErr);
      const reason =
        result === "timeout"
          ? "메일 서버 응답이 제한 시간 안에 오지 않았습니다."
          : sendErr?.name === "invalid_idempotent_request" || sendErr?.name === "concurrent_idempotent_requests"
            ? "같은 발송 건의 앞선 요청이 이미 메일 서버에 접수돼 있습니다 — 이미 나갔을 가능성이 큽니다."
            : `메일 발송 실패: ${sendErr?.message ?? JSON.stringify(sendErr)}`;
      if (kind === "rejected") return abortBeforeSend(reason, "confirmed", true);
      // 나갔는지 모른다 — 되돌리지 않고 sending 에 둔다. 3분 뒤 사람이 보관 사본을 보고 정리한다
      await supabaseAdmin
        .from("estimates")
        .update({ last_error: `${reason} 메일이 나갔는지 확인할 수 없습니다.` })
        .eq("id", id)
        .eq("status", "sending");
      await logEstimateEvent({ estimateId: id, docNumber: claimed.docNumber, action: "send_uncertain", actor, detail: { reason, to } });
      refresh();
      return {
        ok: false,
        error: `${reason} 메일이 실제로 나갔는지 알 수 없습니다. ask@papercraft.kr 보관 사본을 확인한 뒤, 3분 후 이 화면에서 결과를 골라 정리하세요.`,
      };
    }
    resendId = result.data?.id ?? "";
  } catch (e) {
    // SDK 가 던지는 경우(설정 오류 등)는 요청 전에 막힌 것 — 안 나갔다
    return abortBeforeSend(errMsg(e), "confirmed");
  }

  // 3) 발송 완료 기록 — 메일은 이미 나갔으므로 여기서 실패해도 "발송 실패"로 되돌리지 않는다
  let warning: string | undefined;
  const done = await updateEstimateIf(id, ["sending"], {
    status: "sent",
    sent_at: new Date().toISOString(),
    sent_to: sentTo,
    last_error: null,
  }).catch((e) => {
    warning = `메일은 발송됐지만 상태 저장에 실패했습니다: ${errMsg(e)}`;
    return null;
  });
  if (!done && !warning) warning = "메일은 발송됐지만 상태 저장에 실패했습니다. 3분 뒤 상세 화면에서 '발송된 것으로 처리'를 누르세요.";

  await logEstimateEvent({
    estimateId: id,
    docNumber: claimed.docNumber,
    action: "sent",
    actor,
    detail: { to, cc, subject, resendId, supply: claimed.supply, total: claimed.total },
  });

  // 연결된 제작 문의를 "견적발송" 단계로 — 앞 단계(접수·상담중)일 때만 올린다
  if (cur.quoteId) {
    const { error } = await supabaseAdmin
      .from("quotes")
      .update({ stage: "quoted" })
      .eq("id", cur.quoteId)
      .in("stage", ["new", "consulting"]);
    if (error) console.warn("[admin/estimates] 제작 문의 단계 갱신 실패:", error.message);
  }

  refresh();
  return { ok: true, id, warning };
}

/**
 * 발송 잠금이 풀리지 않은 건 정리 — 함수가 끊겼거나 메일 서버 응답이 애매했을 때.
 * 메일이 실제로 나갔는지는 앱이 알 수 없으므로 사람이 보관 사본을 보고 고른다.
 * "발송 대기로 되돌리기" 뒤 다시 보내면 같은 멱등 키로 나간다 — 앞선 요청이 메일 서버에
 * 접수됐다면(24시간 안) 새로 보내지 않고 다시 "결과 불명"으로 멈춘다. 중복 발송은 없다.
 */
export async function resolveStuckSending(id: string, outcome: "sent" | "confirmed"): Promise<EstimateActionResult> {
  try {
    const actor = await requireAdminActor();
    const cur = await load(id);
    if (cur.status !== "sending") return { ok: false, error: "발송 중 상태가 아닙니다." };
    if (Date.now() - new Date(cur.updatedAt).getTime() < SEND_STUCK_MS) {
      return { ok: false, error: "발송이 진행 중일 수 있습니다. 3분 뒤에 다시 시도하세요." };
    }

    const patch =
      outcome === "sent"
        ? { status: "sent", sent_at: new Date().toISOString(), sent_to: cur.sentTo ?? cur.clientEmail }
        : { status: "confirmed" };
    const next = await updateEstimateIf(id, ["sending"], patch);
    if (!next) return { ok: false, error: "그사이 상태가 바뀌었습니다. 새로고침하세요." };
    await logEstimateEvent({ estimateId: id, docNumber: cur.docNumber, action: "sending_reset", actor, detail: { outcome, sentTo: cur.sentTo } });
    refresh();
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

/* ── 삭제 ────────────────────────────────────────────────────── */

/**
 * 발송 전 견적서 삭제. 기록을 먼저 쓰고, 기록이 실패하면 지우지 않는다.
 * 시트는 드라이브 휴지통으로 보낸다 (30일 안에 되살릴 수 있다).
 */
export async function deleteEstimate(id: string): Promise<EstimateActionResult> {
  try {
    const actor = await requireAdminActor();
    const cur = await load(id);
    if (!isEditable(cur.status)) return { ok: false, error: "발송했거나 발송 중인 견적서는 삭제할 수 없습니다." };

    await logEstimateEvent(
      {
        estimateId: id,
        docNumber: cur.docNumber,
        action: "deleted",
        actor,
        detail: { client: cur.clientCompany, supply: cur.supply, status: cur.status, sheetId: cur.sheetId },
      },
      { strict: true },
    );
    const removed = await deleteEstimateRow(id, EDITABLE);
    if (!removed) {
      // 기록은 먼저 남겼으므로, 실제로는 지우지 않았다는 사실을 이어서 남긴다
      await logEstimateEvent({ estimateId: id, docNumber: cur.docNumber, action: "delete_aborted", actor, detail: { reason: "상태가 바뀌어 삭제하지 않음" } });
      return { ok: false, error: "그사이 상태가 바뀌어 삭제하지 않았습니다. 새로고침하세요." };
    }

    let warning: string | undefined;
    if (cur.sheetId) {
      try {
        await trashFile(cur.sheetId);
      } catch (e) {
        warning = "trash_failed";
        console.error("[admin/estimates] 시트 휴지통 이동 실패:", errMsg(e));
      }
    }
    refresh();
    return { ok: true, warning };
  } catch (e) {
    return fail(e);
  }
}

/* ── 구글 연결·도장 ──────────────────────────────────────────── */

export async function disconnectGoogle(): Promise<EstimateActionResult> {
  try {
    const actor = await requireAdminActor();
    const conn = await getConnection();
    await deleteConnection();
    await logEstimateEvent({ estimateId: null, action: "google_disconnected", actor, detail: { email: conn?.email ?? "" } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 도장 이미지 등록·교체. 시트의 도장은 이 이미지를 그때그때 받아 가므로, 사람이 본 PDF 와
 * 다른 도장으로 나갈 수 있다 — 발송 전 견적서(확인 대기·발송 대기)는 전부 "시트 미반영"으로
 * 내린다. 다시 그리면 도장 주소의 판(v)이 바뀌어 구글 이미지 캐시도 끊긴다.
 */
export async function uploadSealImage(form: FormData): Promise<EstimateActionResult> {
  try {
    const actor = await requireAdminActor();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "이미지 파일을 고르세요." };
    if (!(SEAL_TYPES as readonly string[]).includes(file.type)) return { ok: false, error: "PNG 또는 JPG 파일만 올릴 수 있습니다." };
    if (file.size > SEAL_MAX_BYTES) return { ok: false, error: "도장 이미지는 800KB 이하로 올려 주세요." };
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadSeal(bytes, file.type);
    await logEstimateEvent({ estimateId: null, action: "seal_uploaded", actor, detail: { bytes: file.size, type: file.type } });

    const { data: demoted, error: demoteErr } = await supabaseAdmin
      .from("estimates")
      .update({ status: "draft", confirmed_at: null, sheet_modified_at: null, updated_at: new Date().toISOString() })
      .in("status", ["generated", "confirmed"])
      .select("id, doc_number");
    if (demoteErr) {
      return { ok: false, error: `도장은 저장했지만 진행 중인 견적서를 되돌리지 못했습니다. 발송 전에 각 견적서의 시트를 다시 그리세요: ${demoteErr.message}` };
    }
    for (const row of demoted ?? []) {
      await logEstimateEvent({ estimateId: row.id, docNumber: row.doc_number, action: "reconfirm_required", actor, detail: { reason: "도장 이미지 교체" } });
    }
    refresh();
    const n = demoted?.length ?? 0;
    return {
      ok: true,
      warning: `도장 이미지를 저장했습니다.${n ? ` 발송 전 견적서 ${n}건은 '시트에 반영'을 눌러 새 도장으로 다시 그린 뒤 확인하세요.` : ""}`,
    };
  } catch (e) {
    return fail(e);
  }
}
