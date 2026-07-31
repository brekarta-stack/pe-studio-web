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
import { isManualChannel, manualAcquisition } from "@/lib/quote-types";


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

/**
 * 수동 문의 등록 — 전화·이메일처럼 폼 밖으로 들어온 문의를 관리자가 직접 넣는다.
 *
 * 폼 제출(/api/quote)과 같은 quotes 테이블에 넣으므로 이후 흐름(단계 관리·
 * 아티스트 배정·정산)이 전부 동일하게 굴러간다. 다른 점은 유입정보뿐 —
 * 접수 경로를 acquisition 에 남겨 유입 열에서 "직접 등록 · 전화"로 구분된다.
 *
 * 고객 확인 메일은 보내지 않는다. 이미 통화·메일로 이야기가 오간 건이라
 * 접수 확인 메일이 뜬금없이 가면 곤란하다.
 */
export async function createManualQuote(input: {
  name: string;
  phone: string;
  email: string;
  channel: string;
  product: string;
  quantity: string;
  deliveryDate: string;
  purpose: string;
  notes: string;
}): Promise<ActionResult> {
  try {
    await requireAdmin();

    const name = input.name.trim();
    if (!name) throw new Error("고객 이름을 입력하세요.");

    const phone = input.phone.trim();
    const email = input.email.trim();
    // 둘 다 없으면 나중에 다시 연락할 방법이 없다 — 등록 시점에 막는다
    if (!phone && !email) throw new Error("연락처나 이메일 중 하나는 입력해야 합니다.");

    if (!isManualChannel(input.channel)) throw new Error("접수 경로를 선택하세요.");

    const { error } = await supabaseAdmin.from("quotes").insert({
      name,
      phone,
      email,
      product: input.product.trim(),
      quantity: input.quantity.trim(),
      delivery_date: input.deliveryDate.trim(),
      purpose: input.purpose.trim(),
      notes: input.notes.trim(),
      // 폼 전용 항목들은 비워 둔다 — 상담하며 시트에서 채워 나간다
      custom_design: "",
      color_request: "",
      stage: "new",
      acquisition: manualAcquisition(input.channel),
    });
    if (error) throw error;

    revalidatePath("/admin/quotes");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
