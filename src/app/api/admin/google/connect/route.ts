import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/session";
import { buildAuthUrl, siteBase } from "@/lib/google-drive";

/**
 * GET /api/admin/google/connect — 견적서 시트를 만들 구글 계정 연결을 시작한다.
 *
 * state 는 httpOnly 쿠키에 심고 콜백에서 대조한다 (남이 만든 인증 코드를 우리 계정에
 * 꽂아 넣는 CSRF 를 막는다). 쿠키는 콜백과 같은 호스트에 있어야 읽히므로,
 * 다른 호스트(papercraft.kr ↔ www)로 들어왔으면 기준 호스트로 한 번 보낸 뒤 시작한다.
 */
const STATE_COOKIE = "gdrive_oauth_state";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!(await isAdminSession())) {
    return NextResponse.redirect(new URL("/admin/login", url.origin));
  }

  let base: URL;
  try {
    base = new URL(siteBase());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (url.origin !== base.origin && !url.searchParams.has("hop")) {
    return NextResponse.redirect(new URL("/api/admin/google/connect?hop=1", base.origin));
  }

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/api/admin/google",
    maxAge: 600,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
