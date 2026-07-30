import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import SessionProvider from "@/components/admin/SessionProvider";
import AdminShell from "@/components/admin/AdminShell";

/**
 * 어드민 레이아웃 — /admin/** 전체의 역할 관문.
 *
 * 여기서 막는 이유: 프록시 matcher 는 경로 패턴이라 구멍이 나기 쉽다
 * (실제로 `/admin` 딱 그 경로가 빠져 있어서 아티스트에게 대시보드가 열렸다).
 * 레이아웃은 /admin 아래 모든 페이지가 반드시 거치므로 패턴에 의존하지 않는다.
 *
 * 비로그인은 여기서 막지 않는다 — /admin/login 도 이 레이아웃 아래라
 * 리다이렉트하면 자기 자신으로 무한 루프가 된다. 로그인 페이지로 보내는 일은
 * 각 페이지가 하고, AdminShell 은 세션이 없으면 껍데기 없이 내용만 그린다.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 서버에서 세션을 넘겨 클라이언트의 /api/auth/session 재호출을 없앤다
  // (함수가 iad1 이라 이 왕복이 사이드바 표시를 눈에 띄게 늦춘다)
  const session = await getServerSession(authOptions);

  // 로그인은 했지만 관리자가 아닌 사람 = 아티스트. 자기 포털로 돌려보낸다.
  if (session && session.user?.role !== "admin") {
    redirect("/artist");
  }

  return (
    <SessionProvider session={session}>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
