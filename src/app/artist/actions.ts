"use server";

/**
 * 아티스트 포털 서버 액션.
 *
 * 모든 액션이 requireArtist() 로 시작하고, 대상 배정이 **정말 내 것인지**를
 * assertOwnedAssignment 로 한 번 더 확인한다. 액션은 프록시를 거치지 않고
 * 직접 호출될 수 있으므로, id 만 바꿔 남의 업무를 건드리지 못하게 막는 건
 * 여기가 유일한 방어선이다.
 */

import { revalidatePath } from "next/cache";
import { requireArtist } from "@/lib/session";
import { updateAssignment } from "@/lib/assignments";
import { appendDeliverable, assertOwnedAssignment } from "@/lib/artist-portal";
import {
  canArtistWorkOn,
  canRespondToOffer,
  isAssignmentStatus,
} from "@/lib/assignment-types";
import { applyForAccount, acceptInvite, getAccountByInviteToken } from "@/lib/artist-accounts";
import { isInviteValid, isValidEmail, normalizeEmail } from "@/lib/artist-account-types";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[artist] action error:", msg);
  return { ok: false, error: msg };
}

function revalidate(assignmentId?: string) {
  revalidatePath("/artist");
  revalidatePath("/artist/settlements");
  if (assignmentId) revalidatePath(`/artist/works/${assignmentId}`);
  // 관리자 화면도 즉시 반영 — 수락/거절과 진행률은 관리자가 바로 봐야 한다
  revalidatePath("/admin/works");
}

/**
 * 업무 제안 수락 / 거절.
 *
 * 수락하면 착수일을 오늘로 기록한다 — 아티스트가 "언제부터 시작했나"를
 * 따로 입력하게 하지 않고 수락 시점을 그대로 쓴다.
 * 거절하면 배정 상태도 cancelled 로 내려 관리자 보드에서 다른 사람에게
 * 재배정할 대상으로 드러나게 한다.
 */
export async function respondToOffer(
  assignmentId: string,
  accept: boolean,
  reason = ""
): Promise<ActionResult> {
  try {
    const { artistId } = await requireArtist();
    const assignment = await assertOwnedAssignment(artistId, assignmentId);

    if (!canRespondToOffer(assignment.offerStatus)) {
      throw new Error("이미 응답한 업무입니다.");
    }

    const now = new Date();
    if (accept) {
      await updateAssignment(assignmentId, {
        offerStatus: "accepted",
        respondedAt: now.toISOString(),
        status: "working",
        startedAt: assignment.startedAt ?? now.toLocaleDateString("en-CA"),
      });
    } else {
      await updateAssignment(assignmentId, {
        offerStatus: "declined",
        respondedAt: now.toISOString(),
        declineReason: reason.trim().slice(0, 500),
        status: "cancelled",
      });
    }

    revalidate(assignmentId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 진행률·작업 상태 갱신 — 수락한 업무만 */
export async function updateWorkProgress(
  assignmentId: string,
  patch: { progress?: number; status?: string }
): Promise<ActionResult> {
  try {
    const { artistId } = await requireArtist();
    const assignment = await assertOwnedAssignment(artistId, assignmentId);
    if (!canArtistWorkOn(assignment)) {
      throw new Error("수락한 업무만 수정할 수 있습니다.");
    }

    const next: { progress?: number; status?: "working" | "review" | "done" } = {};

    if (patch.progress !== undefined) {
      const p = Math.round(patch.progress);
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        throw new Error("진행률은 0~100 사이여야 합니다.");
      }
      next.progress = p;
    }

    if (patch.status !== undefined) {
      /* 아티스트가 고를 수 있는 상태는 셋뿐이다.
         'assigned'(배정됨)로 되돌리거나 'cancelled'(취소)를 스스로 찍는 건
         관리자 판단 영역이라 여기서 막는다. */
      if (!isAssignmentStatus(patch.status)) {
        throw new Error(`알 수 없는 상태입니다: ${patch.status}`);
      }
      if (patch.status !== "working" && patch.status !== "review" && patch.status !== "done") {
        throw new Error("작업중·검수·완료 중에서 선택해 주세요.");
      }
      next.status = patch.status;
    }

    if (Object.keys(next).length === 0) return { ok: true };

    await updateAssignment(assignmentId, next);
    revalidate(assignmentId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 결과물 등록 — 파일 자체는 /api/artist/upload 가 스토리지에 올리고,
 * 여기서는 그 결과(url·name)를 배정에 붙이기만 한다.
 */
export async function addWorkDeliverable(
  assignmentId: string,
  file: { name: string; url: string }
): Promise<ActionResult> {
  try {
    const { artistId } = await requireArtist();
    const assignment = await assertOwnedAssignment(artistId, assignmentId);
    if (!canArtistWorkOn(assignment)) {
      throw new Error("수락한 업무만 결과물을 올릴 수 있습니다.");
    }
    if (!file?.url) throw new Error("업로드된 파일이 없습니다.");
    if (assignment.deliverables.length >= 20) {
      throw new Error("결과물은 최대 20개까지 등록할 수 있습니다.");
    }

    await updateAssignment(assignmentId, {
      deliverables: appendDeliverable(assignment.deliverables, {
        name: file.name || "파일",
        url: file.url,
      }),
    });
    revalidate(assignmentId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 결과물 삭제 — 잘못 올린 파일 정리용 (스토리지 파일은 남겨 둔다) */
export async function removeWorkDeliverable(
  assignmentId: string,
  url: string
): Promise<ActionResult> {
  try {
    const { artistId } = await requireArtist();
    const assignment = await assertOwnedAssignment(artistId, assignmentId);
    if (!canArtistWorkOn(assignment)) {
      throw new Error("수락한 업무만 수정할 수 있습니다.");
    }

    await updateAssignment(assignmentId, {
      deliverables: assignment.deliverables.filter((d) => d.url !== url),
    });
    revalidate(assignmentId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ── 가입 (로그인 전에도 호출되는 공개 액션) ─────────────────── */

/**
 * 가입 신청 — 누구나 호출할 수 있는 공개 액션이라 권한 확인이 없다.
 * 대신 이 액션이 만드는 건 승인 대기(pending) 행뿐이라 그 자체로는
 * 아무 권한도 생기지 않는다. 실제 통과는 관리자 승인 후에만 일어난다.
 */
export async function submitApplication(input: {
  email: string;
  displayName: string;
  phone: string;
  note: string;
}): Promise<ActionResult> {
  try {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) throw new Error("올바른 이메일을 입력해 주세요.");
    if (!input.displayName.trim()) throw new Error("이름을 입력해 주세요.");

    const result = await applyForAccount({
      email,
      displayName: input.displayName.trim().slice(0, 100),
      phone: input.phone.trim().slice(0, 50),
      note: input.note.trim().slice(0, 2000),
    });

    if (result.status === "already_approved") {
      throw new Error("이미 승인된 계정입니다. 구글 로그인으로 바로 이용하세요.");
    }

    revalidatePath("/admin/accounts");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 초대 수락 — 토큰이 가리키는 아티스트에 내 이메일을 연결한다.
 * 관리자가 아티스트를 지목해 발급한 링크이므로 별도 승인 없이 바로 승인 처리한다.
 */
export async function acceptArtistInvite(
  token: string,
  email: string
): Promise<ActionResult> {
  try {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) throw new Error("올바른 이메일을 입력해 주세요.");

    const account = await getAccountByInviteToken(token);
    if (!isInviteValid(account)) {
      throw new Error("초대 링크가 유효하지 않거나 만료되었습니다.");
    }

    await acceptInvite(token, normalized);
    revalidatePath("/admin/accounts");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
