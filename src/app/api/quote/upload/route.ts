import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { randomUUID } from "crypto";
import path from "path";
import {
  UPLOAD_EXT_MIME,
  UPLOAD_FORMAT_LABEL,
  UPLOAD_MAX_BYTES,
  fileExt,
  magicOk,
} from "@/lib/upload-rules";

/**
 * POST /api/quote/upload — 제작 문의 폼의 첨부파일 공개 업로드.
 *
 * 견적 폼(/quote)은 누구나 제출하므로 이 엔드포인트는 인증이 없다.
 * 대신 (1) IP 레이트 리밋, (2) 확장자·크기 화이트리스트, (3) 랜덤 파일명으로
 * 남용을 억제한다. 저장 위치는 공개 uploads 버킷의 quote/ 프리픽스.
 *
 * 반환: { url, name } — url=공개 URL(어드민/이메일 열람용), name=표시용 원본 파일명.
 */

/* ── IP 레이트 리밋 (분당 20회 — 다중 파일 첨부 여유) ── */
const rateMap = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.reset) {
    rateMap.set(ip, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
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
  if (file.size > UPLOAD_MAX_BYTES) {
    const mb = Math.round(UPLOAD_MAX_BYTES / (1024 * 1024));
    return NextResponse.json(
      { error: `파일이 너무 큽니다. 사진은 자동 축소되며, 문서·PDF·AI·ZIP 은 ${mb}MB 이하만 첨부됩니다.` },
      { status: 400 },
    );
  }

  const ext = fileExt(file.name);
  const mime = UPLOAD_EXT_MIME[ext];
  if (!mime) {
    return NextResponse.json(
      { error: `허용되지 않는 파일 형식입니다. (${UPLOAD_FORMAT_LABEL})` },
      { status: 400 },
    );
  }

  const bytes = await file.arrayBuffer();
  const header = new Uint8Array(bytes.slice(0, 12));
  if (!magicOk(ext, header)) {
    return NextResponse.json({ error: "파일 내용이 확장자와 일치하지 않습니다." }, { status: 400 });
  }

  const filename = `quote/${randomUUID()}${ext}`;
  const { error } = await supabase.storage
    .from("uploads")
    .upload(filename, Buffer.from(bytes), { contentType: mime, upsert: false });

  if (error) {
    console.error("[api/quote/upload] storage error:", error);
    return NextResponse.json({ error: "파일 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("uploads").getPublicUrl(filename);

  // 표시용 원본 파일명(경로/제어문자 제거, 과도한 길이 컷)
  const safeName = path.basename(file.name).replace(/[\r\n\t]/g, "").slice(0, 200);

  return NextResponse.json({ url: publicUrl, name: safeName });
}
