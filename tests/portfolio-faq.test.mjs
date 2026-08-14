/**
 * 사례별 FAQ 파생 규칙 테스트 (node --test)
 *   node --test tests/portfolio-faq.test.mjs
 *
 * 지키려는 것:
 *  1. 페이지마다 Q&A 가 달라진다 (109개에 같은 FAQ 를 붙이면 중복 콘텐츠)
 *  2. /faq 의 일반 질문과 겹치지 않는다
 *  3. 등록되지 않은 카테고리·유형에도 안전하게 동작한다
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = readFileSync(path.join(ROOT, "src", "lib", "portfolio-faq.ts"), "utf-8");
const PAGE = readFileSync(
  path.join(ROOT, "src", "app", "portfolio", "[slug]", "page.tsx"),
  "utf-8",
);
const FAQ_PAGE = readFileSync(path.join(ROOT, "src", "app", "faq", "page.tsx"), "utf-8");

/** 실제 데이터에 존재하는 값들 (data/portfolio-current.json 기준) */
const CATEGORIES = ["페이퍼 크래프트", "팝업북", "모자/마스크", "액션 크래프트", "자체 제작"];
const CLIENT_TYPES = [
  "기업·브랜드",
  "전시·행사",
  "지자체·관광",
  "박물관·과학관",
  "키즈·교육",
  "자체 유통상품",
  "백화점·유통",
];

test("실제 데이터의 카테고리 5종이 모두 FAQ 를 갖는다", () => {
  for (const c of CATEGORIES) {
    assert.ok(SRC.includes(`"${c}"`) || SRC.includes(`${c}:`), `카테고리 미등록: ${c}`);
  }
});

test("실제 데이터의 클라이언트 유형 7종이 모두 FAQ 를 갖는다", () => {
  for (const t of CLIENT_TYPES) {
    assert.ok(SRC.includes(`"${t}"`), `클라이언트 유형 미등록: ${t}`);
  }
});

test("/faq 의 일반 질문과 겹치지 않는다 (중복 콘텐츠 방지)", () => {
  const generalQuestions = [...FAQ_PAGE.matchAll(/question: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(generalQuestions.length >= 10, "일반 FAQ 를 읽지 못함");
  const caseQuestions = [...SRC.matchAll(/question:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const q of caseQuestions) {
    assert.ok(!generalQuestions.includes(q), `/faq 와 중복된 질문: ${q}`);
  }
});

test("카테고리·유형 조합마다 질문 묶음이 달라진다", () => {
  // 조합 수가 곧 페이지 간 차별화 폭 — 최소 카테고리 수 × 유형 수 만큼 나와야 한다
  const catBlock = SRC.match(/const BY_CATEGORY[\s\S]*?\n\};/)?.[0] ?? "";
  const typeBlock = SRC.match(/const BY_CLIENT_TYPE[\s\S]*?\n\};/)?.[0] ?? "";
  const catQ = (catBlock.match(/question:/g) ?? []).length;
  const typeQ = (typeBlock.match(/question:/g) ?? []).length;
  assert.equal(catQ, CATEGORIES.length, `카테고리 질문 ${catQ}개 ≠ ${CATEGORIES.length}`);
  assert.equal(typeQ, CLIENT_TYPES.length, `유형 질문 ${typeQ}개 ≠ ${CLIENT_TYPES.length}`);
});

test("미등록 값에도 안전 — 마무리 질문은 항상 붙는다", () => {
  assert.match(SRC, /entries\.push\(closingEntry\(item\)\)/, "마무리 질문이 무조건 추가되지 않음");
  assert.match(SRC, /if \(byCat\) entries\.push/, "카테고리 미등록 시 건너뛰지 않음");
  assert.match(SRC, /if \(byType\) entries\.push/, "유형 미등록 시 건너뛰지 않음");
});

test("상세 페이지: FAQPage JSON-LD 와 본문 Q&A 를 함께 렌더한다", () => {
  assert.match(PAGE, /"@type": "FAQPage"/, "FAQPage 스키마 없음");
  assert.match(PAGE, /derivePortfolioFaq\(item\)/, "FAQ 파생 호출 없음");
  // 구글 정책: 스키마만 있고 화면에 없으면 위반 — 본문 렌더가 반드시 있어야 한다
  assert.match(PAGE, /이 작업에 대해 자주 묻는 질문/, "본문 FAQ 섹션이 없음(스키마 전용 금지)");
  assert.match(PAGE, /\{f\.answer\}/, "본문에 답변이 렌더되지 않음");
});

test("답변에 확인 불가한 사례별 수치를 넣지 않는다", () => {
  // 이 건의 실제 수량·단가·기간은 데이터에 없다. 일반 사실(1,000부·3~4주)만 허용.
  const answers = [...SRC.matchAll(/answer:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(answers.length > 0, "답변을 읽지 못함");
  for (const a of answers) {
    assert.ok(!/이 사례는 .*?원/.test(a), `사례별 단가를 단정: ${a.slice(0, 40)}`);
    assert.ok(!/총 \d+부 제작/.test(a), `사례별 수량을 단정: ${a.slice(0, 40)}`);
  }
});
