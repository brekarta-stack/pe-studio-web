import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getAccountByEmail, touchLastLogin } from "./artist-accounts";
import { canSignIn, normalizeEmail } from "./artist-account-types";

/**
 * 인증 — 구글 로그인 하나로 두 종류의 사용자를 통과시킨다.
 *
 *   admin  : ADMIN_EMAIL 한 명. /admin/** 전체 권한.
 *   artist : artist_accounts 에 승인(approved)되고 아티스트에 매칭된 계정.
 *            /artist/** 포털에서 자기 업무·정산만 본다.
 *
 * 그 외 이메일은 signIn 콜백에서 막는다 — 세션 자체가 만들어지지 않으므로
 * 뒤쪽(프록시·서버 컴포넌트)은 "세션이 있다 = 둘 중 하나다"를 전제해도 된다.
 *
 * 역할(role)과 아티스트 id 는 JWT 에 실어 둔다. 프록시(src/proxy.ts)가 네비게이션마다
 * 권한을 봐야 하는데, 거기서 매번 DB 를 조회하면 그 왕복이 그대로 지연이 된다.
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
if (!ADMIN_EMAIL) throw new Error("ADMIN_EMAIL environment variable is required");

const ADMIN_EMAIL_NORMALIZED = normalizeEmail(ADMIN_EMAIL);

export type UserRole = "admin" | "artist";

/**
 * 역할을 다시 확인하는 주기.
 *
 * JWT 는 한 번 발급되면 만료까지 유지되므로, 관리자가 계정을 중지해도
 * 토큰이 살아 있는 동안은 통과한다. 매 요청마다 DB 를 보는 건 과하고
 * 아예 안 보는 건 위험해서, 5분마다 한 번씩만 다시 확인한다.
 */
const ROLE_TTL_MS = 5 * 60 * 1000;

/** 로그인 거부 시 돌려보낼 주소 — 이유를 쿼리로 붙여 안내 문구를 띄운다 */
function denyTo(reason: string): string {
  return `/artist/login?error=${reason}`;
}

/**
 * 이메일 → 역할. 통과시킬 수 없으면 거부 사유를 돌려준다.
 * signIn 과 jwt 가 같은 판정을 써야 해서 하나로 모았다.
 */
async function resolveRole(
  email: string
): Promise<
  | { ok: true; role: UserRole; artistId: string | null; accountId: string | null }
  | { ok: false; reason: string }
> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: "not_registered" };
  if (normalized === ADMIN_EMAIL_NORMALIZED) {
    return { ok: true, role: "admin", artistId: null, accountId: null };
  }

  const account = await getAccountByEmail(normalized);
  if (!account) return { ok: false, reason: "not_registered" };

  if (canSignIn(account)) {
    return { ok: true, role: "artist", artistId: account.artistId, accountId: account.id };
  }

  // 승인은 됐는데 아티스트 매칭이 빠진 경우와 아직 승인 전인 경우를 구분해 안내한다
  if (account.status === "approved") return { ok: false, reason: "unmatched" };
  if (account.status === "invited") return { ok: false, reason: "invite_invalid" };
  return { ok: false, reason: account.status }; // pending | rejected | disabled
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const resolved = await resolveRole(user.email ?? "");
      // 문자열을 돌려주면 next-auth 가 그 주소로 리다이렉트한다 — 왜 막혔는지 알려 준다
      if (!resolved.ok) return denyTo(resolved.reason);
      if (resolved.accountId) await touchLastLogin(resolved.accountId);
      return true;
    },

    async jwt({ token, user }) {
      const now = Date.now();
      const checkedAt = typeof token.roleCheckedAt === "number" ? token.roleCheckedAt : 0;
      const stale = now - checkedAt > ROLE_TTL_MS;

      // 최초 로그인(user 있음)이거나 확인한 지 오래됐으면 다시 판정한다
      if (user || stale) {
        const email = (user?.email ?? token.email ?? "") as string;
        const resolved = await resolveRole(email);
        if (resolved.ok) {
          token.role = resolved.role;
          token.artistId = resolved.artistId;
        } else {
          // 권한이 사라진 계정 — 토큰이 남아 있어도 어디에도 못 들어가게 비운다
          token.role = null;
          token.artistId = null;
        }
        token.roleCheckedAt = now;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as UserRole | null) ?? null;
        session.user.artistId = (token.artistId as string | null) ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/admin/login",
    error: "/admin/login",
  },
};
