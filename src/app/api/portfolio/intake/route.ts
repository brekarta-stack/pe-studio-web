import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runPortfolioIntake, INTAKE_MODEL } from "@/lib/portfolio-intake-run";
import type { IntakeInputFile } from "@/lib/portfolio-intake-run";
import { INTAKE_MAX_FILES, INTAKE_MAX_FILE_BYTES } from "@/lib/portfolio-intake";
import type { GeneratedContent } from "@/lib/portfolio-intake";

/**
 * 포트폴리오 인테이크 웹훅 — 사진 묶음을 받아 초안을 만든다 (Slack 봇·CLI 공용 뒷단).
 *
 * - 인증: `x-webhook-secret` 헤더 = PORTFOLIO_INTAKE_SECRET (blog/publish 와 같은 패턴).
 * - POST { files: [{ name, base64 }], publish?, dryRun?, content?: { "<키>": {...} }, source? }
 *   name 이 '고객명-YYMMDD-명칭 (n).jpg' 꼴이어야 묶인다. 본문 한계(약 4.5MB) 안에서 보내야 하므로
 *   CLI 는 미리 줄여서 보내고, 큰 묶음은 나눠 보낸다(같은 키면 뒤 사진이 덧붙는다).
 * - GET ?probe=1 : 설정 상태 점검 (어떤 환경변수가 비었는지).
 *
 * maxDuration: 묶음마다 생성(최대 100초)·업로드가 순차로 돌므로 Fluid Compute 기본 상한인 300초를 쓴다.
 */
export const maxDuration = 300;

const SECRET = process.env.PORTFOLIO_INTAKE_SECRET;

function authorized(request: Request): boolean {
  return !!SECRET && request.headers.get("x-webhook-secret") === SECRET;
}

export async function GET(request: Request) {
  if (!SECRET) return NextResponse.json({ error: "Intake endpoint not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    ok: true,
    model: INTAKE_MODEL,
    configured: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      slackSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
      slackBotToken: !!process.env.SLACK_BOT_TOKEN,
      slackChannel: process.env.SLACK_PORTFOLIO_CHANNEL_ID ?? null,
    },
  });
}

interface IntakeBody {
  files?: unknown;
  publish?: unknown;
  dryRun?: unknown;
  content?: unknown;
  source?: unknown;
}

export async function POST(request: Request) {
  if (!SECRET) return NextResponse.json({ error: "Intake endpoint not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: IntakeBody;
  try {
    body = (await request.json()) as IntakeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.files) || body.files.length === 0) {
    return NextResponse.json({ error: "files 가 비어 있습니다" }, { status: 400 });
  }
  if (body.files.length > INTAKE_MAX_FILES) {
    return NextResponse.json({ error: `한 번에 ${INTAKE_MAX_FILES}장까지 받습니다` }, { status: 400 });
  }

  const inputs: IntakeInputFile[] = [];
  for (const f of body.files as unknown[]) {
    const x = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    if (typeof x.name !== "string" || typeof x.base64 !== "string" || !x.base64) {
      return NextResponse.json({ error: "files[] 항목은 { name, base64 } 여야 합니다" }, { status: 400 });
    }
    const bytes = Buffer.from(x.base64, "base64");
    if (bytes.length === 0) return NextResponse.json({ error: `${x.name}: base64 를 읽을 수 없습니다` }, { status: 400 });
    if (bytes.length > INTAKE_MAX_FILE_BYTES) {
      return NextResponse.json({ error: `${x.name}: 파일이 너무 큽니다` }, { status: 400 });
    }
    inputs.push({ name: x.name, bytes });
  }

  const contentByKey =
    body.content && typeof body.content === "object" && !Array.isArray(body.content)
      ? (body.content as Record<string, Partial<GeneratedContent>>)
      : undefined;

  const result = await runPortfolioIntake(inputs, {
    publish: body.publish === true,
    dryRun: body.dryRun === true,
    contentByKey,
    source: typeof body.source === "string" ? body.source : "api",
  });

  // 공개로 등록된 것이 있으면 메인·목록·상세를 바로 갱신
  const publishedSlugs = result.groups
    .filter((g) => g.published && (g.action === "created" || g.action === "appended"))
    .map((g) => g.slug)
    .filter((s): s is string => !!s);
  if (publishedSlugs.length) {
    revalidatePath("/");
    revalidatePath("/portfolio");
    for (const slug of publishedSlugs) revalidatePath(`/portfolio/${slug}`);
  }

  return NextResponse.json(result);
}
