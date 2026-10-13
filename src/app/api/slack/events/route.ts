import { NextResponse, after } from "next/server";
import {
  verifySlackSignature,
  pickPortfolioUpload,
  slackFileName,
  formatIntakeReply,
  isAllowedSlackFileUrl,
  shouldIgnoreSlackRetry,
  type SlackFile,
  type SlackUpload,
} from "@/lib/slack-events";
import { runPortfolioIntake } from "@/lib/portfolio-intake-run";
import type { IntakeInputFile } from "@/lib/portfolio-intake-run";
import { INTAKE_MAX_FILES, INTAKE_MAX_FILE_BYTES } from "@/lib/portfolio-intake";

/**
 * Slack Events API 수신 — 채널에 사진이 올라오면 포트폴리오 초안을 만들고 스레드에 결과를 단다.
 *
 * 설정(docs/portfolio-intake-bot.md):
 *   SLACK_SIGNING_SECRET   Slack 앱 Basic Information 의 Signing Secret
 *   SLACK_BOT_TOKEN        xoxb-… (files:read, chat:write, reactions:write, channels:history, groups:history)
 *   SLACK_PORTFOLIO_CHANNEL_ID  (선택) 이 채널만 받는다. 비우면 봇이 초대된 모든 채널을 받는다.
 *
 * Slack 은 3초 안에 200 을 못 받으면 같은 이벤트를 다시 보낸다. 그래서 응답을 먼저 돌려주고
 * after() 로 이어서 처리한다. "느려서" 온 재전송(http_timeout)은 첫 요청이 처리 중이니 버리고,
 * 우리가 5xx 를 냈거나 연결이 끊겨 온 재전송은 처리된 적이 없으니 받는다.
 */
export const maxDuration = 300;

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL_ID = process.env.SLACK_PORTFOLIO_CHANNEL_ID || null;

export async function POST(request: Request) {
  if (!SIGNING_SECRET || !BOT_TOKEN) {
    return NextResponse.json({ error: "Slack bot not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const ok = verifySlackSignature({
    signingSecret: SIGNING_SECRET,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    rawBody,
  });
  if (!ok) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 앱 설정 화면에서 Request URL 을 저장할 때 Slack 이 보내는 확인 요청
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }
  if (shouldIgnoreSlackRetry(request.headers.get("x-slack-retry-num"), request.headers.get("x-slack-retry-reason"))) {
    return NextResponse.json({ ok: true, ignored: "retry" });
  }
  if (payload.type !== "event_callback") {
    return NextResponse.json({ ok: true, ignored: String(payload.type) });
  }

  const upload = pickPortfolioUpload(payload.event, CHANNEL_ID);
  if (!upload) return NextResponse.json({ ok: true, ignored: "not-a-portfolio-upload" });

  after(() => handleUpload(upload));
  return NextResponse.json({ ok: true, queued: upload.files.length });
}

/* ───────────────────────── Slack 호출 ───────────────────────── */

async function slackApi(method: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!data.ok) console.error(`[slack/events] ${method} failed:`, data.error ?? res.status);
}

async function downloadSlackFile(f: SlackFile): Promise<Buffer> {
  const url = f.url_private_download ?? f.url_private;
  if (!url) throw new Error("다운로드 주소 없음");
  // 봇 토큰을 실어 보내는 요청 — Slack 호스트가 아니면 안 간다
  if (!isAllowedSlackFileUrl(url)) throw new Error("Slack 밖의 주소라 내려받지 않음");
  // 본문을 다 받기 전에 크기부터 — 이벤트의 size, 응답의 content-length 순으로 거른다
  if (f.size && f.size > INTAKE_MAX_FILE_BYTES) {
    throw new Error(`파일이 너무 큼 (${Math.round(f.size / 1024 / 1024)}MB, 한 장 ${INTAKE_MAX_FILE_BYTES / 1024 / 1024}MB 까지)`);
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${BOT_TOKEN}` } });
  if (!res.ok) throw new Error(`Slack 파일 다운로드 실패 (${res.status})`);
  // 권한이 없으면 Slack 은 200 으로 로그인 HTML 을 돌려준다 — 이미지인지 꼭 본다
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.startsWith("image/")) throw new Error(`이미지가 아닌 응답(${ct || "unknown"}) — 봇에 files:read 권한이 있는지 확인`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > INTAKE_MAX_FILE_BYTES) throw new Error("파일이 너무 큼");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > INTAKE_MAX_FILE_BYTES) throw new Error("파일이 너무 큼");
  return bytes;
}

async function handleUpload(upload: SlackUpload): Promise<void> {
  const reply = (text: string) =>
    slackApi("chat.postMessage", { channel: upload.channel, thread_ts: upload.threadTs, text });
  const react = (name: string) => slackApi("reactions.add", { channel: upload.channel, timestamp: upload.ts, name });

  try {
    await react("eyes");
    const files: IntakeInputFile[] = [];
    const downloadFailures: string[] = [];
    for (const f of upload.files.slice(0, INTAKE_MAX_FILES)) {
      const name = slackFileName(f);
      try {
        files.push({ name, bytes: await downloadSlackFile(f) });
      } catch (e) {
        downloadFailures.push(`${name} — ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const result = files.length
      ? await runPortfolioIntake(files, { source: `slack:${upload.channel}/${upload.ts}` })
      : { groups: [], skipped: [] };

    let text = formatIntakeReply(result);
    if (downloadFailures.length) text += `\n:warning: 내려받기 실패 ${downloadFailures.length}장\n• ${downloadFailures.join("\n• ")}`;
    if (upload.files.length > INTAKE_MAX_FILES) text += `\n(한 메시지에 ${INTAKE_MAX_FILES}장까지만 받습니다 — 나머지는 다시 올려 주세요)`;

    const anyDone = result.groups.some((g) => g.action === "created" || g.action === "appended");
    await reply(text);
    await react(anyDone ? "white_check_mark" : "x");
  } catch (e) {
    console.error("[slack/events] handleUpload failed:", e);
    await reply(`:x: 처리 중 오류가 났습니다: ${e instanceof Error ? e.message : String(e)}`);
    await react("x");
  }
}
