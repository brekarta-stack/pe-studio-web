/**
 * 견적서 자동 생성 테스트 (node --test)
 *   node --test tests/estimate.test.mjs
 *
 * 고객에게 그대로 나가는 금액이다. 확인하는 것:
 *   - 기본 품목 합계: 페이퍼토이 700만 / 우드락 900만 (부가세 별도)
 *   - 앱 계산과 시트 수식이 같은 합계를 낸다 (시트 수식을 직접 계산해 대조)
 *   - 문서 번호·날짜(한국 시간)·파일 이름
 *   - 입력 검증, 문자열이 시트 수식으로 바뀌지 않음
 *   - DB 제약 목록이 앱 목록과 같음
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  CATEGORY_FOLDERS,
  EDITABLE_STATUSES,
  MAX_SUPPLY,
  STATUS_PRIORITY,
  classifySendError,
  formatKstDateTime,
  normalizeBaseUrl,
  SEND_STUCK_MS,
  sameTotals,
  sheetTotalsConsistent,
  ESTIMATE_CATEGORIES,
  ESTIMATE_STATUSES,
  ESTIMATE_TEMPLATES,
  buildDocNumber,
  buildFileName,
  completedSteps,
  computeTotals,
  defaultEmailDraft,
  docNumberBase,
  formatAmount,
  formatKoreanDate,
  isEditable,
  isIsoDate,
  kstToday,
  nextDocSeq,
  parseEmailList,
  sanitizeEstimateInput,
  sanitizeItems,
  templateItems,
  vatOf,
} from "../src/lib/estimate-types.ts";
import { NAMED_RANGES, buildSheetRequests, computeLayout, groupSpans } from "../src/lib/estimate-sheet.ts";
import { decryptToken, encryptToken } from "../src/lib/token-crypto.ts";

/* ── 기본 품목 ─────────────────────────────────────────────── */

test("페이퍼토이 기본 합계는 700만 원(부가세 별도), VAT 포함 770만 원", () => {
  const t = computeTotals(ESTIMATE_TEMPLATES.papertoy.items);
  assert.equal(t.supply, 7_000_000);
  assert.equal(t.vat, 700_000);
  assert.equal(t.total, 7_700_000);
});

test("우드락 기본 합계는 900만 원(부가세 별도), VAT 포함 990만 원", () => {
  const t = computeTotals(ESTIMATE_TEMPLATES.woodrock.items);
  assert.equal(t.supply, 9_000_000);
  assert.equal(t.vat, 900_000);
  assert.equal(t.total, 9_900_000);
});

test("우드락 항목별 금액 = 목형 140 / 제조 420 / 개발 200 / CS 70 / 생산관리 70 (만 원)", () => {
  const byGroup = Object.fromEntries(
    ESTIMATE_TEMPLATES.woodrock.items.map((i) => [i.group, i.quantity * i.unitPrice]),
  );
  assert.deepEqual(byGroup, {
    목형: 1_400_000,
    제조: 4_200_000,
    개발: 2_000_000,
    CS: 700_000,
    생산관리: 700_000,
  });
});

test("우드락 배분은 원래 사양(부가세 포함 726만)의 비율에서 1%p 안쪽이다", () => {
  const original = { 목형: 110, 제조: 341, 개발: 165, CS: 55, 생산관리: 55 };
  const origSum = Object.values(original).reduce((a, b) => a + b, 0);
  assert.equal(origSum, 726);
  assert.equal(Math.round((origSum / 1.1) * 10) / 10, 660); // 부가세 별도 660만
  const total = 9_000_000;
  for (const item of ESTIMATE_TEMPLATES.woodrock.items) {
    const share = (item.quantity * item.unitPrice) / total;
    const origShare = original[item.group] / origSum;
    assert.ok(Math.abs(share - origShare) < 0.01, `${item.group}: ${share} vs ${origShare}`);
  }
});

test("templateItems 는 복사본을 준다 — 고쳐도 원본이 바뀌지 않는다", () => {
  const a = templateItems("papertoy");
  a[0].unitPrice = 1;
  assert.equal(ESTIMATE_TEMPLATES.papertoy.items[0].unitPrice, 2_000_000);
});

test("분류 폴더 이름: 페이퍼크래프트 / 우드락", () => {
  assert.equal(CATEGORY_FOLDERS.papertoy, "페이퍼크래프트");
  assert.equal(CATEGORY_FOLDERS.woodrock, "우드락");
});

/* ── 금액 계산 ─────────────────────────────────────────────── */

test("부가세는 원 미만 절사", () => {
  assert.equal(vatOf(1_234_567), 123_456);
  assert.equal(vatOf(9), 0);
  assert.equal(vatOf(0), 0);
});

test("formatAmount 는 시트의 #,##0 과 같은 모양", () => {
  assert.equal(formatAmount(7_000_000), "7,000,000");
  assert.equal(formatAmount(0), "0");
});

/* ── 입력 검증 ─────────────────────────────────────────────── */

test("sanitizeItems: 빈 행은 버리고, 쉼표 숫자를 읽는다", () => {
  const r = sanitizeItems([
    { group: "디자인", name: "설계", quantity: "1", unitPrice: "2,000,000", note: "" },
    { group: "", name: "", quantity: "", unitPrice: "", note: "" },
    { group: "", name: "추가 옵션", quantity: "0", unitPrice: "1,500,000", note: "" },
  ]);
  assert.ok(r.ok);
  assert.equal(r.value.length, 2);
  assert.equal(r.value[0].unitPrice, 2_000_000);
  assert.equal(r.value[1].quantity, 0);
});

test("sanitizeItems: 음수·소수·품명 누락·첫 행 품목 누락은 거부", () => {
  assert.equal(sanitizeItems([{ group: "A", name: "x", quantity: "-1", unitPrice: "1" }]).ok, false);
  assert.equal(sanitizeItems([{ group: "A", name: "x", quantity: "1.5", unitPrice: "1" }]).ok, false);
  assert.equal(sanitizeItems([{ group: "A", name: "", quantity: "1", unitPrice: "1" }]).ok, false);
  assert.equal(sanitizeItems([{ group: "", name: "x", quantity: "1", unitPrice: "1" }]).ok, false);
  assert.equal(sanitizeItems([]).ok, false);
  assert.equal(sanitizeItems("nope").ok, false);
});

test("sanitizeEstimateInput: 필수값·이메일·날짜 검증과 기본 조건", () => {
  const base = {
    category: "woodrock",
    clientCompany: "  크래커플러스 ",
    clientContact: "",
    clientEmail: "a@b.co",
    issuedOn: "2026-09-21",
    items: templateItems("woodrock"),
  };
  const ok = sanitizeEstimateInput(base);
  assert.ok(ok.ok);
  assert.equal(ok.value.clientCompany, "크래커플러스");
  assert.equal(ok.value.deliveryTerm, "지정 기일");
  assert.equal(ok.value.paymentTerm, "현 금");
  assert.equal(ok.value.quoteId, null);

  assert.equal(sanitizeEstimateInput({ ...base, category: "popup" }).ok, false);
  assert.equal(sanitizeEstimateInput({ ...base, clientCompany: " " }).ok, false);
  assert.equal(sanitizeEstimateInput({ ...base, clientEmail: "not-an-email" }).ok, false);
  assert.equal(sanitizeEstimateInput({ ...base, issuedOn: "2026-02-30" }).ok, false);
  // 제어문자·줄바꿈은 공백으로 — 시트 칸과 메일 머리에 섞이지 않게
  const ctrl = sanitizeEstimateInput({ ...base, clientCompany: "A\nB\u0007C" });
  assert.ok(ctrl.ok);
  assert.equal(ctrl.value.clientCompany, "A B C");
});

test("parseEmailList: 쉼표·공백 구분, 중복 제거, 형식 오류 거부", () => {
  const r = parseEmailList("a@x.com, b@y.kr;a@x.com  c@z.io");
  assert.ok(r.ok);
  assert.deepEqual(r.value, ["a@x.com", "b@y.kr", "c@z.io"]);
  assert.equal(parseEmailList("a@x.com, nope").ok, false);
  assert.deepEqual(parseEmailList("").ok && parseEmailList("").value, []);
});

/* ── 날짜·번호·이름 ────────────────────────────────────────── */

test("kstToday 는 서울 기준 — UTC 15시 이후는 다음 날", () => {
  assert.equal(kstToday(new Date("2026-09-20T14:59:00Z")), "2026-09-20");
  assert.equal(kstToday(new Date("2026-09-20T15:00:00Z")), "2026-09-21");
});

test("formatKoreanDate 는 기존 양식처럼 요일까지", () => {
  assert.equal(formatKoreanDate("2026-07-28"), "2026년 7월 28일 화요일");
  assert.equal(formatKoreanDate("2026-09-21"), "2026년 9월 21일 월요일");
  assert.ok(isIsoDate("2028-02-29"));
  assert.ok(!isIsoDate("2027-02-29"));
});

test("문서 번호: TO/WR + YYMMDD, 같은 날 두 번째부터 -2, -3", () => {
  assert.equal(docNumberBase("papertoy", "2026-09-21"), "TO260921");
  assert.equal(docNumberBase("woodrock", "2026-09-21"), "WR260921");
  assert.equal(buildDocNumber("papertoy", "2026-09-21", 1), "TO260921");
  assert.equal(buildDocNumber("papertoy", "2026-09-21", 3), "TO260921-3");
  assert.equal(nextDocSeq("TO260921", []), 1);
  assert.equal(nextDocSeq("TO260921", ["TO260921"]), 2);
  assert.equal(nextDocSeq("TO260921", ["TO260921", "TO260921-2", "TO260921-7"]), 8);
  // 앞자리만 같은 다른 번호는 세지 않는다
  assert.equal(nextDocSeq("TO260921", ["TO2609210", "TO260921-x"]), 1);
});

test("파일 이름은 고객사명·견적일·문서 번호를 담고 경로 문자를 뺀다", () => {
  assert.equal(
    buildFileName({ clientCompany: "CREATIVE 13", issuedOn: "2026-09-21", docNumber: "TO260921" }),
    "견적서_CREATIVE 13_2026-09-21_TO260921",
  );
  assert.equal(
    buildFileName({ clientCompany: "A/B:C", issuedOn: "2026-09-21", docNumber: "WR260921-2" }),
    "견적서_A B C_2026-09-21_WR260921-2",
  );
});

test("상태: 발송 중·발송 완료는 수정 불가, 진행 단계 수", () => {
  assert.deepEqual(ESTIMATE_STATUSES.filter(isEditable), ["draft", "generated", "confirmed"]);
  assert.deepEqual(ESTIMATE_STATUSES.map(completedSteps), [0, 1, 2, 2, 3]);
});

test("발송 메일 기본 문구에 문서 번호와 부가세 별도 금액", () => {
  const d = defaultEmailDraft({ clientCompany: "CREATIVE 13", clientContact: "김태형", docNumber: "TO260921", supply: 7_000_000 });
  assert.match(d.subject, /CREATIVE 13/);
  assert.match(d.subject, /TO260921/);
  assert.match(d.body, /김태형 님/);
  assert.match(d.body, /7,000,000원 \(부가세 별도\)/);
  const noContact = defaultEmailDraft({ clientCompany: "X", clientContact: "", docNumber: "T", supply: 1 });
  assert.match(noContact.body, /X 담당자님/);
});

/* ── 시트 ──────────────────────────────────────────────────── */

const SHEET_INPUT = {
  clientCompany: "CREATIVE 13",
  clientContact: "김태형",
  issuedOn: "2026-07-28",
  docNumber: "TO260728",
  deliveryTerm: "지정 기일",
  deliveryPlace: "귀사 지정장소",
  paymentTerm: "현 금",
  items: ESTIMATE_TEMPLATES.papertoy.items,
};
const ASSETS = { bannerUrl: "https://www.papercraft.kr/estimate/banner.png", sealUrl: null };

function gridOf(requests) {
  const uc = requests.find((r) => r.updateCells);
  return uc.updateCells.rows.map((row) => row.values);
}

function cellValue(grid, a1) {
  const m = /^([A-F])(\d+)$/.exec(a1);
  const c = m[1].charCodeAt(0) - 65;
  const r = Number(m[2]) - 1;
  return grid[r]?.[c]?.userEnteredValue;
}

/** 이 양식이 쓰는 수식만 계산하는 작은 계산기 — 시트가 낼 합계를 앱 계산과 대조한다 */
function evaluate(grid, a1, depth = 0) {
  assert.ok(depth < 20, "수식 순환");
  const v = cellValue(grid, a1);
  if (!v) return 0;
  if ("numberValue" in v) return v.numberValue;
  if ("stringValue" in v) return 0;
  const f = v.formulaValue.replace(/\s+/g, "");
  let m;
  if ((m = /^=([A-F]\d+)\*([A-F]\d+)$/.exec(f))) return evaluate(grid, m[1], depth + 1) * evaluate(grid, m[2], depth + 1);
  if ((m = /^=([A-F]\d+)\+([A-F]\d+)$/.exec(f))) return evaluate(grid, m[1], depth + 1) + evaluate(grid, m[2], depth + 1);
  if ((m = /^=SUM\(([A-F])(\d+):\1(\d+)\)$/.exec(f))) {
    let s = 0;
    for (let r = Number(m[2]); r <= Number(m[3]); r++) s += evaluate(grid, `${m[1]}${r}`, depth + 1);
    return s;
  }
  if ((m = /^=ROUNDDOWN\(([A-F]\d+)\*0\.1,0\)$/.exec(f))) return Math.floor(evaluate(grid, m[1], depth + 1) * 0.1 + 1e-9);
  throw new Error(`모르는 수식: ${f}`);
}

for (const category of ESTIMATE_CATEGORIES) {
  test(`시트 수식이 앱과 같은 합계를 낸다 — ${category}`, () => {
    const items = ESTIMATE_TEMPLATES[category].items;
    const { requests, layout } = buildSheetRequests({ ...SHEET_INPUT, items }, 42, ASSETS);
    const grid = gridOf(requests);
    const t = computeTotals(items);
    assert.equal(evaluate(grid, `D${layout.supplyRow + 1}`), t.supply);
    assert.equal(evaluate(grid, `D${layout.vatRow + 1}`), t.vat);
    assert.equal(evaluate(grid, `D${layout.totalRow + 1}`), t.total);
  });
}

test("시트 수식: 끝전이 있는 금액도 절사 규칙이 앱과 같다", () => {
  const items = [{ group: "A", name: "x", quantity: 3, unitPrice: 333_333, note: "" }];
  const { requests, layout } = buildSheetRequests({ ...SHEET_INPUT, items }, 1, ASSETS);
  const grid = gridOf(requests);
  assert.equal(evaluate(grid, `D${layout.vatRow + 1}`), vatOf(999_999));
  assert.equal(evaluate(grid, `D${layout.totalRow + 1}`), 999_999 + 99_999);
});

test("품목 6줄이면 기존 양식과 같은 행에 놓인다 (17~22행, 합계 24행)", () => {
  const L = computeLayout(6);
  assert.equal(L.itemStart + 1, 17);
  assert.equal(L.itemEnd + 1, 22);
  assert.equal(L.supplyRow + 1, 24);
  assert.equal(L.vatRow + 1, 25);
  assert.equal(L.totalRow + 1, 26);
  const { requests } = buildSheetRequests(SHEET_INPUT, 7, ASSETS);
  const grid = gridOf(requests);
  assert.equal(cellValue(grid, "E17").formulaValue, "=C17*D17");
  assert.equal(cellValue(grid, "D24").formulaValue, "=SUM(E17:E23)");
  assert.equal(cellValue(grid, "B6").stringValue, "CREATIVE 13 貴中");
  assert.equal(cellValue(grid, "B7").stringValue, "김태형 님 貴下");
  assert.equal(cellValue(grid, "B8").stringValue, "2026년 7월 28일 화요일");
  assert.equal(cellValue(grid, "B9").stringValue, "TO260728");
});

test("고객이 적은 글자는 '=' 로 시작해도 수식이 되지 않는다", () => {
  const evil = { ...SHEET_INPUT, clientCompany: '=IMPORTDATA("https://evil")', items: [{ group: "=1+1", name: "=HYPERLINK(1)", quantity: 1, unitPrice: 1, note: "=2" }] };
  const { requests } = buildSheetRequests(evil, 1, ASSETS);
  const formulas = gridOf(requests).flat().map((c) => c.userEnteredValue?.formulaValue).filter(Boolean);
  for (const f of formulas) {
    assert.ok(/^=(IMAGE|SUM|ROUNDDOWN|C\d+\*D\d+|D\d+\+D\d+)/.test(f), `예상 밖 수식: ${f}`);
  }
});

test("품목이 빈 행은 위 행과 세로 병합 (설명서 제작 2줄)", () => {
  assert.deepEqual(groupSpans(ESTIMATE_TEMPLATES.papertoy.items), [[2, 3]]);
  assert.deepEqual(groupSpans([{ group: "a" }, { group: "" }, { group: "" }, { group: "b" }, { group: "" }]), [[0, 2], [3, 4]]);
  assert.deepEqual(groupSpans([{ group: "a" }, { group: "b" }]), []);
  const { requests, layout } = buildSheetRequests(SHEET_INPUT, 5, ASSETS);
  const merges = requests.filter((r) => r.mergeCells).map((r) => r.mergeCells.range);
  assert.ok(
    merges.some((m) => m.startColumnIndex === 0 && m.endColumnIndex === 1 && m.startRowIndex === layout.itemStart + 2 && m.endRowIndex === layout.itemStart + 4),
  );
});

test("합계 칸에 이름 있는 범위가 걸린다 (확인 단계가 읽는 곳)", () => {
  const { requests, layout } = buildSheetRequests(SHEET_INPUT, 9, ASSETS);
  const named = Object.fromEntries(requests.filter((r) => r.addNamedRange).map((r) => [r.addNamedRange.namedRange.name, r.addNamedRange.namedRange.range]));
  assert.equal(named[NAMED_RANGES.supply].startRowIndex, layout.supplyRow);
  assert.equal(named[NAMED_RANGES.vat].startRowIndex, layout.vatRow);
  assert.equal(named[NAMED_RANGES.total].startRowIndex, layout.totalRow);
  for (const r of Object.values(named)) {
    assert.equal(r.sheetId, 9);
    assert.equal(r.startColumnIndex, 3);
  }
});

test("요청 순서: 병합 → 값 → 테두리 (값 뒤의 병합·서식이 테두리를 지우지 않게)", () => {
  const { requests } = buildSheetRequests(SHEET_INPUT, 1, ASSETS);
  const idx = (k) => requests.findIndex((r) => r[k]);
  const lastIdx = (k) => requests.map((r, i) => (r[k] ? i : -1)).filter((i) => i >= 0).pop();
  assert.ok(lastIdx("mergeCells") < idx("updateCells"));
  assert.ok(idx("updateCells") < idx("updateBorders"));
  assert.equal(requests.filter((r) => r.updateCells).length, 1);
  // 모든 요청이 같은 탭을 가리킨다
  const ids = JSON.stringify(requests).match(/"sheetId":(\d+)/g);
  assert.ok(ids.every((s) => s === '"sheetId":1'));
});

test("도장: 주소가 있으면 IMAGE, 없으면 '(인)' 글자", () => {
  const without = gridOf(buildSheetRequests(SHEET_INPUT, 1, ASSETS).requests).flat();
  assert.ok(without.some((c) => c.userEnteredValue?.stringValue === "주식회사 스테이지 (인)"));
  const withSeal = gridOf(buildSheetRequests(SHEET_INPUT, 1, { ...ASSETS, sealUrl: 'https://x.test/seal?k=a"b' }).requests).flat();
  const img = withSeal.map((c) => c.userEnteredValue?.formulaValue).find((f) => f?.includes("seal"));
  assert.equal(img, '=IMAGE("https://x.test/seal?k=a""b", 4, 64, 64)');
});

/* ── 토큰 암호화 ───────────────────────────────────────────── */

test("refresh token 암호화: 왕복, 다른 키·변조는 null", () => {
  const sealed = encryptToken("1//refresh-token", "secret-A");
  assert.ok(!sealed.includes("refresh-token"));
  assert.equal(decryptToken(sealed, "secret-A"), "1//refresh-token");
  assert.equal(decryptToken(sealed, "secret-B"), null);
  const parts = sealed.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.equal(decryptToken(parts.join("."), "secret-A"), null);
  assert.equal(decryptToken("garbage", "secret-A"), null);
  // 같은 평문도 매번 다른 암호문 (IV)
  assert.notEqual(encryptToken("x", "k"), encryptToken("x", "k"));
});

/* ── DB 제약·등록 ──────────────────────────────────────────── */

const SQL = readFileSync(new URL("../supabase/migrations/20260921_estimates.sql", import.meta.url), "utf-8");

test("DB CHECK 제약의 값 목록이 앱 목록과 같다", () => {
  const list = (name) => {
    const m = new RegExp(`${name}_check\\s+CHECK \\(\\w+ IN \\(([^)]*)\\)\\)`).exec(SQL);
    assert.ok(m, `${name} 제약이 없습니다`);
    return m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  };
  assert.deepEqual(list("estimates_category"), [...ESTIMATE_CATEGORIES]);
  assert.deepEqual(list("estimates_status"), [...ESTIMATE_STATUSES]);
});

test("마이그레이션이 DB 셋업 화면과 실행 API 에 등록돼 있다", () => {
  const setup = readFileSync(new URL("../src/app/admin/setup/page.tsx", import.meta.url), "utf-8");
  const migrate = readFileSync(new URL("../src/app/api/admin/migrate/route.ts", import.meta.url), "utf-8");
  assert.ok(setup.includes("migrations/20260921_estimates.sql"));
  assert.ok(migrate.includes('"migrations/20260921_estimates.sql"'));
  for (const t of ["estimates", "estimate_events", "google_drive_connection"]) {
    assert.ok(SQL.includes(`CREATE TABLE IF NOT EXISTS ${t}`));
    assert.ok(SQL.includes(`ALTER TABLE ${t}`) && SQL.includes("ENABLE ROW LEVEL SECURITY"));
  }
});

/* ── 판정 보강 (검토 지적 반영) ────────────────────────────── */

test("공급가액 합계 상한(1조) — 넘으면 거부, 정밀도 안쪽", () => {
  assert.ok(Number.isSafeInteger(MAX_SUPPLY * 1.1));
  const big = sanitizeItems([{ group: "A", name: "x", quantity: "10000000", unitPrice: "200000", note: "" }]);
  assert.equal(big.ok, false);
  const ok = sanitizeItems([{ group: "A", name: "x", quantity: "1000", unitPrice: "1000000000", note: "" }]);
  assert.ok(ok.ok);
});

test("시트 합계 정합성 — 부가세·합계 칸을 숫자로 덮어쓰면 거부", () => {
  assert.ok(sheetTotalsConsistent({ supply: 7_000_000, vat: 700_000, total: 7_700_000 }));
  assert.ok(sheetTotalsConsistent({ supply: 999_999, vat: 99_999, total: 1_099_998 }));
  assert.equal(sheetTotalsConsistent({ supply: 7_000_000, vat: 600_000, total: 7_600_000 }), false);
  assert.equal(sheetTotalsConsistent({ supply: 7_000_000, vat: 700_000, total: 7_000_000 }), false);
  assert.equal(sheetTotalsConsistent({ supply: 1.5, vat: 0, total: 1.5 }), false);
  assert.equal(sheetTotalsConsistent({ supply: -10, vat: -1, total: -11 }), false);
  assert.ok(sameTotals({ supply: 1, vat: 0, total: 1 }, { supply: 1, vat: 0, total: 1, extra: 9 }));
  assert.equal(sameTotals({ supply: 1, vat: 0, total: 1 }, { supply: 2, vat: 0, total: 2 }), false);
});

test("발송 실패 분류 — 나갔는지 모르는 실패는 되돌리지 않는다", () => {
  assert.equal(classifySendError({ statusCode: null, name: "application_error" }), "ambiguous"); // 네트워크
  assert.equal(classifySendError({ statusCode: 500, name: "application_error" }), "ambiguous"); // 응답 파싱·서버 오류
  assert.equal(classifySendError({ statusCode: 502, name: "internal_server_error" }), "ambiguous");
  assert.equal(classifySendError({ statusCode: 409, name: "invalid_idempotent_request" }), "ambiguous");
  assert.equal(classifySendError({ statusCode: 409, name: "concurrent_idempotent_requests" }), "ambiguous");
  assert.equal(classifySendError(null), "ambiguous");
  assert.equal(classifySendError({ statusCode: 422, name: "validation_error" }), "rejected");
  assert.equal(classifySendError({ statusCode: 403, name: "invalid_from_address" }), "rejected");
  assert.equal(classifySendError({ statusCode: 429, name: "rate_limit_exceeded" }), "rejected");
});

test("수정 가능 상태 목록과 목록 정렬 우선순위", () => {
  assert.deepEqual([...EDITABLE_STATUSES], ["draft", "generated", "confirmed"]);
  const sorted = [...ESTIMATE_STATUSES].sort((a, b) => STATUS_PRIORITY[a] - STATUS_PRIORITY[b]);
  assert.deepEqual(sorted, ["sending", "generated", "confirmed", "draft", "sent"]);
});

test("formatKstDateTime 은 서울 시각으로", () => {
  assert.match(formatKstDateTime("2026-09-20T15:30:00Z"), /26\. 09\. 21\./);
  assert.equal(formatKstDateTime("nope"), "—");
});

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8");

test("발송 경로 가드 — 멱등 키, 잠금 뒤 판본·합계 재대조, 애매한 실패는 sending 유지", () => {
  const a = src("src/app/admin/estimates/actions.ts");
  assert.match(a, /idempotencyKey = `estimate-\$\{id\}-.*\$\{claimed\.sendAttempt\}`/);
  // 메일 서버가 거절했을 때만 시도 번호를 올린다
  assert.match(a, /abortBeforeSend\(reason, "confirmed", true\)/);
  assert.match(a, /classifySendError/);
  const send = a.slice(a.indexOf("export async function sendEstimate"), a.indexOf("const STUCK_MS"));
  // PDF 를 뽑기 전 판본·합계 대조, 뽑은 뒤 판본 재대조
  const iBefore = send.indexOf("getFileMeta(sheetId)");
  const iTotals = send.indexOf("readSheetTotals(sheetId)");
  const iExport = send.indexOf("exportSheetPdf(");
  const iAfter = send.indexOf("getFileMeta(sheetId)", iExport);
  assert.ok(iBefore > 0 && iBefore < iTotals && iTotals < iExport && iExport < iAfter);
});

test("멈춤 판정(3분)이 견적서 화면들의 maxDuration 보다 길고, maxDuration 은 Hobby 상한(60초) 이하", () => {
  for (const f of ["src/app/admin/estimates/[id]/page.tsx", "src/app/admin/estimates/new/page.tsx", "src/app/admin/estimates/[id]/edit/page.tsx", "src/app/admin/estimates/page.tsx"]) {
    const maxDuration = Number(/export const maxDuration = (\d+);/.exec(src(f))[1]);
    assert.ok(maxDuration <= 60, `${f}: ${maxDuration}s`);
    assert.ok(SEND_STUCK_MS / 1000 > maxDuration * 2, `${f}: 멈춤 ${SEND_STUCK_MS / 1000}s vs ${maxDuration}s`);
  }
  // 멈춤 기준은 한 곳에서만 — 상세 화면과 정리 액션이 같은 값을 쓴다
  assert.match(src("src/app/admin/estimates/[id]/page.tsx"), /SEND_STUCK_MS/);
  assert.match(src("src/app/admin/estimates/actions.ts"), /SEND_STUCK_MS/);
});

test("메일 입력은 발송 대기 상태에서만 마운트된다 (본문 금액이 확인 전 값으로 남지 않게)", () => {
  const ui = src("src/components/admin/EstimateActions.tsx");
  const main = ui.slice(ui.indexOf("export default function EstimateActions"));
  assert.ok(!/useState\(p\.draft/.test(main), "메일 입력 상태가 패널 최상위에 있으면 확인 뒤에도 옛 금액이 남는다");
  assert.match(main, /p\.status === "confirmed" && \([\s\S]*?<SendForm/);
  assert.match(src("src/app/admin/estimates/[id]/page.tsx"), /sheetVersion=\{sheetVersion\}/);
});

test("관리 화면은 주소의 임의 문구를 배너로 띄우지 않는다", () => {
  for (const f of ["src/app/admin/estimates/page.tsx", "src/app/admin/estimates/[id]/page.tsx"]) {
    const t = src(f);
    assert.ok(!/sp\.(msg|warning)/.test(t), `${f} 가 주소 문구를 읽는다`);
  }
});

test("시트 그리기는 draft 에서, 같은 내용 판일 때만 generated 로 — 옛 시트가 확인 대기로 남지 않게", () => {
  const lib = src("src/lib/estimates.ts");
  const sync = lib.slice(lib.indexOf("export async function syncEstimateSheet"));
  assert.match(sync, /updateEstimateIf\(\s*e\.id,\s*\["draft"\]/);
  assert.match(sync, /\{ content_rev: e\.contentRev \}/);
  const upd = lib.slice(lib.indexOf("export async function updateEstimateContent"), lib.indexOf("export async function markForRender"));
  assert.match(upd, /status: "draft"/);
});

test("감사 기록은 DB 에서 append-only 로 막는다", () => {
  assert.match(SQL, /BEFORE UPDATE OR DELETE ON estimate_events/);
});

test("사이트 주소 정리 — 환경변수 끝의 줄바꿈·공백·슬래시를 뗀다 (운영 NEXTAUTH_URL 사고)", () => {
  assert.equal(normalizeBaseUrl("https://www.papercraft.kr\n"), "https://www.papercraft.kr");
  assert.equal(normalizeBaseUrl("  https://www.papercraft.kr/ \r\n"), "https://www.papercraft.kr");
  assert.equal(normalizeBaseUrl("https://x.test///"), "https://x.test");
  assert.equal(normalizeBaseUrl(""), "");
  // 리디렉션 주소를 만드는 곳이 정리 함수를 거친다
  assert.match(src("src/lib/google-drive.ts"), /normalizeBaseUrl\(process\.env\.NEXTAUTH_URL/);
});
