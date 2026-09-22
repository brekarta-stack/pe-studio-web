/**
 * 제작 문의 — DB 가 멈춰도 문의를 잃지 않는다 (node --test)
 *
 * 2026-09-22 Supabase 사용량 초과로 모든 DB 요청이 402 가 되자, 문의 폼은 insert 실패 즉시 500 을
 * 돌려주고 알림 메일도 보내지 않아 그동안의 문의가 통째로 사라졌다. 지금은 insert 가 실패해도
 * 운영자 알림 메일로 내용을 받아 두고, 메일이 실제로 나갔을 때만 고객에게 접수 완료로 답한다.
 * 라우트는 Supabase·Resend 에 묶여 있어 직접 실행하지 않고 흐름을 소스로 확인한다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/app/api/quote/route.ts", import.meta.url), "utf-8");
const post = src.slice(src.indexOf("export async function POST"), src.indexOf("export async function GET"));
const insertErr = post.slice(post.indexOf("DB insert error"), post.indexOf("제작 희망 디자인 best-effort"));

test("insert 실패 시 운영자 메일로 문의를 받아 둔다 (DB 실패 표시와 함께)", () => {
  assert.match(insertErr, /sendInquiryEmail\(submission, \{ dbError:/);
});

test("메일이 실제로 나갔을 때만 201, 아니면 예전처럼 500", () => {
  const i201 = insertErr.indexOf("status: 201");
  const i500 = insertErr.indexOf("status: 500");
  const iGuard = insertErr.indexOf("if (!captured)");
  assert.ok(iGuard > 0 && i500 > iGuard && i201 > i500, "captured 확인 → 500 → 201 순서여야 한다");
});

test("알림 메일 함수는 설정이 없어 건너뛰면 false 를 돌려준다 (대체 경로가 성공으로 착각하지 않게)", () => {
  const fn = src.slice(src.indexOf("async function sendInquiryEmail"), src.indexOf("async function sendCustomerAckEmail"));
  assert.match(fn, /Promise<boolean>/);
  assert.match(fn, /RESEND_API_KEY not set[\s\S]{0,120}return false;/);
  assert.match(fn, /return true;\s*\}/);
  // DB 실패 문의는 제목에서 바로 보인다
  assert.match(fn, /DB 저장 실패 — 이 메일이 유일한 기록/);
});
