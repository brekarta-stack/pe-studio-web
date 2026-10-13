/**
 * Slack Events API 수신 규칙 — 순수 함수만. 라우트(api/slack/events)와 테스트가 같이 쓴다.
 *
 * - 서명 검증: Slack 이 보낸 `X-Slack-Signature` 를 서명 시크릿으로 다시 계산해 비교한다.
 *   5분 넘은 요청은 재전송 공격으로 보고 버린다.
 * - 어떤 메시지를 "포트폴리오 업로드"로 볼지: 사람이 올린, 사진이 달린 메시지만.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IntakeRunResult } from "./portfolio-intake.ts";

export const SLACK_SIGNATURE_MAX_AGE_SEC = 300;

export function verifySlackSignature(args: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowMs?: number;
}): boolean {
  const { signingSecret, timestamp, signature, rawBody } = args;
  if (!signingSecret || !timestamp || !signature) return false;
  if (!/^\d+$/.test(timestamp)) return false;
  const now = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > SLACK_SIGNATURE_MAX_AGE_SEC) return false;
  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SlackFile {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
  url_private?: string;
}

export interface SlackUpload {
  channel: string;
  /** 사진이 달린 메시지의 ts (반응 대상) */
  ts: string;
  /** 답글을 달 스레드 — 스레드 안에서 올렸으면 부모 ts, 아니면 메시지 자신 */
  threadTs: string;
  user?: string;
  files: SlackFile[];
}

/**
 * 봇 토큰을 실어 내려받아도 되는 주소인가 — 이벤트 페이로드의 URL 을 그대로 믿지 않는다.
 * 서명 시크릿이 새면 아무 호스트로나 토큰을 보내게 만들 수 있다 (portfolio/sync 의 Airtable 허용 목록과 같은 이유).
 */
export function isAllowedSlackFileUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "slack.com" || hostname.endsWith(".slack.com"));
  } catch {
    return false;
  }
}

/**
 * Slack 재전송을 무시할지 — 우리가 느려서(3초 초과) 다시 보낸 것이면 첫 요청이 처리 중이니 버린다.
 * 우리가 5xx 를 돌려줬거나 연결이 끊겨 다시 보낸 것이면 처리된 적이 없으니 받는다.
 */
export function shouldIgnoreSlackRetry(retryNum: string | null, reason: string | null): boolean {
  return !!retryNum && reason === "http_timeout";
}

export const SLACK_IMAGE_MIME = /^image\/(jpeg|png|webp)$/;
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

function isImageFile(f: unknown): f is SlackFile {
  if (!f || typeof f !== "object") return false;
  const x = f as Record<string, unknown>;
  if (typeof x.id !== "string") return false;
  if (typeof x.url_private_download !== "string" && typeof x.url_private !== "string") return false;
  const mime = typeof x.mimetype === "string" ? x.mimetype : "";
  const name = typeof x.name === "string" ? x.name : typeof x.title === "string" ? x.title : "";
  return SLACK_IMAGE_MIME.test(mime) || IMAGE_EXT.test(name);
}

/**
 * 이벤트가 "사람이 채널에 올린 사진 메시지"면 그 내용을, 아니면 null.
 * channelId 를 주면 그 채널만 받는다. 안 주면 봇이 초대된 모든 채널을 받는다.
 */
export function pickPortfolioUpload(event: unknown, channelId?: string | null): SlackUpload | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  if (e.type !== "message") return null;
  if (e.bot_id) return null;
  if (e.subtype && e.subtype !== "file_share") return null;
  if (typeof e.channel !== "string" || typeof e.ts !== "string") return null;
  if (channelId && e.channel !== channelId) return null;
  if (!Array.isArray(e.files)) return null;
  const files = e.files.filter(isImageFile);
  if (!files.length) return null;
  return {
    channel: e.channel,
    ts: e.ts,
    threadTs: typeof e.thread_ts === "string" ? e.thread_ts : e.ts,
    user: typeof e.user === "string" ? e.user : undefined,
    files,
  };
}

export function slackFileName(f: SlackFile): string {
  return f.name || f.title || `${f.id}.jpg`;
}

/** 스레드 답글 본문 — 무엇이 등록됐고 무엇이 건너뛰어졌는지 한눈에 */
export function formatIntakeReply(result: IntakeRunResult): string {
  const lines: string[] = [];
  const done = result.groups.filter((g) => g.action === "created" || g.action === "appended");
  const failed = result.groups.filter((g) => g.action === "failed");

  if (done.length) {
    lines.push(`:white_check_mark: 포트폴리오 초안 ${done.length}건`);
    for (const g of done) {
      const verb = g.action === "appended" ? "기존 초안에 사진 추가" : "새 초안";
      lines.push(`• ${g.title ?? g.titleHint} (${g.imageCount}장, ${verb})${g.adminUrl ? ` → ${g.adminUrl}` : ""}`);
    }
    lines.push("어드민에서 내용을 확인하고 '공개' 를 켜면 사이트에 올라갑니다.");
  }
  if (failed.length) {
    lines.push(`:x: 실패 ${failed.length}건`);
    for (const g of failed) lines.push(`• ${g.client} / ${g.titleHint}: ${g.error ?? "원인 불명"}`);
  }
  const skipped = [...result.skipped, ...result.groups.flatMap((g) => g.skippedImages)];
  if (skipped.length) {
    lines.push(`:warning: 건너뜀 ${skipped.length}장`);
    for (const s of skipped) lines.push(`• ${s.name} — ${s.reason}`);
  }
  if (!lines.length) lines.push("처리할 사진이 없었습니다. 파일명이 '고객명-YYMMDD-명칭 (n).jpg' 인지 확인해 주세요.");
  return lines.join("\n");
}
