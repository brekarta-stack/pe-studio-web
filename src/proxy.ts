/**
 * Next.js 16 Proxy(구 middleware) — 두 가지 게이트를 담당한다.
 *
 * 1) /admin/**  : 세션이 없으면 pages.signIn(/admin/login)으로 리다이렉트.
 *                 (/admin/login 은 matcher 에서 제외 → 무한 루프 방지)
 * 2) /studio    : 종이모형 스튜디오는 아직 베타라 일반 방문자·검색봇에는 숨긴다.
 *                 예전엔 next.config 의 정적 redirect(/studio→/) 로 처리했는데,
 *                 정적 redirect 는 세션을 못 봐서 관리자까지 홈으로 돌려보냈다
 *                 → 관리자도 실제 스튜디오 화면을 확인할 수 없었다. 이제 여기서
 *                 세션을 보고, 관리자는 통과(카탈로그·상세·자산 열람), 그 외는
 *                 홈으로 307 임시 리다이렉트(검색엔진 영구 캐시 방지)한다.
 *
 * 관리자 판정: signIn 콜백(@/lib/auth)이 ADMIN_EMAIL 한 명만 통과시키므로
 * 유효한 JWT 세션이 있으면 곧 관리자다. email 도 한 번 더 대조한다.
 * matcher 는 /studio 페이지·자산만 → /api/studio(PDF API) 는 미영향.
 * 정식 공개 시 studio 분기와 matcher 의 studio 항목만 지우면 게이트가 사라진다.
 */
import { withAuth } from "next-auth/middleware";
import type { NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

function isStudioPath(pathname: string): boolean {
  return pathname === "/studio" || pathname.startsWith("/studio/");
}

export default withAuth(
  function proxy(req: NextRequestWithAuth) {
    const { pathname } = req.nextUrl;

    if (isStudioPath(pathname)) {
      const token = req.nextauth?.token;
      const adminEmail = process.env.ADMIN_EMAIL;
      const isAdmin = !!token && (!adminEmail || token.email === adminEmail);
      if (!isAdmin) {
        const url = req.nextUrl.clone();
        url.pathname = "/";
        url.search = "";
        return NextResponse.redirect(url, 307);
      }
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      // /studio 는 로그인 없이도 authorized 를 통과시키고(그래야 proxy 함수가
      // 홈으로 돌릴 수 있다), 비관리자 처리는 위 proxy 함수가 한다.
      // /admin/** 는 토큰이 있어야 통과 → 없으면 signIn(/admin/login)으로.
      authorized: ({ req, token }) =>
        isStudioPath(req.nextUrl.pathname) || !!token,
    },
    pages: {
      signIn: "/admin/login",
    },
  },
);

export const config = {
  matcher: [
    // /admin/login 을 제외한 모든 /admin/** 경로 보호
    "/admin/((?!login$|login/).*)",
    // 종이모형 스튜디오 페이지·자산(관리자만 열람)
    "/studio",
    "/studio/:path*",
  ],
};
