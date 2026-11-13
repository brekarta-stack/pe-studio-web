"use server";

/**
 * 작업 공고(/admin/jobs) 서버 액션 — 공고 작성·올리기·내리기, 관리자 가져가기, 회수.
 * 서버 액션은 프록시를 거치지 않고 직접 호출될 수 있으므로 액션마다 requireAdmin() 으로 막는다.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { kstDateKey } from "@/lib/kst";
import { ADMIN_WORKER, validatePosting } from "@/lib/job-board-types";
import {
  claimPosting,
  closePosting,
  notifyNewPosting,
  releasePosting,
  retryCalendar,
  savePosting,
} from "@/lib/job-board";

export type JobActionResult = { ok: true; message?: string } | { ok: false; error: string };

function fail(e: unknown): JobActionResult {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[admin/jobs] action error:", msg);
  return { ok: false, error: msg };
}

function revalidate() {
  revalidatePath("/admin/jobs");
  revalidatePath("/admin/works");
  revalidatePath("/admin/quotes");
  revalidatePath("/artist");
  revalidatePath("/artist/jobs");
}

/**
 * 공고 저장. open=true 면 공고로 올린다. notify=true 면 처음 올라갈 때 작업자 전원에게 메일.
 * 메일 실패는 공고를 되돌리지 않는다 — 공고는 이미 포털에 보이고, 실패한 주소만 알려 준다.
 */
export async function saveJobPosting(
  quoteId: string,
  input: { clientAmount: string; artistFee: string; dueDate: string; memo: string },
  open: boolean,
  notify: boolean,
): Promise<JobActionResult> {
  try {
    await requireAdmin();
    if (!quoteId) throw new Error("문의를 찾을 수 없습니다.");
    const v = validatePosting(input, { open, todayKst: kstDateKey() });
    if (!v.ok) throw new Error(v.error);

    const { posting, newlyOpened } = await savePosting(quoteId, v.value, open);
    let message = open ? (newlyOpened ? "공고를 올렸습니다." : "공고 내용을 고쳤습니다.") : "저장했습니다(작업자에게는 아직 안 보입니다).";
    if (newlyOpened && notify) {
      const { sent, failed } = await notifyNewPosting(posting);
      message += ` 작업자 ${sent}명에게 메일을 보냈습니다.`;
      if (failed.length) message += ` 실패: ${failed.join(", ")}`;
    }
    revalidate();
    return { ok: true, message };
  } catch (e) {
    return fail(e);
  }
}

export async function closeJobPosting(quoteId: string): Promise<JobActionResult> {
  try {
    await requireAdmin();
    await closePosting(quoteId);
    revalidate();
    return { ok: true, message: "공고를 내렸습니다." };
  } catch (e) {
    return fail(e);
  }
}

/** 관리자 계정으로 가져가기 — 오세기(ADMIN_WORKER)로 배정된다 */
export async function claimJobAsAdmin(postingId: string): Promise<JobActionResult> {
  try {
    await requireAdmin();
    const { calendarError } = await claimPosting(postingId, ADMIN_WORKER.artistId);
    revalidate();
    return {
      ok: true,
      message: `${ADMIN_WORKER.name} 님으로 배정했습니다.${calendarError ? ` 캘린더 기록 실패: ${calendarError}` : ""}`,
    };
  } catch (e) {
    return fail(e);
  }
}

/** 배정 회수 — 배정 취소 + 캘린더 일정 삭제, 공고는 작성 상태로 */
export async function releaseJob(quoteId: string): Promise<JobActionResult> {
  try {
    await requireAdmin();
    const { calendarError } = await releasePosting(quoteId);
    revalidate();
    return {
      ok: true,
      message: `배정을 취소했습니다. 다시 공고할 수 있습니다.${calendarError ? ` 캘린더 일정 삭제 실패(직접 지워 주세요): ${calendarError}` : ""}`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function retryJobCalendar(quoteId: string): Promise<JobActionResult> {
  try {
    await requireAdmin();
    const err = await retryCalendar(quoteId);
    revalidate();
    if (err) throw new Error(err);
    return { ok: true, message: "캘린더에 기록했습니다." };
  } catch (e) {
    return fail(e);
  }
}
