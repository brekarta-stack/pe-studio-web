import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { weeklySlot, weekStartUtc } from "@/lib/blog-schedule-shared.mjs";

/**
 * 블로그 주간 자동 발행 크론.
 *
 * 규칙: 주 1회, 화·수·목 중 랜덤 요일, 14:00~16:00 KST 랜덤 슬롯 (주차 시드 결정론).
 * 크론은 매일 1회(16:30 KST, 마지막 슬롯 이후 — Vercel Hobby 플랜은 하루 1회 제한)
 * 이 엔드포인트를 두드리고, "이번 주 슬롯이 지났고 아직 발행 안 했으면"
 * 대기열 맨 앞 글을 발행한다. 노출되는 발행 시각(created_at)은 호출 시각이 아니라
 * 슬롯 시각으로 기록해, 실제 틱이 하루 1회여도 발행 시각은 주마다 랜덤하게 흩어진다.
 * 슬롯 계산이 결정론적이라 몇 번을 호출해도 이중 발행되지 않고,
 * 특정 날 틱이 실패해도 같은 주 다음 날 틱이 자동으로 이어받는다.
 *
 * 인증: Vercel Cron 의 `Authorization: Bearer CRON_SECRET`
 *       또는 기존 발행 웹훅과 같은 `x-webhook-secret: BLOG_PUBLISH_SECRET`.
 */
function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const webhookSecret = process.env.BLOG_PUBLISH_SECRET;
  const bearer = request.headers.get("authorization");
  if (cronSecret && bearer === `Bearer ${cronSecret}`) return true;
  if (webhookSecret && request.headers.get("x-webhook-secret") === webhookSecret) return true;
  return false;
}

async function run(request: Request) {
  if (!process.env.CRON_SECRET && !process.env.BLOG_PUBLISH_SECRET) {
    return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const slot = weeklySlot(now);
  if (now < slot) {
    return NextResponse.json({ ok: true, skipped: "before-slot", slot: slot.toISOString() });
  }

  // 이번 주 이미 자동 발행했으면 종료 (주 1회 가드)
  const weekStart = weekStartUtc(now).toISOString();
  const { data: already, error: guardError } = await supabaseAdmin
    .from("posts")
    .select("id")
    .gte("auto_published_at", weekStart)
    .limit(1);
  if (guardError) {
    // 마이그레이션(20260808_blog_scheduling) 전이면 예약 컬럼이 없다 —
    // 원인이 명확히 드러나도록 일반 500 대신 안내를 돌려준다.
    const missingColumn =
      guardError.code === "PGRST204" ||
      guardError.message?.includes("schema cache") ||
      guardError.message?.includes("does not exist");
    if (missingColumn) {
      return NextResponse.json(
        {
          error: "migration-required",
          detail:
            "posts.queued / auto_published_at 컬럼이 없습니다. 어드민 > DB 셋업에서 20260808_blog_scheduling 마이그레이션을 실행하세요.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: guardError.message }, { status: 500 });
  }
  if (already && already.length > 0) {
    return NextResponse.json({ ok: true, skipped: "already-published-this-week" });
  }

  // 대기열 맨 앞(가장 오래된) 글 — 비어 있으면 이번 주는 건너뜀
  const { data: queue, error: queueError } = await supabaseAdmin
    .from("posts")
    .select("id, slug, title")
    .eq("published", false)
    .eq("queued", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (queueError) {
    return NextResponse.json({ error: queueError.message }, { status: 500 });
  }
  if (!queue || queue.length === 0) {
    return NextResponse.json({ ok: true, skipped: "empty-queue" });
  }

  const post = queue[0];
  const nowIso = now.toISOString();
  const { error: publishError } = await supabaseAdmin
    .from("posts")
    .update({
      published: true,
      queued: false,
      created_at: slot.toISOString(), // 노출·정렬 기준은 랜덤 슬롯 시각 (틱 시각이 매일 같아도 발행 시각은 흩어진다)
      updated_at: nowIso,
      auto_published_at: nowIso,
    })
    .eq("id", post.id);
  if (publishError) {
    return NextResponse.json({ error: publishError.message }, { status: 500 });
  }

  revalidatePath("/blog");
  revalidatePath(`/blog/${post.slug}`);

  return NextResponse.json({
    ok: true,
    published: { id: post.id, slug: post.slug, title: post.title },
    slot: slot.toISOString(),
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
