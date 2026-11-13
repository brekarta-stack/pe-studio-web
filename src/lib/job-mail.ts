/**
 * 작업 공고 메일 발송 (server-only). 본문은 job-mail-content.ts 의 순수 함수가 만든다.
 *
 * 발신은 견적서와 같은 PE Studio <ask@papercraft.kr> — 작업자가 답장하면 운영자에게 닿는다.
 * 바꾸려면 JOB_FROM_EMAIL.
 */

import { Resend } from "resend";
import { estimateFromAddress } from "./estimate-sheet";
import type { MailContent } from "./job-mail-content";

export class MailNotConfiguredError extends Error {}

export function jobFromAddress(): string {
  return process.env.JOB_FROM_EMAIL?.trim() || estimateFromAddress();
}

/** 한 사람에게 한 통 — 받는 사람끼리 서로의 주소를 보지 않게 묶어 보내지 않는다. 실패는 throw */
export async function sendJobMail(to: string, content: MailContent): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new MailNotConfiguredError("메일 발송 설정(RESEND_API_KEY)이 없습니다.");
  const resend = new Resend(apiKey);
  // Resend SDK 는 실패해도 throw 하지 않고 { error } 를 돌려준다 — 반드시 확인한다
  const { data, error } = await resend.emails.send({
    from: jobFromAddress(),
    to: [to],
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
  if (error) throw new Error(`메일 발송 실패(${to}): ${error.message ?? JSON.stringify(error)}`);
  return data?.id ?? "";
}
