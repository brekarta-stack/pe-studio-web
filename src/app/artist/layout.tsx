import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import SessionProvider from "@/components/admin/SessionProvider";
import ArtistShell from "@/components/artist/ArtistShell";

export const metadata: Metadata = {
  title: "아티스트 포털",
  // 포털은 로그인 전용이라 검색 노출 대상이 아니다
  robots: { index: false, follow: false },
};

export default async function ArtistLayout({ children }: { children: React.ReactNode }) {
  // 서버에서 세션을 넘겨 클라이언트의 /api/auth/session 재호출을 없앤다 (AdminLayout 과 동일)
  const session = await getServerSession(authOptions);
  return (
    <SessionProvider session={session}>
      <ArtistShell>{children}</ArtistShell>
    </SessionProvider>
  );
}
