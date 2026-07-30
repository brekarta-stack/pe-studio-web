/**
 * 도면 검수 상태 갱신 API (관리자 전용).
 *
 *   POST /api/admin/studio-review
 *     body: { skey: string, status: "approved"|"rejected"|"pending", note?: string }
 *   → studio_reviews upsert (reviewed_at=now, reviewer=세션 이메일)
 *
 * status="pending" 은 검수 취소(다시 미검수로) 용도.
 * 인증: admin 세션 필수. skey 는 카탈로그 화이트리스트로 검증(경로/주입 차단).
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CATEGORY_SLUG, getStudioItem } from "@/lib/studio";
import { requireAdminApi } from "@/lib/session";

export const dynamic = "force-dynamic";

const VALID = new Set(["approved", "rejected", "pending"]);

export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const session = await getServerSession(authOptions);

  let body: { skey?: string; status?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const skey = (body.skey ?? "").trim();
  const status = (body.status ?? "").trim();
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;

  if (!getStudioItem(skey)) {
    return NextResponse.json({ error: "알 수 없는 도면입니다." }, { status: 404 });
  }
  if (!VALID.has(status)) {
    return NextResponse.json({ error: "상태 값이 올바르지 않습니다." }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const row = {
    skey,
    status,
    note: note || null,
    // 가드를 통과했으면 관리자 세션이 반드시 있다 — 타입만 좁혀 준다
    reviewer: session?.user?.email ?? null,
    // pending(검수 취소) 이면 검수 시각을 비운다
    reviewed_at: status === "pending" ? null : nowIso,
    updated_at: nowIso,
  };

  const { error } = await supabaseAdmin
    .from("studio_reviews")
    .upsert(row, { onConflict: "skey" });

  if (error) {
    const missing =
      error.message.includes("does not exist") ||
      error.message.includes("schema cache") ||
      error.code === "PGRST205" ||
      error.code === "42P01";
    return NextResponse.json(
      {
        error: missing
          ? "studio_reviews 테이블이 없습니다. 어드민 → DB 셋업에서 생성하세요."
          : error.message,
        tableMissing: missing,
      },
      { status: missing ? 409 : 500 },
    );
  }

  // 검수 목록/대시보드 + 큐레이션 게이트가 걸린 공개 페이지 캐시 무효화
  // (공개 페이지는 ISR — 여기서 즉시 재생성해 반려/복귀가 바로 반영되게 한다)
  revalidatePath("/admin/studio-review");
  revalidatePath("/admin");
  revalidatePath("/studio");
  revalidatePath("/studio/class");
  revalidatePath(`/studio/${skey}`);
  revalidatePath(`/studio/${skey}/custom`);
  const item = getStudioItem(skey);
  const slug = item ? CATEGORY_SLUG[item.category] : undefined;
  if (slug) revalidatePath(`/studio/category/${slug}`);
  revalidatePath("/sitemap.xml");

  return NextResponse.json({ ok: true, skey, status, reviewed_at: row.reviewed_at });
}
