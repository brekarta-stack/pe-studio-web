"use server";

/**
 * 제작 문의 시트의 인라인 편집용 서버 액션.
 * 모든 액션은 세션을 확인한 뒤 실행한다 (어드민 전용).
 */

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { setQuoteArtist } from "@/lib/assignments";
import { isQuoteStage } from "@/lib/assignment-types";

async function requireAdmin(): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("권한이 없습니다.");
}

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
