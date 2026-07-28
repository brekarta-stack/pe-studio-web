"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

export default function SessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  /** 서버에서 미리 넘긴 세션 — 클라이언트가 /api/auth/session 을 재호출하지 않게 한다 */
  session: Session | null;
}) {
  return <NextAuthSessionProvider session={session}>{children}</NextAuthSessionProvider>;
}
