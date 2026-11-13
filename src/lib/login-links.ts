/**
 * 작업자 포털 이메일 로그인 링크 (server-only) — docs/job-board-plan.md §5.
 *
 * 구글 계정이 없는 작업자(네이버 메일)를 위한 1회용 링크. 토큰 원문은 메일에만 있고
 * 표(artist_login_tokens)에는 SHA-256 해시만 둔다 — DB 가 새도 링크를 만들 수 없다.
 * 소진은 조건부 UPDATE 한 번(아직 안 썼고 만료 전일 때만)이라 같은 링크로 두 번 들어올 수 없다.
 */

import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";
import { getAccountByEmail } from "./artist-accounts";
import { canSignIn, isValidEmail, normalizeEmail } from "./artist-account-types";
import { LOGIN_LINK_MAX_PER_WINDOW, LOGIN_LINK_TTL_MIN } from "./job-board-types";
import { loginLinkMail } from "./job-mail-content";
import { sendJobMail } from "./job-mail";
import { siteBase } from "./google-drive";

const TABLE = "artist_login_tokens";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * 링크 요청. 계정이 없거나 막힌 계정이면 **아무것도 하지 않고** 조용히 끝낸다 —
 * 화면은 어느 경우든 같은 문구를 띄워 가입 여부를 떠볼 수 없게 한다.
 * 보냈으면 true (테스트·로그용, 화면에는 쓰지 않는다).
 */
export async function requestLoginLink(rawEmail: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return false;

  const account = await getAccountByEmail(email);
  if (!canSignIn(account)) return false;

  const since = new Date(Date.now() - LOGIN_LINK_TTL_MIN * 60_000).toISOString();
  const { count, error: countErr } = await supabaseAdmin
    .from(TABLE)
    .select("token_hash", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", since);
  if (countErr) throw new Error(`로그인 링크를 만들 수 없습니다: ${countErr.message}`);
  if ((count ?? 0) >= LOGIN_LINK_MAX_PER_WINDOW) return false;

  const token = randomBytes(32).toString("base64url");
  const { error } = await supabaseAdmin.from(TABLE).insert({
    token_hash: hashToken(token),
    email,
    expires_at: new Date(Date.now() + LOGIN_LINK_TTL_MIN * 60_000).toISOString(),
  });
  if (error) throw new Error(`로그인 링크를 만들 수 없습니다: ${error.message}`);

  const url = `${siteBase()}/artist/login/verify?token=${encodeURIComponent(token)}`;
  await sendJobMail(email, loginLinkMail(url, LOGIN_LINK_TTL_MIN));
  return true;
}

/** 링크 소진 → 이메일. 없거나 만료·사용된 토큰이면 null */
export async function consumeLoginToken(token: string): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("email");
  if (error) {
    console.error("[login-links] consume failed:", error.message);
    return null;
  }
  return data?.[0]?.email ?? null;
}
