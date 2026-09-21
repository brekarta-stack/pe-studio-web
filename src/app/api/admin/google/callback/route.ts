import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAdminEmail } from "@/lib/session";
import { exchangeCode, saveConnection } from "@/lib/google-drive";
import { logEstimateEvent } from "@/lib/estimates";

const STATE_COOKIE = "gdrive_oauth_state";

/**
 * GET /api/admin/google/callback — 구글 동의 화면에서 돌아오는 곳.
 * 이 주소는 구글 클라우드 콘솔의 OAuth 클라이언트 "승인된 리디렉션 URI"에 등록돼 있어야 한다.
 *
 * 결과는 정해진 코드로만 돌려보낸다(?google=connected|denied|state|failed). 주소에 문구를 실어
 * 보내면 누구나 관리 화면에 임의의 안내문을 띄우는 링크를 만들 수 있다. 실패 원인은 감사 기록에 남긴다.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = (code: "connected" | "denied" | "state" | "failed") => {
    const to = new URL("/admin/estimates", url.origin);
    to.searchParams.set("google", code);
    const res = NextResponse.redirect(to);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/admin/google", maxAge: 0 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const actor = await getAdminEmail();
  if (!actor) return NextResponse.redirect(new URL("/admin/login", url.origin));

  if (url.searchParams.get("error")) return back("denied");

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const expected = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const same =
    !!state && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!code || !same) return back("state");

  try {
    const { refreshToken, scope, email } = await exchangeCode(code);
    await saveConnection({ email, refreshToken, scope });
    await logEstimateEvent({ estimateId: null, action: "google_connected", actor, detail: { email } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[google/callback]", msg);
    await logEstimateEvent({ estimateId: null, action: "google_connect_failed", actor, detail: { error: msg.slice(0, 300) } });
    return back("failed");
  }
  return back("connected");
}
