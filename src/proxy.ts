/**
 * Next.js 16 Proxy(구 middleware) — 세 가지 게이트를 담당한다.
 *
 * 1) /admin/**  : 관리자(role=admin)만. 아티스트가 들어오면 포털로 돌려보내고,
 *                 비로그인이면 /admin/login 으로.
 * 2) /artist/** : 아티스트 포털. 로그인·공개 페이지(login·apply·join)는 통과시키고,
 *                 그 외는 세션이 있어야 한다. 관리자도 열람 가능(운영 확인용).
 * 3) /studio    : 종이모형 스튜디오는 아직 베타라 일반 방문자·검색봇에는 숨긴다.
 *                 예전엔 next.config 의 정적 redirect(/studio→/)로 처리했는데,
 *                 정적 redirect 는 세션을 못 봐서 관리자까지 홈으로 돌려보냈다
 *                 → 관리자도 실제 스튜디오 화면을 확인할 수 없었다. 이제 여기서
 *                 세션을 보고, 관리자는 통과(카탈로그·상세·자산 열람), 그 외는
 *                 홈으로 307 임시 리다이렉트(검색엔진 영구 캐시 방지)한다.
 *
 * 권한 판정은 JWT 의 role 로 한다 — 프록시는 모든 네비게이션마다 도므로 여기서
 * DB 를 보면 왕복이 그대로 체감 지연이 된다. role 은 src/lib/auth.ts 의 jwt
 * 콜백이 채우고 5분마다 다시 확인한다.
 * (role 이 없는 옛 토큰은 email 을 ADMIN_EMAIL 과 대조해 폴백 판정 — 배포 직후
 *  이미 로그인해 있던 관리자가 튕기지 않게)
 *
 * matcher 는 페이지 경로만 → /api/** 는 미영향(각 라우트가 직접 세션을 본다).
 *
 * 주의: 서버 액션은 "그 액션을 쓰는 페이지 경로로의 POST"라 이 matcher 를 함께
 * 탄다. 하지만 matcher 를 손대는 순간 조용히 커버리지가 빠질 수 있으므로
 * 프록시에만 기대지 않는다 — 액션마다 requireArtist()/requireAdmin() 으로 다시 막는다.
 *
 * 정식 공개 시 studio 분기와 matcher 의 studio 항목만 지우면 그 게이트가 사라진다.
 */
import { withAuth } from "next-auth/middleware";
import type { NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

function isStudioPath(pathname: string): boolean {
  return pathname === "/studio" || pathname.startsWith("/studio/");
}

function isArtistPath(pathname: string): boolean {
  return pathname === "/artist" || pathname.startsWith("/artist/");
}

/** 로그인 없이 열려야 하는 포털 페이지 — 로그인/가입 신청/초대 수락 */
function isArtistPublicPath(pathname: string): boolean {
  return (
    pathname === "/artist/login" ||
    pathname === "/artist/apply" ||
    pathname === "/artist/join" ||
    pathname.startsWith("/artist/login/") ||
    pathname.startsWith("/artist/apply/") ||
    pathname.startsWith("/artist/join/")
  );
}

export default withAuth(
  function proxy(req: NextRequestWithAuth) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth?.token;
    const adminEmail = process.env.ADMIN_EMAIL;

    /* role 이 있으면 그걸 믿고, 없으면(구 토큰) 이메일로 폴백 판정한다 */
    const isAdmin = token
      ? token.role === "admin" || (!token.role && !!adminEmail && token.email === adminEmail)
      : false;
    const isArtist = token?.role === "artist";

    const redirectTo = (path: string) => {
      const url = req.nextUrl.clone();
      url.pathname = path;
      url.search = "";
      return NextResponse.redirect(url, 307);
    };

    if (isStudioPath(pathname)) {
      if (!isAdmin) return redirectTo("/");
      return NextResponse.next();
    }

    if (isArtistPath(pathname)) {
      if (isArtistPublicPath(pathname)) return NextResponse.next();
      // 비로그인·권한 없음은 포털 로그인으로 (어드민 로그인이 아니라)
      if (!isArtist && !isAdmin) return redirectTo("/artist/login");
      return NextResponse.next();
    }

    // 남은 건 matcher 에 걸린 /admin/** — 아티스트가 잘못 들어오면 포털로 안내한다
    if (!isAdmin) return redirectTo(isArtist ? "/artist" : "/admin/login");

    return NextResponse.next();
  },
  {
    callbacks: {
      /**
       * 여기서 false 를 돌려주면 next-auth 가 pages.signIn(/admin/login)으로 보낸다.
       * /studio 와 /artist/** 는 그 기본 동작이 맞지 않으므로(홈 또는 포털 로그인으로
       * 보내야 한다) 무조건 통과시키고, 실제 판정은 위 proxy 함수가 한다.
       * /admin/** 만 토큰 유무를 여기서 거른다.
       */
      authorized: ({ req, token }) =>
        isStudioPath(req.nextUrl.pathname) ||
        isArtistPath(req.nextUrl.pathname) ||
        !!token,
    },
    pages: {
      signIn: "/admin/login",
    },
  },
);

export const config = {
  matcher: [
    // 어드민 루트(/admin) — 하위 경로 패턴만 두면 여기가 통째로 빠진다.
    // 실제로 이 누락 때문에 아티스트에게 대시보드가 그대로 열렸다.
    "/admin",
    // /admin/login 을 제외한 모든 /admin/** 경로 보호
    "/admin/((?!login$|login/).*)",
    // 아티스트 포털 (공개 페이지는 proxy 함수가 통과시킴)
    "/artist",
    "/artist/:path*",
    // 종이모형 스튜디오 페이지·자산(관리자만 열람)
    "/studio",
    "/studio/:path*",
  ],
};
