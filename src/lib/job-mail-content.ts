/**
 * 작업 공고 메일 본문 — 순수 함수 (발송은 server-only 인 job-mail.ts).
 *
 * 세 가지: 새 공고 안내, 마감 알림(50·25·10%), 포털 로그인 링크.
 * 작업자에게 가는 메일이라 고객 개인정보와 견적가는 **인자로도 받지 않는다.**
 */

import { formatRemaining, wonText, type AlertStage } from "./job-board-types.ts";

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 표 한 장짜리 단순 메일 — 메일 앱마다 CSS 지원이 들쭉날쭉해 인라인 스타일만 쓴다 */
function layout(title: string, rows: [string, string][], lead: string, cta: { label: string; url: string } | null, foot: string): string {
  const rowHtml = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#0f172a;font-size:14px;white-space:pre-wrap">${esc(v)}</td></tr>`,
    )
    .join("");
  const button = cta
    ? `<p style="margin:24px 0"><a href="${esc(cta.url)}" style="display:inline-block;background:#1E22B2;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">${esc(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px">
<p style="margin:0 0 4px;font-size:11px;font-weight:bold;letter-spacing:.08em;color:#94a3b8">PE STUDIO 작업 공고</p>
<h1 style="margin:0 0 12px;font-size:18px;color:#0f172a">${esc(title)}</h1>
<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.6">${esc(lead)}</p>
<table style="border-collapse:collapse">${rowHtml}</table>
${button}
<p style="margin:16px 0 0;font-size:12px;color:#94a3b8;line-height:1.6">${esc(foot)}</p>
</div></body></html>`;
}

function plain(title: string, rows: [string, string][], lead: string, cta: { label: string; url: string } | null, foot: string): string {
  return [
    title,
    "",
    lead,
    "",
    ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    ...(cta ? ["", `${cta.label}: ${cta.url}`] : []),
    "",
    foot,
  ].join("\n");
}

export interface JobSummary {
  /** 제품 이름 (라벨 변환 후) */
  product: string;
  quantity: string;
  artistFee: number | null;
  dueDate: string;
  memo: string;
}

/** 새 공고 안내 — 작업자 전원에게 */
export function newJobMail(job: JobSummary, url: string): MailContent {
  const title = `새 작업 공고 — ${job.product || "제작 의뢰"}`;
  const lead = "새 작업이 올라왔습니다. 먼저 가져가는 분이 맡습니다. 내용을 보고 진행할지 정해 주세요.";
  const rows: [string, string][] = [
    ["제품", job.product],
    ["수량", job.quantity],
    ["작업비", `${wonText(job.artistFee)} (세전)`],
    ["마감일", job.dueDate],
    ["전달 사항", job.memo],
  ];
  const cta = { label: "공고 보기", url };
  const foot = "이 메일은 PE Studio 작업자에게 자동으로 보냈습니다.";
  return {
    subject: `[PE Studio] 새 작업 공고 · ${job.product || "제작 의뢰"} · 마감 ${job.dueDate}`,
    text: plain(title, rows, lead, cta, foot),
    html: layout(title, rows, lead, cta, foot),
  };
}

/** 마감 알림 — 가져간 작업자에게 */
export function dueAlertMail(
  job: JobSummary & { workerName: string },
  stage: AlertStage,
  remainingMs: number,
  url: string,
): MailContent {
  const remaining = formatRemaining(remainingMs);
  const title = `마감까지 ${remaining} 남았습니다`;
  const lead = `${job.workerName} 님, 맡으신 작업의 기간이 ${stage}% 남았습니다. 진행 상황을 포털에 남겨 주세요.`;
  const rows: [string, string][] = [
    ["제품", job.product],
    ["수량", job.quantity],
    ["마감일", `${job.dueDate} (남은 시간 ${remaining})`],
    ["전달 사항", job.memo],
  ];
  const cta = { label: "작업 열기", url };
  const foot = "기간의 50%·25%·10%가 남았을 때 한 번씩 보내는 자동 알림입니다.";
  return {
    subject: `[PE Studio] 마감 ${stage}% 남음 · ${job.product || "제작 의뢰"} · ${job.dueDate}`,
    text: plain(title, rows, lead, cta, foot),
    html: layout(title, rows, lead, cta, foot),
  };
}

/** 포털 로그인 링크 */
export function loginLinkMail(url: string, ttlMin: number): MailContent {
  const title = "작업자 포털 로그인";
  const lead = `아래 버튼을 누른 뒤 열린 화면에서 "로그인"을 누르세요. 링크는 ${ttlMin}분 동안 한 번만 쓸 수 있습니다.`;
  const cta = { label: "로그인 화면 열기", url };
  const foot = "로그인을 요청하지 않으셨다면 이 메일을 무시하세요. 링크를 다른 사람에게 전달하지 마세요.";
  return {
    subject: "[PE Studio] 작업자 포털 로그인 링크",
    text: plain(title, [], lead, cta, foot),
    html: layout(title, [], lead, cta, foot),
  };
}
