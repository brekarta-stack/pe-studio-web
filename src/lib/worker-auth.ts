/**
 * 맥 스튜디오 작업자(발굴 인테이크·제안서 AI 작성) 토큰 인증 — server-only.
 *
 * 헤더 `x-intake-token` 또는 `Authorization: Bearer <token>` 이 환경변수 OUTREACH_INTAKE_TOKEN 과 같으면 통과.
 * 상수 시간 비교(timingSafeEqual) — 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다.
 * 환경변수가 없으면 토큰 경로 자체를 닫는다(빈 토큰으로 통과하는 일이 없게).
 *
 * 프록시 matcher 는 /api/** 를 안 보므로 라우트가 직접 이 함수로 막는다.
 */

import { timingSafeEqual } from "node:crypto";

export function workerTokenMatches(req: Request): boolean {
  const expected = process.env.OUTREACH_INTAKE_TOKEN?.trim();
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  const given =
    req.headers.get("x-intake-token")?.trim() ||
    (bearer && /^Bearer\s+/i.test(bearer) ? bearer.replace(/^Bearer\s+/i, "").trim() : "");
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
