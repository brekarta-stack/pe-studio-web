/**
 * 제작 문의 입력 정규화 테스트 (node --test)
 *   node --test tests/quote-schema.test.mjs
 *
 * 여기 있는 케이스는 전부 **실제로 400 을 내던 입력**이다.
 * 고객 화면에는 "제출 중 오류가 발생했습니다" 하나만 떴고, 무엇이 문제인지
 * 알 방법이 없었다. 특히 acquisition(referrer·gclid)은 사용자가 손댈 수 없는
 * 값이라 그 세션 내내 몇 번을 눌러도 실패했다.
 *
 * 규칙: 부가 정보 때문에 접수가 실패하면 안 된다. 잘라서라도 받는다.
 *       하드 실패는 회신 수단이 없을 때(이름·이메일)뿐이다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  QUOTE_LIMITS,
  cleanText,
  isEmailLike,
  normalizeEmail,
  normalizeQuoteInput,
  safeFileUrl,
} from "../src/lib/quote-schema.ts";

const STORAGE = "https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/uploads";

/** 최소 유효 제출 — 회신 수단만 갖춘 상태 */
function submission(over = {}) {
  return { product: "papercraft", name: "홍길동", email: "hong@corp.co.kr", phone: "010-1234-5678", ...over };
}

function ok(raw) {
  const r = normalizeQuoteInput(raw);
  assert.equal(r.ok, true, `접수가 거절됐다: ${r.ok ? "" : r.message}`);
  return r;
}

/* ── 길이 초과: 거절이 아니라 절삭 ───────────────────────── */

test("추가 메모가 길어도 접수된다 — 예전에는 500자만 넘으면 통째로 400", () => {
  const long = "가".repeat(6000);
  const r = ok(submission({ notes: long }));
  assert.equal(r.value.notes.length, QUOTE_LIMITS.notes);
  assert.ok(r.dropped.some((d) => d.startsWith("notes(")), "잘렸다는 기록이 남아야 한다");
});

test("옛 상한(500자)을 넘는 요구사항이 이제 그대로 저장된다", () => {
  const req = "나".repeat(1500);
  const r = ok(submission({ colorRequest: req, notes: req }));
  assert.equal(r.value.colorRequest, req);
  assert.equal(r.value.notes, req);
  assert.deepEqual(r.dropped, []);
});

test("연락처를 두 개 적어도 접수된다 — 30자 상한에 걸리던 입력", () => {
  const phone = "010-1234-5678 / 02-123-4567 내선100";
  assert.ok(phone.length > 30);
  const r = ok(submission({ phone }));
  assert.equal(r.value.phone, phone);
});

test("제품 삽입 문구 200자 초과도 접수된다", () => {
  const r = ok(submission({ productText: "다".repeat(400) }));
  assert.equal(r.value.productText.length, 400);
});

/* ── 이메일: 붙여넣기 군더더기 정규화 ────────────────────── */

test("아웃룩 복붙 형식을 받아낸다", () => {
  assert.equal(normalizeEmail("홍길동 <hong@corp.co.kr>"), "hong@corp.co.kr");
  assert.equal(normalizeEmail("<hong@corp.co.kr>"), "hong@corp.co.kr");
  assert.equal(normalizeEmail("mailto:hong@corp.co.kr"), "hong@corp.co.kr");
});

test("앞뒤 공백·끝 구두점·전각 문자를 정리한다", () => {
  assert.equal(normalizeEmail("  hong@corp.co.kr  "), "hong@corp.co.kr");
  assert.equal(normalizeEmail("hong@corp.co.kr;"), "hong@corp.co.kr");
  assert.equal(normalizeEmail("hong@corp.co.kr,"), "hong@corp.co.kr");
  assert.equal(normalizeEmail("hong@corp.co.kr."), "hong@corp.co.kr");
  assert.equal(normalizeEmail("hong＠corp.co.kr"), "hong@corp.co.kr");
  assert.equal(normalizeEmail("hong@corp.co.kr​"), "hong@corp.co.kr");
  assert.equal(normalizeEmail("hong@corp.co.kr "), "hong@corp.co.kr");
});

test("정규화한 주소가 제출에 반영된다", () => {
  const r = ok(submission({ email: " 홍길동 <Hong@Corp.co.kr> " }));
  assert.equal(r.value.email, "Hong@Corp.co.kr");
});

test("회신할 수 없는 주소는 이메일 필드를 지목해 거절한다", () => {
  for (const bad of ["", "hong", "hong@", "@corp.co.kr", "hong corp.co.kr", "hong@corp"]) {
    const r = normalizeQuoteInput(submission({ email: bad }));
    assert.equal(r.ok, false, `통과하면 안 된다: ${bad}`);
    assert.equal(r.field, "email");
  }
});

test("정상 주소는 통과한다", () => {
  for (const good of [
    "hong@corp.co.kr",
    "hong.gil-dong+quote@sub.corp.com",
    "1@a.io",
    "한글아이디@corp.co.kr",
  ]) {
    assert.ok(isEmailLike(good), `막히면 안 된다: ${good}`);
  }
});

test("이름이 비면 이름 필드를 지목해 거절한다", () => {
  const r = normalizeQuoteInput(submission({ name: "   " }));
  assert.equal(r.ok, false);
  assert.equal(r.field, "name");
});

/* ── 유입정보: 사용자가 손댈 수 없는 값 ──────────────────── */

test("referrer 가 아무리 길어도 접수를 막지 않는다 — 그 세션 내내 제출이 막히던 원인", () => {
  const r = ok(
    submission({
      acquisition: {
        referrer: "https://ad.example.com/?q=" + "a".repeat(4000),
        utmSource: "s".repeat(300),
        utmMedium: "naver",
        utmCampaign: "c".repeat(300),
        gclid: "g".repeat(900),
        adHint: "naver",
      },
    }),
  );
  assert.equal(r.value.acquisition.referrer.length, QUOTE_LIMITS.acqReferrer);
  assert.equal(r.value.acquisition.gclid.length, QUOTE_LIMITS.acqGclid);
  assert.equal(r.value.acquisition.adHint, "naver");
  assert.ok(r.dropped.length > 0);
});

test("유입정보가 없거나 깨져 있어도 접수된다", () => {
  assert.equal(ok(submission()).value.acquisition, null);
  assert.equal(ok(submission({ acquisition: "이상한값" })).value.acquisition, null);
  assert.equal(ok(submission({ acquisition: null })).value.acquisition, null);
});

/* ── 선택지·배열: 거절 대신 떨어뜨리기 ───────────────────── */

test("제품 미선택은 '미정(담당자 상의)'으로 접수된다", () => {
  assert.equal(ok(submission({ product: "" })).value.product, "unsure");
  assert.equal(ok(submission({ product: "존재하지않는값" })).value.product, "unsure");
});

test("모르는 선택지 값은 빈 값이 될 뿐 접수를 막지 않는다", () => {
  const r = ok(
    submission({ styleType: "미래의값", packaging: "??", manualOption: "??", orderType: "??" }),
  );
  assert.equal(r.value.styleType, "");
  assert.equal(r.value.packaging, "");
  assert.equal(r.value.manualOption, "");
  assert.equal(r.value.orderType, "");
});

test("레거시 선호 작가 값은 살려 둔다 — 옛 초안 제출이 값을 잃지 않게", () => {
  assert.equal(ok(submission({ styleType: "realism" })).value.styleType, "realism");
  assert.equal(ok(submission({ styleType: "osegi" })).value.styleType, "osegi");
});

test("첨부·디자인이 상한을 넘으면 잘라서 접수한다", () => {
  const files = Array.from({ length: 9 }, (_, i) => ({ name: `f${i}.png`, url: `${STORAGE}/f${i}.png` }));
  const designs = Array.from({ length: 25 }, (_, i) => ({ id: `d${i}`, name: `캐릭터${i}`, quantity: "1000" }));
  const r = ok(submission({ files, designs }));
  assert.equal(r.value.files.length, QUOTE_LIMITS.files);
  assert.equal(r.value.designs.length, QUOTE_LIMITS.designs);
});

test("우리 스토리지가 아닌 첨부 URL 은 버리되 접수는 살린다", () => {
  const r = ok(
    submission({
      files: [
        { name: "정상.png", url: `${STORAGE}/ok.png` },
        { name: "서명.png", url: "https://x.supabase.co/storage/v1/object/sign/uploads/a.png?token=1" },
        { name: "주입", url: "javascript:alert(1)" },
      ],
      logoFileUrl: "https://evil.example.com/a.png",
    }),
  );
  assert.equal(r.value.files.length, 1);
  assert.equal(r.value.logoFileUrl, "");
  assert.ok(r.dropped.some((d) => d.includes("logoFileUrl")));
});

test("safeFileUrl 은 공개 스토리지 URL 만 통과시킨다", () => {
  assert.equal(safeFileUrl(`${STORAGE}/a.png`), `${STORAGE}/a.png`);
  assert.equal(safeFileUrl("javascript:alert(1)"), "");
  assert.equal(safeFileUrl("http://x/storage/v1/object/public/a.png"), ""); // https 만
  assert.equal(safeFileUrl(undefined), "");
});

test("디자인 줄이 통째로 이상해도 접수된다", () => {
  const r = ok(submission({ designs: [null, 42, { name: "정상", quantity: "1000", complexity: "복잡" }] }));
  assert.equal(r.value.designs.length, 1);
  assert.equal(r.value.designs[0].complexity, ""); // 모르는 난이도는 빈 값
});

/* ── 깨진 문자열: 500(DB insert 실패) 예방 ───────────────── */

test("제어문자·짝 없는 서로게이트를 걷어낸다", () => {
  const r = ok(submission({ notes: "앞\u0000중\u0007간\uD83D뒤" }));
  assert.equal(r.value.notes, "앞중간뒤");
});

test("개행·탭은 남긴다 — 요구사항 줄바꿈이 사라지면 안 된다", () => {
  assert.equal(cleanText("첫 줄\n둘째 줄\t끝", 100), "첫 줄\n둘째 줄\t끝");
});

test("절삭이 이모지를 반토막 내지 않는다", () => {
  const s = "가".repeat(QUOTE_LIMITS.notes - 1) + "🙂";
  const r = ok(submission({ notes: s }));
  assert.ok(!/[\uD800-\uDBFF]$/.test(r.value.notes), "상위 서로게이트가 홀로 남았다");
});

/* ── 형식 자체가 잘못된 본문 ─────────────────────────────── */

test("본문이 객체가 아니면 거절한다", () => {
  for (const bad of [null, "문자열", 42, []]) {
    const r = normalizeQuoteInput(bad);
    assert.equal(r.ok, false);
    assert.equal(r.field, "body");
  }
});

test("불리언 옵션은 무엇이 오든 참/거짓으로 정리된다", () => {
  const r = ok(submission({ sampling: "true", supervision: 1, rushed: "아니오", premiumFinish: true }));
  assert.equal(r.value.sampling, true);
  assert.equal(r.value.supervision, true);
  assert.equal(r.value.rushed, false);
  assert.equal(r.value.premiumFinish, true);
});

/* ── 전 필드 왕복 — 조용히 사라지는 값이 없는지 ─────────── */

test("모든 필드를 채운 제출이 하나도 빠짐없이 살아 나온다", () => {
  const filled = {
    product: "action",
    quantity: "3000",
    deliveryDate: "2026-10-01",
    purpose: "행사/배포",
    customDesign: "yes",
    styleType: "cheolho",
    productText: "브레카르타 창립 10주년",
    colorRequest: "브랜드 컬러(파랑) 유지",
    notes: "첫 줄\n둘째 줄",
    name: "홍길동",
    email: "hong@corp.co.kr",
    phone: "010-1234-5678 / 02-123-4567",
    fileName: "참고자료.pdf",
    fileUrl: `${STORAGE}/ref.pdf`,
    files: [{ name: "a.png", url: `${STORAGE}/a.png` }],
    designs: [
      { id: "d1", name: "마스코트", quantity: "2000", complexity: "complex", file: { name: "d.png", url: `${STORAGE}/d.png` } },
    ],
    logoFileName: "로고.ai",
    logoFileUrl: `${STORAGE}/logo.ai`,
    sampling: true,
    samplingImprove: true,
    supervision: true,
    premiumFinish: true,
    ageGroups: ["성인, 전문가용"],
    assemblyMethod: "목공풀 사용",
    designStyle: "폴리곤 방식",
    manualOption: "qr",
    rushed: true,
    packaging: "paper-box",
    orderType: "production",
    acquisition: {
      referrer: "https://www.google.com/",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "spring",
      gclid: "abc123",
      adHint: "google",
    },
  };
  const r = ok(filled);

  // 스칼라·불리언은 값 그대로
  for (const key of [
    "product", "quantity", "deliveryDate", "purpose", "customDesign", "styleType",
    "productText", "colorRequest", "notes", "name", "email", "phone", "fileName",
    "fileUrl", "logoFileName", "logoFileUrl", "sampling", "samplingImprove",
    "supervision", "premiumFinish", "assemblyMethod", "designStyle", "manualOption",
    "rushed", "packaging", "orderType",
  ]) {
    assert.deepEqual(r.value[key], filled[key], `${key} 가 사라지거나 바뀌었다`);
  }
  assert.deepEqual(r.value.files, filled.files);
  assert.deepEqual(r.value.designs, filled.designs);
  assert.deepEqual(r.value.ageGroups, filled.ageGroups);
  assert.deepEqual(r.value.acquisition, filled.acquisition);
  assert.deepEqual(r.dropped, [], "정상 입력에서 잘린 값이 있으면 안 된다");

  // 저장 대상 키가 늘거나 줄면 quotes 테이블 매핑과 어긋난다
  assert.equal(Object.keys(r.value).length, 30);
});

/* ── 첨부 URL: 호스트까지 고정 ───────────────────────────── */

test("남의 호스트에 우리 경로만 흉내 낸 URL 은 통과하지 못한다", () => {
  for (const bad of [
    "https://evil.example.com/storage/v1/object/public/a.png",
    "https://syrfoqwvsciicfbeemqv.supabase.co.evil.com/storage/v1/object/public/a.png",
    "https://other-project.supabase.co/storage/v1/object/public/a.png",
    "http://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/a.png",
  ]) {
    assert.equal(safeFileUrl(bad), "", `통과하면 안 된다: ${bad}`);
  }
});

test("href 속성을 탈출시키는 문자가 섞이면 버린다", () => {
  assert.equal(safeFileUrl(`${STORAGE}/a.png" onmouseover="alert(1)`), "");
  assert.equal(safeFileUrl(`${STORAGE}/a.png<script>`), "");
});

test("상한을 넘는 URL 은 잘라서 담지 않고 버린다 — 깨진 링크가 메일에 나가면 안 된다", () => {
  const tooLong = `${STORAGE}/` + "a".repeat(QUOTE_LIMITS.url);
  assert.equal(safeFileUrl(tooLong), "");
});

/* ── 이메일: 절삭 대신 거절 ─────────────────────────────── */

test("상한을 넘는 이메일은 잘라서 받지 않는다 — 자르면 다른 사람 주소가 된다", () => {
  const long = "a".repeat(190) + "@corp.co.kr.attacker-typo.example.org";
  assert.ok(long.length > QUOTE_LIMITS.email);
  const r = normalizeQuoteInput(submission({ email: long }));
  assert.equal(r.ok, false, "형식만 멀쩡한 엉뚱한 주소로 접수되면 안 된다");
  assert.equal(r.field, "email");
});

/* ── 한 줄 필드의 개행 ──────────────────────────────────── */

test("이름·연락처의 줄바꿈은 공백으로 접는다 — 이름은 알림 메일 제목에 들어간다", () => {
  const r = ok(submission({ name: "홍길동\nSubject: 가짜", phone: "010-1234-5678\r\n내선 100" }));
  assert.ok(!/[\r\n]/.test(r.value.name), `이름에 개행이 남았다: ${JSON.stringify(r.value.name)}`);
  assert.ok(!/[\r\n]/.test(r.value.phone));
  assert.equal(r.value.name, "홍길동 Subject: 가짜");
});

test("메모·색상 요청의 줄바꿈은 그대로 살린다", () => {
  const r = ok(submission({ notes: "첫 줄\n둘째 줄", colorRequest: "가\n나" }));
  assert.equal(r.value.notes, "첫 줄\n둘째 줄");
  assert.equal(r.value.colorRequest, "가\n나");
});

test("제로폭 문자·NBSP 도 걷어낸다", () => {
  const r = ok(submission({ name: "홍\u200B길동\u00A0" }));
  assert.equal(r.value.name, "홍길동");
});

test("절삭 기록은 실제로 상한을 넘었을 때만 남는다 — 공백만 줄어든 건 오탐이었다", () => {
  const r = ok(submission({ notes: "가".repeat(600) + " ".repeat(3600) }));
  assert.deepEqual(r.dropped, [], `공백 정리를 절삭으로 기록했다: ${r.dropped.join(", ")}`);
});
