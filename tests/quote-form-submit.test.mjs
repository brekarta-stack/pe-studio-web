/**
 * 제작 문의 폼 — 제출 경로 규칙 테스트 (node --test)
 *   node --test tests/quote-form-submit.test.mjs
 *
 * "제출을 눌렀더니 오류가 난다"는 신고의 원인들을 소스 수준에서 못 박는다.
 * 전부 화면에서만 재현되고 눈으로는 잘 안 보이던 것들이다.
 *   · 글자 수 상한이 없어서 길게 쓴 요구사항이 서버에서 400 이 됐다
 *   · 서버가 알려준 사유를 버리고 alert 하나로 뭉갰다 (인앱 브라우저는 alert 을 삼킨다)
 *   · 3단계가 한 <form> 이라 Step 1·2 에서 Enter 를 누르면 작성 중에 접수됐다
 *   · 업로드 중 제출을 말없이 무시해 "눌러도 아무 일이 없다"로 보였다
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

import { QUOTE_LIMITS } from "../src/lib/quote-schema.ts";

const FORM = new URL("../src/components/QuoteForm.tsx", import.meta.url);
const ROUTE = new URL("../src/app/api/quote/route.ts", import.meta.url);

const form = await readFile(FORM, "utf8");
const route = await readFile(ROUTE, "utf8");

test("자유 입력마다 글자 수 상한이 걸려 있다 — 서버 상한과 같은 값으로", () => {
  for (const key of ["notes", "colorRequest", "productText", "name", "email", "phone", "designName"]) {
    assert.ok(
      form.includes(`maxLength={QUOTE_LIMITS.${key}}`),
      `${key} 에 maxLength 가 없다 — 길게 쓰면 서버에서 잘리거나 거절된다`,
    );
  }
});

test("폼과 서버가 같은 이메일 규칙을 쓴다", () => {
  assert.ok(form.includes('from "@/lib/quote-schema"'), "폼이 공용 정규화 모듈을 써야 한다");
  assert.ok(form.includes("isEmailLike(normalizedEmail)"), "폼 검증이 서버와 같은 함수여야 한다");
  assert.ok(form.includes("email: normalizedEmail,"), "정규화한 주소를 보내야 한다");
  assert.ok(!/\/\^\[\^\\s@\]\+@/.test(form), "폼 자체 이메일 정규식이 남아 있으면 서버와 어긋난다");
});

test("이름·연락처는 앞뒤 공백을 털어 보낸다", () => {
  assert.ok(form.includes("name: form.name.trim(),"));
  assert.ok(form.includes("phone: form.phone.trim(),"));
});

test("Enter 로는 마지막 단계 전에 접수되지 않는다", () => {
  assert.ok(form.includes("onKeyDown={handleKeyDown}"), "form 에 Enter 가드가 붙어야 한다");
  assert.ok(
    form.includes('if (el?.tagName !== "INPUT") return;'),
    "textarea 줄바꿈과 버튼의 Enter 활성화는 건드리면 안 된다",
  );
  assert.ok(form.includes("IMPLICIT_SUBMIT_INPUTS"), "암묵적 제출을 일으키는 입력만 막아야 한다");
  assert.ok(
    form.includes("e.nativeEvent.isComposing"),
    "한글 조합 중 Enter(글자 확정)로 접수되면 안 된다",
  );
  assert.ok(
    form.includes("if (step < TOTAL_STEPS) return;"),
    "handleSubmit 자체도 마지막 단계에서만 접수해야 한다",
  );
});

test("업로드 중 제출은 이유를 화면에 남긴다 — 디자인 줄 첨부 포함", () => {
  assert.ok(
    form.includes("const uploadBusy = uploading.file || uploading.logo || designUploading !== null;"),
    "디자인 줄 업로드(designUploading)까지 가드에 들어가야 한다",
  );
  assert.ok(form.includes("첨부파일 업로드가 끝난 뒤 다시 눌러 주세요."));
});

test("제출 실패는 alert 이 아니라 화면에 남는다", () => {
  assert.ok(!form.includes("alert("), "alert 은 인앱 브라우저에서 삼켜진다");
  assert.ok(form.includes("setSubmitError("), "실패 사유를 상태로 들고 있어야 한다");
  assert.ok(form.includes('role="alert"'), "화면에 안내 영역이 있어야 한다");
});

test("서버가 알려준 사유를 그대로 보여준다", () => {
  assert.ok(form.includes("json.error ||"), "서버 메시지를 우선 표시해야 한다");
  assert.ok(!form.includes('throw new Error("제출 실패")'), "사유를 버리는 옛 코드가 남으면 안 된다");
  assert.ok(form.includes("res.status === 429"), "레이트 리밋은 다른 안내가 필요하다");
});

/* ── 서버 라우트 ─────────────────────────────────────────── */

test("알림 메일은 응답 뒤에 보낸다 — 메일이 느려도 접수가 실패하지 않게", () => {
  assert.ok(route.includes("after(async () => {"), "after() 로 응답 뒤에 보내야 한다");
  assert.ok(
    !/\n  try \{\n    await sendInquiryEmail/.test(route),
    "응답 전에 메일을 await 하면 타임아웃 시 중복 접수가 난다",
  );
});

test("입력 거절과 절삭은 로그에 남는다", () => {
  assert.ok(route.includes("[api/quote] 입력 거절"), "400 을 조용히 내보내면 원인을 추적할 수 없다");
  assert.ok(route.includes("[api/quote] 일부 값을 잘라서 접수"));
});

test("레이트 리밋은 접수 성공만 센다", () => {
  // 규칙 자체의 검증은 tests/rate-limit.test.mjs — 여기서는 배선만 확인한다
  assert.ok(route.includes("quoteRate.allow(ip)"), "요청 한도를 확인해야 한다");
  assert.ok(
    route.includes("quoteRate.recordAccepted(ip);"),
    "접수 성공만 기록해야 한다 — 실패한 시도가 한도를 깎으면 안 된다",
  );
  const acceptIdx = route.indexOf("quoteRate.recordAccepted(ip);");
  const insertIdx = route.indexOf("if (insertError) {");
  assert.ok(acceptIdx > insertIdx, "저장에 성공한 뒤에 기록해야 한다");
});

test("한 줄 필드는 개행을 접고, 요구사항만 줄바꿈을 살린다", () => {
  const schema = readFileSync(new URL("../src/lib/quote-schema.ts", import.meta.url), "utf8");
  assert.ok(schema.includes("export function cleanLine"), "한 줄 필드용 정리 함수가 있어야 한다");
  assert.ok(
    schema.includes('cut("notes", o.notes, QUOTE_LIMITS.notes, false)'),
    "메모는 줄바꿈을 살려야 한다",
  );
  assert.ok(schema.includes("const name = cleanLine("), "이름은 알림 메일 제목에 들어간다");
});

test("첨부 URL 은 우리 프로젝트 호스트로 고정한다", () => {
  const schema = readFileSync(new URL("../src/lib/quote-schema.ts", import.meta.url), "utf8");
  assert.ok(schema.includes("PUBLIC_STORAGE_PREFIX"), "경로 패턴만 보면 남의 호스트가 통과한다");
  assert.ok(schema.includes("NEXT_PUBLIC_SUPABASE_URL"));
});

test("DB 저장 실패는 JSON 오류로 돌려준다", () => {
  assert.ok(route.includes("let insertError: unknown = null;"), "환경변수 누락 throw 까지 감싸야 한다");
});

test("상한 값은 폼과 서버가 한 곳에서 나온다", () => {
  assert.equal(QUOTE_LIMITS.notes, 4000);
  assert.equal(QUOTE_LIMITS.colorRequest, 4000);
  assert.ok(QUOTE_LIMITS.phone >= 60, "연락처를 두 개 적어도 들어가야 한다");
});
