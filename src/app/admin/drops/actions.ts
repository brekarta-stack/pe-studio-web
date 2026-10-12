"use server";

/**
 * Drop(/admin/drops) 서버 액션 — Drop 사유 기록.
 * 복구·영구 삭제는 제작 문의 액션(restoreQuote·deleteQuoteForever)을 그대로 쓴다.
 * 서버 액션은 프록시·레이아웃을 거치지 않으므로 권한 확인이 첫 줄이어야 한다.
 */

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** 사유는 한두 줄 메모 — 붙여넣기 사고로 긴 본문이 통째로 들어가지 않게 자른다 */
const MAX_REASON = 500;

/** 마이그레이션 20261013 전에는 quotes.lost_reason 이 없다 */
function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

/** Drop 사유 저장 — 빈 문자열이면 사유를 지운다 */
export async function setLostReason(id: string, reason: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!id) throw new Error("대상 문의가 없습니다.");
    const value = String(reason ?? "").trim().slice(0, MAX_REASON);

    const { error } = await supabaseAdmin
      .from("quotes")
      .update({ lost_reason: value })
      .eq("id", id);
    if (error) {
      // 컬럼이 없으면 원문 대신 무엇을 해야 하는지 알려 준다
      if (isMissingColumn(error)) {
        throw new Error("사유 컬럼이 아직 없습니다. DB 셋업에서 마이그레이션을 먼저 적용하세요.");
      }
      throw error;
    }

    revalidatePath("/admin/drops");
    revalidatePath("/admin/quotes");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/drops] action error:", msg);
    return { ok: false, error: msg };
  }
}
