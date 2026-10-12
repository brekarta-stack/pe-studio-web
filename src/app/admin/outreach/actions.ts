"use server";

/**
 * 제안 영업 보드(/admin/outreach) 서버 액션.
 * 서버 액션은 프록시·레이아웃을 거치지 않고 직접 호출될 수 있으므로
 * 모든 액션의 첫 줄에서 관리자 권한을 다시 확인한다.
 *
 * 이 화면의 쓰기는 전부 20261013 마이그레이션 컬럼에 기대므로 옛 컬럼 폴백을 두지 않는다
 * (마이그레이션 전이면 page.tsx 가 보드 대신 안내 카드를 띄운다).
 */

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAdminEmail, requireAdmin } from "@/lib/session";
import { addActivity } from "@/lib/lead-activities";
import {
  isActivityKind,
  isRecentlyProposed,
  normalizeOrgKey,
  type ActivityKind,
} from "@/lib/lead-activity-types";
import { isOutreachStage, STAGE_LABELS } from "@/lib/assignment-types";
import { defaultFollowupDate, SALES_PATHS } from "@/lib/outreach";
import type { ActionResult } from "@/app/admin/quotes/actions";

/** 같은 기관에 최근 제안한 기록 — 등록 전에 사람에게 한 번 더 묻기 위한 정보 */
export type DuplicateResult = {
  ok: false;
  duplicate: { id: string; org: string; daysAgo: number; stage: string };
};

function fail(e: unknown): ActionResult {
  const msg =
    e instanceof Error
      ? e.message
      : e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string"
        ? (e as { message: string }).message
        : String(e);
  console.error("[admin/outreach] action error:", msg);
  return { ok: false, error: msg };
}

function revalidateSales(): void {
  for (const p of SALES_PATHS) revalidatePath(p);
}

/** 활동 기록 — best-effort. 본 조치는 이미 반영됐으므로 기록 실패로 "실패"를 돌려주지 않는다 */
async function logActivity(quoteId: string, kind: ActivityKind, body: string): Promise<void> {
  try {
    await addActivity({ quoteId, kind, body, actor: (await getAdminEmail()) ?? "" });
  } catch (e) {
    console.error("[admin/outreach] activity log failed:", e);
  }
}

/** YYYY-MM-DD 만 받는다. 빈 값은 null(예정일 없음) */
function parseDate(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) {
    throw new Error(`날짜 형식이 올바르지 않습니다: ${s}`);
  }
  return s;
}

/** 점수는 1~5 정수만. 비우면 null */
function parseScore(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  const n = Math.round(Number(v));
  if (n < 1 || n > 5) throw new Error("점수는 1~5 사이로 입력하세요.");
  return n;
}

/** 링크는 http(s) 만 — 보드에서 그대로 <a href> 로 열기 때문에 javascript: 같은 값은 막는다 */
function parseUrl(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
  } catch {
    throw new Error("제안서 링크는 http(s) 주소여야 합니다.");
  }
  return s;
}

async function readQuote(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.from("quotes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("리드를 찾을 수 없습니다.");
  return data as Record<string, unknown>;
}

/* ── 새 리드 등록 ─────────────────────────────────────────── */

export async function createOutreachLead(input: {
  org: string;
  segment: string;
  score: number | null;
  contactName: string;
  contactEmail: string;
  phone: string;
  proposalUrl: string;
  memo: string;
  nextActionAt: string | null;
  force: boolean;
}): Promise<ActionResult | DuplicateResult> {
  try {
    await requireAdmin();

    const org = (input.org ?? "").trim();
    if (!org) throw new Error("기관명을 입력하세요.");
    const orgKey = normalizeOrgKey(org);
    const proposalUrl = parseUrl(input.proposalUrl);
    const score = parseScore(input.score);
    const nextActionAt = parseDate(input.nextActionAt);

    /* 중복 제안 금지는 기관 단위 — 캠페인 slug 가 달라도 같은 기관이면 경고한다.
       Drop 된 건은 "다시 제안해도 되는 상태"로 보고 제외한다. */
    if (!input.force) {
      const { data: existing, error: dupErr } = await supabaseAdmin
        .from("quotes")
        .select("id, org, org_key, stage, created_at, proposal_sent_at")
        .eq("org_key", orgKey)
        .is("dropped_at", null);
      if (dupErr) throw dupErr;
      const records = (existing ?? []).map((r) => ({
        id: r.id as string,
        org: (r.org as string) ?? "",
        stage: r.stage as string,
        orgKey: (r.org_key as string) ?? "",
        createdAt: r.created_at as string,
        proposalSentAt: (r.proposal_sent_at as string | null) ?? null,
      }));
      const hit = isRecentlyProposed(records, orgKey, 180);
      if (hit.hit && hit.match) {
        return {
          ok: false,
          duplicate: {
            id: hit.match.id,
            org: hit.match.org || org,
            daysAgo: hit.daysAgo ?? 0,
            stage: hit.match.stage,
          },
        };
      }
    }

    const now = new Date().toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("quotes")
      .insert({
        source: "outbound",
        stage: proposalUrl ? "drafted" : "sourced",
        org,
        org_key: orgKey,
        segment: (input.segment ?? "").trim() || null,
        score,
        name: (input.contactName ?? "").trim(),
        email: (input.contactEmail ?? "").trim(),
        phone: (input.phone ?? "").trim(),
        proposal_url: proposalUrl || null,
        next_action_at: nextActionAt,
        notes: (input.memo ?? "").trim(),
        // 폼 전용 항목 — 인바운드 수동 등록과 같이 빈 값으로 둔다
        custom_design: "",
        color_request: "",
        stage_changed_at: now,
      })
      .select("id")
      .single();
    if (error) throw error;

    await logActivity(row.id as string, "system", "제안 영업 리드 등록");
    revalidateSales();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ── 리드 정보 수정 ───────────────────────────────────────── */

export async function updateOutreachLead(
  id: string,
  patch: {
    org?: string;
    segment?: string;
    score?: number | null;
    contactName?: string;
    contactEmail?: string;
    phone?: string;
    proposalUrl?: string;
  }
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const update: Record<string, unknown> = {};
    if (patch.org !== undefined) {
      const org = patch.org.trim();
      if (!org) throw new Error("기관명은 비울 수 없습니다.");
      update.org = org;
      // 기관명이 바뀌면 중복 판정 키도 같이 바뀌어야 한다
      update.org_key = normalizeOrgKey(org);
    }
    if (patch.segment !== undefined) update.segment = patch.segment.trim() || null;
    if (patch.score !== undefined) update.score = parseScore(patch.score);
    if (patch.contactName !== undefined) update.name = patch.contactName.trim();
    if (patch.contactEmail !== undefined) update.email = patch.contactEmail.trim();
    if (patch.phone !== undefined) update.phone = patch.phone.trim();
    if (patch.proposalUrl !== undefined) update.proposal_url = parseUrl(patch.proposalUrl) || null;
    if (Object.keys(update).length === 0) return { ok: true };

    const { error } = await supabaseAdmin.from("quotes").update(update).eq("id", id);
    if (error) throw error;
    revalidateSales();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ── 제안서 발송 기록 ─────────────────────────────────────── */

/**
 * 실제 발송은 메일·전화로 사람이 한다 — 여기는 "보냈다"는 사실을 남기는 자리다.
 * 다음 액션일이 비어 있으면 일주일 뒤로 잡아 팔로업이 빠지지 않게 한다.
 */
export async function markProposalSent(
  id: string,
  input: { sentTo: string; note?: string }
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const sentTo = (input.sentTo ?? "").trim();
    if (!sentTo) throw new Error("수신처를 입력하세요.");
    const note = (input.note ?? "").trim();

    const current = await readQuote(id);
    const now = new Date();
    const { error } = await supabaseAdmin
      .from("quotes")
      .update({
        stage: "sent",
        proposal_sent_at: now.toISOString(),
        proposal_sent_to: sentTo,
        next_action_at: (current.next_action_at as string | null) ?? defaultFollowupDate(now),
        stage_changed_at: now.toISOString(),
      })
      .eq("id", id);
    if (error) throw error;

    await logActivity(id, "proposal_sent", `${sentTo}${note ? " · " + note : ""}`);
    revalidateSales();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ── 다음 액션일 ──────────────────────────────────────────── */

export async function setNextAction(id: string, date: string | null): Promise<ActionResult> {
  try {
    await requireAdmin();
    const next = parseDate(date);
    const { error } = await supabaseAdmin.from("quotes").update({ next_action_at: next }).eq("id", id);
    if (error) throw error;
    revalidateSales();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ── 전환 / 전환 취소 ─────────────────────────────────────── */

/**
 * 답장이 왔다 → 상담중으로 전환. source 는 'outbound' 그대로 둔다
 * (아웃바운드의 매출 기여를 나중에 세기 위해 — 계획 §2 원칙 1).
 */
export async function convertLead(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const current = await readQuote(id);
    if (!isOutreachStage(current.stage)) {
      throw new Error("제안 영업 단계의 리드만 전환할 수 있습니다.");
    }
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("quotes")
      .update({ stage: "consulting", converted_at: now, stage_changed_at: now })
      .eq("id", id);
    if (error) throw error;
    await logActivity(id, "convert", "제안 영업 → 상담중");
    revalidateSales();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 실수로 전환했을 때 — 아직 상담중일 때만 팔로업으로 되돌린다 (견적 이후는 되돌리면 이력이 꼬인다) */
export async function unconvertLead(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const current = await readQuote(id);
    if (!current.converted_at || current.stage !== "consulting") {
      throw new Error("전환 직후(상담중) 상태에서만 전환을 취소할 수 있습니다.");
    }
    const { error } = await supabaseAdmin
      .from("quotes")
      .update({ stage: "followup", converted_at: null, stage_changed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    await logActivity(id, "system", `전환 취소 → ${STAGE_LABELS.followup}`);
    revalidateSales();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ── 활동 메모 ────────────────────────────────────────────── */

/** 사람이 직접 남길 수 있는 활동 종류 — 나머지(발송·단계·전환·Drop…)는 조치가 자동으로 남긴다 */
const MANUAL_KINDS: readonly ActivityKind[] = ["note", "call", "email", "meeting"];

/**
 * 활동 한 줄 추가. nextActionAt 을 넘기면(null 포함) 다음 액션일도 함께 바꾼다
 * — 통화하고 "다음 주에 다시"를 한 번에 적을 수 있게.
 * append-only 라 이 파일에 수정·삭제 액션은 없다.
 */
export async function addLeadActivity(
  quoteId: string,
  kind: string,
  body: string,
  nextActionAt?: string | null
): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!isActivityKind(kind) || !MANUAL_KINDS.includes(kind)) {
      throw new Error(`직접 기록할 수 없는 활동 종류입니다: ${kind}`);
    }
    const text = (body ?? "").trim();
    if (!text) throw new Error("내용을 입력하세요.");
    const next = nextActionAt === undefined ? undefined : parseDate(nextActionAt);

    // 활동 기록이 이 액션의 본체이므로 여기서는 best-effort 가 아니라 실패를 그대로 돌려준다
    await addActivity({ quoteId, kind, body: text, actor: (await getAdminEmail()) ?? "" });

    if (next !== undefined) {
      const { error } = await supabaseAdmin.from("quotes").update({ next_action_at: next }).eq("id", quoteId);
      if (error) throw error;
    }
    revalidateSales();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
