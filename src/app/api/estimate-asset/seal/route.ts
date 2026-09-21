import { NextResponse } from "next/server";
import { downloadSeal, isValidSealKey } from "@/lib/estimate-assets";

/**
 * GET /api/estimate-asset/seal?k=… — 견적서 시트의 IMAGE() 가 도장을 받아 가는 주소.
 *
 * 구글 서버가 로그인 없이 가져가야 해서 세션으로 막을 수 없다. 대신 배포 비밀에서
 * 파생한 키가 맞을 때만 내준다. 키가 틀리면 있는지조차 알리지 않고 404.
 */
export async function GET(req: Request) {
  const k = new URL(req.url).searchParams.get("k");
  if (!isValidSealKey(k)) return new NextResponse(null, { status: 404 });

  const seal = await downloadSeal();
  if (!seal) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(seal.bytes), {
    headers: {
      "Content-Type": seal.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex, noimageindex",
    },
  });
}
