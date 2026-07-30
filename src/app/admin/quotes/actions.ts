"use server";

/**
 * 제작 문의 시트의 인라인 편집용 서버 액션.
 * 모든 액션은 관리자 권한을 확인한 뒤 실행한다.
 * 서버 액션은 프록시·레이아웃을 거치지 않으므로 여기가 유일한 방어선이다.
 */

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { setQuoteArtist } from "@/lib/assignments";
import { isQuoteStage } from "@/lib/assignment-types";
import { requireAdmin } from "@/lib/session";


/** 편집 결과 — 클라이언트가 실패를 사용자에게 보여줄 수 있게 예외 대신 값으로 돌려준다 */
export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[admin/quotes] action error:", msg);
  return { ok: false, error: msg };
}

/** 진행 여부 체크박스 토글 */
export async function setQuoteProgress(id: string, value: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { error } = await supabaseAdmin
      .from("quotes")
      .update({ in_progress: value })
      .eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/quotes");
    revalidatePath("/admin/works");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 진행 단계 변경 */
export async function setQuoteStage(id: string, stage: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!isQuoteStage(stage)) throw new Error(`알 수 없는 단계입니다: ${stage}`);
    const { error } = await supabaseAdmin.from("quotes").update({ stage }).eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/quotes");
    revalidatePath("/admin/works");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 담당 아티스트 지정 — artistId 가 빈 문자열이면 배정 해제 */
export async function assignArtist(quoteId: string, artistId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await setQuoteArtist(quoteId, artistId || null);
    revalidatePath("/admin/quotes");
    revalidatePath("/admin/works");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Drop(제외) 처리 — 제작 문의 목록에서 빼고 운영 > Drop 으로 보낸다.
 * dropped_at 에 현재 시각을 찍는다. 배정/단계는 건드리지 않아 복구 시 그대로 살아난다.
 */
export async function dropQuote(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { error } = await supabaseAdmin
      .from("quotes")
      .update({ dropped_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/quotes");
    revalidatePath("/admin/drops");
    revalidatePath("/admin/works");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Drop 복구 — dropped_at 을 비워 제작 문의 목록으로 되돌린다 */
export async function restoreQuote(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { error } = await supabaseAdmin
      .from("quotes")
      .update({ dropped_at: null })
      .eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/quotes");
    revalidatePath("/admin/drops");
    revalidatePath("/admin/works");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
