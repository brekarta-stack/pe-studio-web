"use server";

/**
 * 작업 관리(/admin/works) 서버 액션 — 배정 생성·수정·삭제.
 * 모든 액션은 세션을 확인한 뒤 실행한다 (어드민 전용).
 */

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import {
  createAssignment,
  updateAssignment,
  deleteAssignment,
} from "@/lib/assignments";
import {
  isAssignmentStatus,
  isPayoutStatus,
  type AssignmentInput,
} from "@/lib/assignment-types";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin(): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("권한이 없습니다.");
}

function fail(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[admin/works] action error:", msg);
  return { ok: false, error: msg };
}

function revalidate() {
  revalidatePath("/admin/works");
  revalidatePath("/admin/quotes");
}

/** 새 배정 생성 — 리드와 아티스트는 필수, 나머지는 선택 */
export async function createWork(input: {
  quoteId: string;
  artistId: string;
  artistFee: number | null;
  clientAmount: number | null;
  dueDate: string | null;
  memo: string;
}): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!input.quoteId) throw new Error("리드를 선택하세요.");
    if (!input.artistId) throw new Error("아티스트를 선택하세요.");

    const payload: AssignmentInput = {
      quoteId: input.quoteId,
      artistId: input.artistId,
      status: "assigned",
      progress: 0,
      artistFee: input.artistFee,
      clientAmount: input.clientAmount,
      payoutStatus: "unpaid",
      paidAt: null,
      dueDate: input.dueDate,
      startedAt: null,
      memo: input.memo,
    };
    await createAssignment(payload);
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 배정 수정. 전달된 필드만 반영한다.
 *
 * 지급상태를 'paid' 로 바꾸면 paid_at 을 자동 기록하고,
 * 되돌리면 지운다 — 화면에서 따로 날짜를 입력하게 하지 않기 위함.
 */
export async function updateWork(
  id: string,
  patch: {
    status?: string;
    progress?: number;
    artistFee?: number | null;
    clientAmount?: number | null;
    payoutStatus?: string;
    dueDate?: string | null;
    startedAt?: string | null;
    memo?: string;
  }
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const next: Partial<AssignmentInput> = {};

    if (patch.status !== undefined) {
      if (!isAssignmentStatus(patch.status)) throw new Error(`알 수 없는 상태입니다: ${patch.status}`);
      next.status = patch.status;
    }
    if (patch.progress !== undefined) {
      const p = Math.round(patch.progress);
      if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error("진행률은 0~100 사이여야 합니다.");
      next.progress = p;
    }
    if (patch.payoutStatus !== undefined) {
      if (!isPayoutStatus(patch.payoutStatus)) throw new Error(`알 수 없는 지급상태입니다: ${patch.payoutStatus}`);
      next.payoutStatus = patch.payoutStatus;
      next.paidAt = patch.payoutStatus === "paid" ? new Date().toISOString() : null;
    }
    if (patch.artistFee !== undefined) next.artistFee = patch.artistFee;
    if (patch.clientAmount !== undefined) next.clientAmount = patch.clientAmount;
    if (patch.dueDate !== undefined) next.dueDate = patch.dueDate || null;
    if (patch.startedAt !== undefined) next.startedAt = patch.startedAt || null;
    if (patch.memo !== undefined) next.memo = patch.memo;

    await updateAssignment(id, next);
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteWork(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await deleteAssignment(id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
