import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import SessionProvider from "@/components/admin/SessionProvider";
import AdminShell from "@/components/admin/AdminShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 서버에서 세션을 넘겨 클라이언트의 /api/auth/session 재호출을 없앤다
  // (함수가 iad1 이라 이 왕복이 사이드바 표시를 눈에 띄게 늦춘다)
  const session = await getServerSession(authOptions);
  return (
    <SessionProvider session={session}>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
