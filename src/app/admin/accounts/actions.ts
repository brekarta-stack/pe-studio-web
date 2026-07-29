"use server";

/**
 * 아티스트 계정 관리(/admin/accounts) 서버 액션 — 승인·매칭·초대·삭제.
 * 모든 액션은 관리자 세션을 확인한 뒤 실행한다.
 */

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import {
  createInvite,
  deleteAccount,
  getAccount,
  updateAccount,
} from "@/lib/artist-accounts";
import { isAccountStatus } from "@/lib/artist-account-types";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type InviteResult = { ok: true; url: string } | { ok: false; error: string };

async function requireAdmin(): Promise<void> {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "admin") throw new Error("권한이 없습니다.");
}

function fail(e: unknown): { ok: false; error: string } {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[admin/accounts] action error:", msg);
  return { ok: false, error: msg };
}

function revalidate() {
  revalidatePath("/admin/accounts");
}

/**
 * 계정 승인 — 아티스트 매칭이 반드시 함께 이뤄져야 한다.
 *
 * artistId 없이 승인하면 로그인은 통과해도 보여줄 업무를 정할 수 없어
 * 빈 화면이 된다(canSignIn 이 artistId 를 요구하는 이유). 그래서 여기서 막는다.
 */
export async function approveAccount(id: string, artistId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!artistId) throw new Error("연결할 아티스트를 선택하세요.");

    const account = await getAccount(id);
    if (!account) throw new Error("계정을 찾을 수 없습니다.");
    if (!account.email) {
      throw new Error("이메일이 없는 계정입니다. 초대 링크로 먼저 등록해야 합니다.");
    }

    await updateAccount(id, { artistId, status: "approved" });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 상태만 변경 — 거절 / 사용 중지 / 재승인 */
export async function setAccountStatus(id: string, status: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!isAccountStatus(status)) throw new Error(`알 수 없는 상태입니다: ${status}`);

    if (status === "approved") {
      const account = await getAccount(id);
      if (!account?.artistId) {
        throw new Error("아티스트를 먼저 연결해야 승인할 수 있습니다.");
      }
    }

    await updateAccount(id, { status });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 매칭된 아티스트 변경 (승인 상태는 건드리지 않는다) */
export async function setAccountArtist(
  id: string,
  artistId: string | null
): Promise<ActionResult> {
  try {
    await requireAdmin();
    await updateAccount(id, { artistId });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 관리자 메모 저장 */
export async function setAccountNote(id: string, note: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await updateAccount(id, { note: note.slice(0, 2000) });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 초대 링크 발급 — 아티스트를 지정해 토큰을 만들고 전체 URL 을 돌려준다.
 *
 * URL 의 도메인은 NEXTAUTH_URL(배포 주소)에서 가져온다. 이 값이 없으면
 * 링크를 만들어도 어디로 보내야 할지 알 수 없으므로 경로만 돌려준다.
 */
export async function issueInvite(
  artistId: string,
  artistName: string
): Promise<InviteResult> {
  try {
    await requireAdmin();
    if (!artistId) throw new Error("아티스트를 선택하세요.");

    const account = await createInvite(artistId, artistName);
    if (!account.inviteToken) throw new Error("초대 링크 발급에 실패했습니다.");

    const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
    const url = `${base}/artist/join?token=${account.inviteToken}`;

    revalidate();
    return { ok: true, url };
  } catch (e) {
    return fail(e);
  }
}

/** 계정 삭제 — 잘못 만든 신청 정리용 */
export async function removeAccount(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await deleteAccount(id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
