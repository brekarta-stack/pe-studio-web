import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdminApi } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import updates from "@/../data/seo-append-updates.json";

/**
 * SEO/GEO 보강 문구 일괄 반영 (어드민 전용, 1회성 운영 도구)
 *
 *   GET /api/admin/apply-seo-append          — 드라이런: 반영 대상 개수만 보고
 *   GET /api/admin/apply-seo-append?apply=1  — 실제 반영
 *
 * data/seo-append-updates.json 은 "기존 내용 + 추가 문구"가 합쳐진 완성본이라
 * 여러 번 실행해도 결과가 같다 (멱등). 원본 백업은 data/portfolio-dump.json.
 */
export async function GET(request: Request) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const apply = new URL(request.url).searchParams.get("apply") === "1";
  if (!apply) {
    return NextResponse.json({ ok: true, dryRun: true, total: updates.length });
  }

  let applied = 0;
  const failed: { id: string; title: string; error: string }[] = [];
  for (const u of updates) {
    const { error } = await supabaseAdmin
      .from("portfolio_items")
      .update({
        summary: u.summary,
        description: u.description,
        updated_at: new Date().toISOString(),
      })
      .eq("id", u.id);
    if (error) failed.push({ id: u.id, title: u.title, error: error.message });
    else applied++;
  }

  revalidatePath("/");
  revalidatePath("/portfolio");
  for (const u of updates) {
    if (u.slug) revalidatePath(`/portfolio/${u.slug}`);
  }

  return NextResponse.json({ ok: failed.length === 0, applied, failed, total: updates.length });
}
