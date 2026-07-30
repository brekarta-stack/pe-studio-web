"use server";

/**
 * 작업 관리(/admin/works) 서버 액션 — 배정 생성·수정·삭제.
 * 모든 액션은 관리자 권한을 확인한 뒤 실행한다.
 * 서버 액션은 프록시·레이아웃을 거치지 않으므로 여기가 유일한 방어선이다.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import {
  createAssignment,
  updateAssignment,
  deleteAssignment,
  getAssignment,
} from "@/lib/assignments";
import {
  derivePayoutStatus,
  isAssignmentStatus,
  isFeeTaxMode,
  type AssignmentInput,
} from "@/lib/assignment-types";

export type ActionResult = { ok: true } | { ok: false; error: string };


function fail(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[admin/works] action error:", msg);
  return { ok: false, error: msg };
}

function revalidate() {
  revalidatePath("/admin/works");
  revalidatePath("/admin/quotes");
  // 아티스트 포털도 같은 데이터를 본다 — 조건이 바뀌면 바로 반영되게
  revalidatePath("/artist");
  revalidatePath("/artist/settlements");
}

/** 새 배정 생성 — 리드와 아티스트는 필수, 나머지는 선택 */
export async function createWork(input: {
  quoteId: string;
  artistId: string;
  artistFee: number | null;
  clientAmount: number | null;
  depositAmount: number | null;
  feeTaxMode: string;
  clientVat: boolean;
  dueDate: string | null;
  memo: string;
  /** 만들자마자 아티스트에게 제안까지 보낼지. false 면 미제안(draft) 으로 둔다 */
  sendOffer: boolean;
}): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!input.quoteId) throw new Error("리드를 선택하세요.");
    if (!input.artistId) throw new Error("아티스트를 선택하세요.");
    if (
      input.depositAmount != null &&
      input.artistFee != null &&
      input.depositAmount > input.artistFee
    ) {
      throw new Error("선금이 작업비보다 클 수 없습니다.");
    }

    const payload: AssignmentInput = {
      quoteId: input.quoteId,
      artistId: input.artistId,
      status: "assigned",
      progress: 0,
      artistFee: input.artistFee,
      clientAmount: input.clientAmount,
      feeTaxMode: isFeeTaxMode(input.feeTaxMode) ? input.feeTaxMode : "none",
      clientVat: !!input.clientVat,
      depositAmount: input.depositAmount,
      depositPaidAt: null,
      balancePaidAt: null,
      payoutStatus: "unpaid",
      paidAt: null,
      dueDate: input.dueDate,
      startedAt: null,
      memo: input.memo,
      /* 제안을 바로 보내면 그 시점을 offered_at 에 남긴다.
         아티스트 포털은 draft 를 아예 보여주지 않으므로, 이 플래그가
         "아티스트에게 노출되는가"를 그대로 결정한다. */
      offerStatus: input.sendOffer ? "offered" : "draft",
      offeredAt: input.sendOffer ? new Date().toISOString() : null,
      respondedAt: null,
      declineReason: "",
      deliverables: [],
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
 * 지급 상태(payout_status)는 더 이상 직접 받지 않는다 — 선금/잔금 지급일에서
 * 도출해 저장한다. 두 곳에서 따로 관리하면 "지급완료인데 잔금 미지급" 같은
 * 모순이 생기기 때문. paid_at 은 전액 지급이 된 시점만 기록한다.
 */
export async function updateWork(
  id: string,
  patch: {
    status?: string;
    progress?: number;
    artistFee?: number | null;
    clientAmount?: number | null;
    feeTaxMode?: string;
    clientVat?: boolean;
    depositAmount?: number | null;
    depositPaidAt?: string | null;
    balancePaidAt?: string | null;
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
    if (patch.artistFee !== undefined) next.artistFee = patch.artistFee;
    if (patch.clientAmount !== undefined) next.clientAmount = patch.clientAmount;
    if (patch.feeTaxMode !== undefined) {
      if (!isFeeTaxMode(patch.feeTaxMode)) throw new Error(`알 수 없는 세금 처리입니다: ${patch.feeTaxMode}`);
      next.feeTaxMode = patch.feeTaxMode;
    }
    if (patch.clientVat !== undefined) next.clientVat = !!patch.clientVat;
    if (patch.depositAmount !== undefined) next.depositAmount = patch.depositAmount;
    if (patch.depositPaidAt !== undefined) next.depositPaidAt = patch.depositPaidAt || null;
    if (patch.balancePaidAt !== undefined) next.balancePaidAt = patch.balancePaidAt || null;
    if (patch.dueDate !== undefined) next.dueDate = patch.dueDate || null;
    if (patch.startedAt !== undefined) next.startedAt = patch.startedAt || null;
    if (patch.memo !== undefined) next.memo = patch.memo;

    /* 정산 관련 값이 바뀌었으면 지급 상태를 다시 도출한다.
       현재 저장값 위에 이번 변경을 얹어 계산해야 부분 수정에도 정확하다. */
    const touchesPayout =
      patch.artistFee !== undefined ||
      patch.depositAmount !== undefined ||
      patch.depositPaidAt !== undefined ||
      patch.balancePaidAt !== undefined;

    if (touchesPayout) {
      const current = await getAssignment(id);
      if (!current) throw new Error("배정을 찾을 수 없습니다.");
      const merged = { ...current, ...next };
      if (
        merged.depositAmount != null &&
        merged.artistFee != null &&
        merged.depositAmount > merged.artistFee
      ) {
        throw new Error("선금이 작업비보다 클 수 없습니다.");
      }
      const status = derivePayoutStatus(merged);
      next.payoutStatus = status;
      next.paidAt =
        status === "paid"
          ? current.paidAt ?? new Date().toISOString()
          : null;
    }

    await updateAssignment(id, next);
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 업무 제안 보내기 — 아티스트 포털에 노출하고 응답을 기다린다.
 *
 * 작업비가 정해지지 않은 채로 제안하면 아티스트가 "협의 예정"만 보고
 * 판단해야 하므로 여기서 막는다. 조건을 다 채운 뒤 보내는 게 이 기능의 취지다.
 */
export async function sendOffer(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const current = await getAssignment(id);
    if (!current) throw new Error("배정을 찾을 수 없습니다.");
    if (current.offerStatus === "offered") throw new Error("이미 제안한 업무입니다.");
    if (current.offerStatus === "accepted") throw new Error("이미 수락된 업무입니다.");
    if (current.artistFee == null) {
      throw new Error("작업비를 먼저 입력해야 제안할 수 있습니다.");
    }

    await updateAssignment(id, {
      offerStatus: "offered",
      offeredAt: new Date().toISOString(),
      // 거절됐던 건을 조건을 바꿔 다시 제안하는 경우 — 이전 응답 기록을 지운다
      respondedAt: null,
      declineReason: "",
      status: "assigned",
    });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 제안 회수 — 아직 응답 전일 때만. 조건을 다시 손보려는 경우 */
export async function withdrawOffer(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const current = await getAssignment(id);
    if (!current) throw new Error("배정을 찾을 수 없습니다.");
    if (current.offerStatus !== "offered") {
      throw new Error("응답 대기 중인 제안만 회수할 수 있습니다.");
    }

    await updateAssignment(id, { offerStatus: "draft", offeredAt: null });
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
