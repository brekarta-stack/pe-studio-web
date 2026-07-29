import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getArtistSession } from "@/lib/session";

/**
 * POST /api/artist/upload — 아티스트가 올리는 작업 결과물.
 *
 * /api/upload(어드민 전용)와 /api/quote/upload(공개 폼)의 중간 —
 * **로그인한 아티스트만** 올릴 수 있고, 허용 형식은 도면 작업에 맞춰
 * 견적 폼과 같은 폭(AI·SVG·ZIP 포함)으로 둔다.
 *
 * 저장 위치는 공개 uploads 버킷의 deliverable/ 프리픽스.
 * 반환: { url, name } — 이 값을 서버 액션(addWorkDeliverable)이 배정에 붙인다.
 */

// 확장자 → 저장 시 강제할 content-type. 클라이언트가 보낸 file.type 은 믿지 않는다.
const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".ai": "application/pdf", // 최신 .ai 는 PDF 호환
  ".svg": "image/svg+xml",
  ".zip": "application/zip",
};

// Vercel serverless 요청 본문 한도(~4.5MB) 안쪽
const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB

/** 매직 바이트 기본 검증 — 확장자만 바꾼 파일 차단 */
function magicOk(ext: string, h: Uint8Array): boolean {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return h[0] === 0xff && h[1] === 0xd8;
    case ".png":
      return h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
    case ".gif":
      return h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46;
    case ".webp":
      return h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46;
    case ".pdf":
      return h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46;
    case ".zip":
      return h[0] === 0x50 && h[1] === 0x4b;
    // .ai(구형은 %!PS)·.svg(텍스트)는 시그니처가 일정하지 않아 통과시킨다
    case ".ai":
    case ".svg":
      return true;
    default:
      return false;
  }
}

export async function POST(request: Request) {
  const artist = await getArtistSession();
  if (!artist) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "빈 파일입니다." }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "파일이 너무 큽니다. 4MB 이하로 올려 주세요." },
      { status: 400 }
    );
  }

  const ext = path.extname(file.name).toLowerCase();
  const mime = EXT_MIME[ext];
  if (!mime) {
    return NextResponse.json(
      { error: "허용되지 않는 파일 형식입니다. (PNG·JPG·WEBP·GIF·PDF·AI·SVG·ZIP)" },
      { status: 400 }
    );
  }

  const bytes = await file.arrayBuffer();
  if (!magicOk(ext, new Uint8Array(bytes.slice(0, 12)))) {
    return NextResponse.json(
      { error: "파일 내용이 확장자와 일치하지 않습니다." },
      { status: 400 }
    );
  }

  // 아티스트별 폴더로 나눠 둔다 — 나중에 스토리지에서 눈으로 찾기 쉽다
  const filename = `deliverable/${artist.artistId}/${randomUUID()}${ext}`;
  const { error } = await supabase.storage
    .from("uploads")
    .upload(filename, Buffer.from(bytes), { contentType: mime, upsert: false });

  if (error) {
    console.error("[api/artist/upload] storage error:", error);
    return NextResponse.json(
      { error: "파일 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("uploads").getPublicUrl(filename);

  // 표시용 원본 파일명(경로/제어문자 제거, 과도한 길이 컷)
  const safeName = path.basename(file.name).replace(/[\r\n\t]/g, "").slice(0, 200);

  return NextResponse.json({ url: publicUrl, name: safeName });
}
