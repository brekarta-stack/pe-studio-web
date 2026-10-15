import { DOWNLOAD, SITE_URL } from "@/lib/site";

/**
 * 배포 파일 고정 링크 — GET /download/app → 실제 파일 위치로 302.
 *
 * 대외에 퍼지는 주소를 우리 도메인에 묶어 두려고 만든 얇은 우회로다. 파일 자체는
 * 여기를 거치지 않고(302 목적지에서 바로 받는다) 대역폭도 태우지 않는다.
 * 호스팅을 옮길 때 고쳐야 할 곳은 DOWNLOAD.url 하나뿐이고, 블로그·SNS·QR에 퍼진
 * /download/app 링크는 그대로 산다. 과거 두 번의 링크 전멸이 이 구조가 없어서 생겼다.
 *
 * 307/308 이 아니라 302 인 이유: 브라우저·검색엔진이 목적지를 영구 캐시하면
 * 다음 이전 때 옛 호스트에 묶인 클라이언트가 계속 죽은 URL 로 간다.
 */

/**
 * 리다이렉트 응답이 캐시에 굳으면 호스팅 이전이 즉시 반영되지 않는다.
 *
 * noindex/nofollow 를 함께 박는 이유: 이 302 를 따라가는 봇 하나가 126MB 전송이다.
 * robots.txt 로도 막지만(src/app/robots.ts), robots 를 안 읽는 링크 프리뷰 봇
 * (카카오톡·슬랙 언펄 등)까지 덮으려면 헤더가 필요하다. 무료 전송량 한도를 태워
 * 스토어를 정지시킨 것이 정확히 이 비용이다.
 */
const GUARD_HEADERS = {
  "Cache-Control": "no-store, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

/**
 * 목적지가 실제로 쓸 수 있는 외부 주소인지 본다.
 * 자기 자신을 가리키면(환경변수 오입력) 리다이렉트 루프가 되므로 미설정으로 취급한다.
 */
function resolveTarget(raw: string): string | null {
  if (!raw || raw.includes("REPLACE_ME")) return null;
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  if (target.protocol !== "https:") return null;
  if (target.host === new URL(SITE_URL).host) return null;
  return target.toString();
}

function unavailable(withBody: boolean): Response {
  return new Response(
    withBody
      ? "다운로드 파일을 준비하는 중입니다. 잠시 후 다시 시도해 주세요.\n문의: ask@papercraft.kr"
      : null,
    {
      status: 503,
      headers: withBody
        ? { ...GUARD_HEADERS, "Content-Type": "text/plain; charset=utf-8" }
        : GUARD_HEADERS,
    },
  );
}

function redirect(target: string): Response {
  return new Response(null, {
    status: 302,
    headers: { ...GUARD_HEADERS, Location: target },
  });
}

export async function GET(): Promise<Response> {
  const target = resolveTarget(DOWNLOAD.url);
  return target ? redirect(target) : unavailable(true);
}

/** 링크 검사기·네이버 URL 검사가 HEAD 로 찔러 본다. GET 과 같은 판정을 돌려준다. */
export async function HEAD(): Promise<Response> {
  const target = resolveTarget(DOWNLOAD.url);
  return target ? redirect(target) : unavailable(false);
}
