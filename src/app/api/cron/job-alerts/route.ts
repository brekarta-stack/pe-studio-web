import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { workerTokenMatches } from "@/lib/worker-auth";
import { processDueAlerts } from "@/lib/job-board";

/**
 * 작업 공고 마감 알림 점검 (docs/job-board-plan.md §3·§7).
 *
 * Vercel Hobby 크론은 하루 1회라 촘촘한 알림은 맥 launchd(com.agent.job-alerts)가 15분마다 부르고,
 * vercel.json 의 하루 1회 크론은 맥이 꺼졌을 때의 안전망이다. 몇 번을 불러도 같은 단계는 한 번만 나간다.
 *
 * 인증: Vercel 크론의 `Authorization: Bearer CRON_SECRET`, 또는 맥 작업자 토큰(OUTREACH_INTAKE_TOKEN).
 * 프록시 matcher 는 /api/** 를 안 보므로 여기서 직접 막는다.
 */
function authorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${cronSecret ?? ""}`);
  if (cronSecret && given.length === expected.length && timingSafeEqual(given, expected)) return true;
  return workerTokenMatches(req);
}

async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await processDueAlerts();
    if (result.sent.length || result.errors.length) console.log("[cron/job-alerts]", JSON.stringify(result));
    return NextResponse.json({ ok: result.errors.length === 0, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/job-alerts] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Vercel 크론은 GET, 맥 작업자는 POST
export const GET = run;
export const POST = run;
export const dynamic = "force-dynamic";
