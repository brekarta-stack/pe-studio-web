import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdminApi } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import alts from "@/../data/portfolio-alts.json";

/**
 * 이미지 대체 텍스트(alt) 일괄 반영 (어드민 전용, 1회성 운영 도구)
 *
 *   GET  /api/admin/apply-image-alts   — 드라이런: 대상 건수만 보고 (읽기 전용)
 *   POST /api/admin/apply-image-alts   — 실제 반영
 *
 * 기존 alt 는 "…대표 이미지", "…다른 컷 1" 같은 기계적 문구이거나 비어 있었고,
 * 화면에는 제목·태그를 이어붙인 자동 생성값이 나갔다. 사진에 실제로 보이는 것을
 * 서술한 alt 로 바꿔 이미지 검색과 AI 검색이 맥락을 읽을 수 있게 한다.
 *
 * data/portfolio-alts.json 은 이미지 191장을 직접 보고 작성한 완성본이라
 * 여러 번 실행해도 결과가 같다 (멱등).
 */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const total = alts.length;
  const images = alts.reduce((n, a) => n + (a.imageAlts?.length ?? 0), 0);
  return NextResponse.json({
    ok: true,
    dryRun: true,
    total,
    images,
    hint: "실제 반영은 같은 경로로 POST",
  });
}

export async function POST() {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let applied = 0;
  const failed: { id: string; title: string; error: string }[] = [];
  for (const a of alts) {
    const { error } = await supabaseAdmin
      .from("portfolio_items")
      .update({ image_alts: a.imageAlts, updated_at: new Date().toISOString() })
      .eq("id", a.id);
    if (error) failed.push({ id: a.id, title: a.title, error: error.message });
    else applied++;
  }

  revalidatePath("/");
  revalidatePath("/portfolio");
  for (const a of alts) {
    if (a.slug) revalidatePath(`/portfolio/${a.slug}`);
  }

  return NextResponse.json({ ok: failed.length === 0, applied, failed, total: alts.length });
}
