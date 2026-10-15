/**
 * 제안서 AI 초안 테스트 (node --test) — 네트워크 없음. 모델 호출은 가짜 함수로 주입한다.
 *   node --test tests/proposal-generate.test.mjs
 *
 * 못 박는 것: 프롬프트가 규칙(한도·빈칸·금지어)을 담고 옛 본문을 '조사 메모'로만 다루는지,
 * 생성 결과가 저장 형식·분량 한도를 지키고 견적 금액이 언제나 빈칸인지, 오류가 한국어 이유로 바뀌는지.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedSourceUrls,
  buildPrompt,
  describeGenerateError,
  generateDraft,
  generationSchema,
  resolveModel,
  DEFAULT_MODEL,
} from "../src/lib/proposal-book/generate.ts";
import { bookContentSchema, checkLimits, charLen, LIMITS, TBD } from "../src/lib/proposal-book/schema.ts";

const OLD_BODY = "## 기관 현황과 기회\n**옛 액션 타이틀 문장**\n통영시는 케이블카를 운영합니다. 예상 690만~1,220만원.";

const lead = {
  id: "00000000-0000-0000-0000-000000000001",
  org: "통영시",
  name: "관광과",
  email: "tour@tongyeong.go.kr",
  segment: "지자체",
  score: 82,
  notes: "공모전 공고 https://www.tongyeong.go.kr/notice/1",
  outreach: {
    subject: "[papercraft.kr] 통영 케이블카 기념품 제안",
    body_text: OLD_BODY,
    matched_cases: ["남산타워 팝업북(이노션/현대)", "경찰청 포돌이 페이퍼토이(경찰청)"],
    image_prompt: "케이블카 곤돌라 조립 모형",
  },
};

/** 생성용 스키마 모양의 정상 응답 */
function validDraft() {
  return {
    org: "통영시",
    org_display: "",
    title: "케이블카를 손으로 세워 가져가는 기념품",
    subtitle: "미륵산 케이블카를 조립식 종이모형으로 만듭니다.",
    contact: { dept: "관광과", email: "made-up@example.com" },
    glance: {
      headline: "타고 내려온 케이블카를 다시 세웁니다",
      lede: "손에 남는 기념품을 만듭니다. 두 가지로 시작합니다.",
      specs: [
        { label: "품목", value: "조립식 종이모형 2종" },
        { label: "크기", value: "완성 15~20cm" },
        { label: "조립", value: "칼·가위·풀 없이" },
        { label: "최소 수량", value: "1,000개부터" },
      ],
    },
    observation: {
      headline: "케이블카 뒤에 손에 남는 것이 없습니다",
      quote: "만들어 가져가는 기념품은 아직 없습니다.",
      body: ["통영시는 공모전을 열었습니다.[^1]", "운영 주체는 [확인 필요: 기념품점 운영 주체]입니다."],
      sources: [
        { label: "공모전 공고", url: "https://www.tongyeong.go.kr/notice/1" },
        { label: "지어낸 기사", url: "https://fake.example.com/news" },
      ],
    },
    offer: {
      headline: "체험과 매대에서 만나게 합니다",
      lede: "같은 도면을 두 쓰임으로 나눕니다.",
      lines: [
        { use: "체험존", name: "워크숍 키트", body: ["곤돌라를 세웁니다.", "두 난이도입니다."], spec: "조립 20분" },
        { use: "기념품점", name: "리테일 패키지", body: ["선물로 삽니다.", "상자에 담습니다."], spec: "개별 포장" },
      ],
    },
    designs: {
      headline: "",
      note: "",
      items: [
        { key: "A", title: "곤돌라", note: "곤돌라 단독 정면" },
        { key: "B", title: "한려수도", note: "섬과 케이블 전경" },
        { key: "C", title: "나전 문양", note: "나전칠기 문양 패턴" },
      ],
    },
    scenes: { headline: "축제와 매대", items: [{ title: "축제", body: "부스에서 조립" }, { title: "매대", body: "선물로 판매" }] },
    cases: {
      headline: "비슷한 일을 해 왔습니다",
      items: [
        { org: "이노션", title: "남산타워 팝업북", note: "" },
        { org: "경찰청", title: "포돌이 페이퍼토이", note: "" },
        { org: "[확인 필요: 기관]", title: "[확인 필요: 사례명]", note: "" },
      ],
    },
    pricing: {
      headline: "수량이 늘수록 단가가 내려갑니다",
      lede: "세 구간으로 보여 드립니다.",
      tiers: [
        { qty: "2,000개", desc: "1,000부 × 2종", total: "500만 원", unit: "2,500원", pick: false },
        { qty: "4,000개", desc: "2,000부 × 2종", total: "800만 원", unit: "2,000원", pick: true },
        { qty: "8,000개", desc: "4,000부 × 2종", total: "1,200만 원", unit: "1,500원", pick: false },
      ],
      includes: ["디자인 시안 3종과 수정 2회"],
      notes: ["VAT 별도"],
    },
    plan: {
      headline: "4주면 납품합니다",
      steps: [
        { when: "1주", title: "시안", body: "방향 선택" },
        { when: "2주", title: "디벨롭", body: "수정 2회" },
        { when: "4주", title: "납품", body: "지정 장소" },
      ],
    },
    closing: { headline: "샘플을 먼저 보내 드립니다", lede: "실물을 보고 정하세요.", next: ["샘플 요청", "시안 선택"] },
  };
}

const fakeCall = (output, seen) => async (args) => {
  if (seen) Object.assign(seen, args);
  return { output, usage: { inputTokens: 1, outputTokens: 1 } };
};

test("buildPrompt: 기관명·한도·빈칸 규칙·금지어를 담고 옛 본문은 조사 메모로만", () => {
  const { system, prompt } = buildPrompt(lead);
  assert.match(prompt, /통영시/);
  assert.match(prompt, /지자체/);
  assert.match(prompt, /82/);
  assert.match(prompt, /남산타워 팝업북/);
  assert.match(prompt, /케이블카 곤돌라 조립 모형/);
  assert.ok(prompt.includes(OLD_BODY), "옛 본문은 자료로 들어간다");
  // 한도 숫자
  assert.ok(system.includes(`${LIMITS.chars.headline}자 이내`));
  assert.ok(system.includes(`${LIMITS.chars.lede}자 이내`));
  assert.ok(system.includes(`${LIMITS.chars.sentence}자 이내`));
  assert.ok(system.includes(`${LIMITS.chars.designNote}자 이내`));
  // 빈칸·견적·금지어
  assert.match(system, /\[확인 필요: 무엇\]/);
  assert.ok(system.includes(TBD("단가")));
  for (const w of ["함께", "시너지", "혁신", "새로운 가치"]) assert.ok(system.includes(`"${w}"`), w);
  assert.match(system, /칭찬하는 도입부/);
  // 옛 본문을 '옮겨 쓰라'가 아니라 '사실을 뽑는 조사 메모'로 다루라고 한다
  assert.match(system, /조사 메모로만/);
  assert.match(system, /문장을 옮겨 쓰지 말고/);
  assert.match(prompt, /문장 재사용 금지/);
  assert.doesNotMatch(system + prompt, /(본문|제안서)을? (다듬어|그대로 옮겨|재구성해) (써|작성)/);
});

test("resolveModel: 환경 변수 끝 줄바꿈을 걷고 없으면 기본값", () => {
  const prev = process.env.AI_GATEWAY_MODEL;
  try {
    delete process.env.AI_GATEWAY_MODEL;
    assert.equal(resolveModel(), DEFAULT_MODEL);
    process.env.AI_GATEWAY_MODEL = "anthropic/claude-sonnet-5.5\n";
    assert.equal(resolveModel(), "anthropic/claude-sonnet-5.5");
    assert.equal(resolveModel("x/y"), "x/y");
  } finally {
    if (prev === undefined) delete process.env.AI_GATEWAY_MODEL;
    else process.env.AI_GATEWAY_MODEL = prev;
  }
});

test("generationSchema: 튜플(prefixItems) 없이 정상 응답을 받는다", () => {
  assert.equal(generationSchema.safeParse(validDraft()).success, true);
});

test("generateDraft (a) 정상 응답 → 저장 형식 통과, 금액은 빈칸, 지어낸 출처·메일 제거", async () => {
  const seen = {};
  const r = await generateDraft(lead, { call: fakeCall(validDraft(), seen), model: "test/model" });
  assert.equal(r.model, "test/model");
  assert.equal(seen.model, "test/model");
  assert.ok(seen.abortSignal instanceof AbortSignal);
  assert.equal(seen.schema, generationSchema);
  const c = r.content;
  assert.equal(bookContentSchema.safeParse(c).success, true);
  assert.deepEqual(checkLimits(c), []);
  for (const t of c.pricing.tiers) {
    assert.equal(t.total, TBD("단가"));
    assert.equal(t.unit, TBD("단가"));
  }
  assert.equal(c.pricing.tiers.filter((t) => t.pick).length, 1);
  assert.equal(c.pricing.tiers[1].pick, true);
  assert.deepEqual(c.glance.specs[0], ["품목", "조립식 종이모형 2종"]);
  assert.deepEqual(c.observation.sources, [{ label: "공모전 공고", url: "https://www.tongyeong.go.kr/notice/1" }]);
  assert.equal(c.contact.email, "tour@tongyeong.go.kr", "자료에 없는 메일은 리드 메일로");
  assert.equal(c.cover, "");
  assert.equal(c.scenes.image, "");
  assert.ok(c.designs.items.every((d) => d.image === ""));
  assert.ok(c.cases.items.every((d) => d.image === ""));
  assert.deepEqual(c.designs.items.map((d) => d.key), ["A", "B", "C"]);
  assert.equal(c.org, "통영시");
  assert.equal("org_display" in c, false);
});

test("generateDraft (b) 넘치는 응답 → 한도 안으로, 추천은 하나", async () => {
  const d = validDraft();
  d.glance.headline = "가".repeat(40);
  d.observation.body = ["1.", "2.", "3.", "4.", "5."];
  d.pricing.tiers = [
    { qty: "1", desc: "a", total: "1만 원", unit: "1원", pick: true },
    { qty: "2", desc: "b", total: "2만 원", unit: "2원", pick: true },
    { qty: "3", desc: "c", total: "3만 원", unit: "3원", pick: false },
    { qty: "4", desc: "d", total: "4만 원", unit: "4원", pick: false },
  ];
  d.designs.items[0].note = "가".repeat(45);
  d.closing.next = ["a"];
  const { content: c } = await generateDraft(lead, { call: fakeCall(d) });
  assert.equal(bookContentSchema.safeParse(c).success, true);
  assert.deepEqual(checkLimits(c), []);
  assert.equal(c.observation.body.length, LIMITS.counts["observation.body"].max);
  assert.equal(c.pricing.tiers.length, 3);
  assert.equal(c.pricing.tiers.filter((t) => t.pick).length, 1);
  assert.ok(charLen(c.glance.headline) <= LIMITS.chars.headline);
  assert.ok(charLen(c.designs.items[0].note) <= LIMITS.chars.designNote);
  assert.equal(c.closing.next.length, LIMITS.counts["closing.next"].min);
  assert.ok(c.pricing.tiers.every((t) => t.total === TBD("단가")));
});

test("generateDraft: 옛 저장 모양(specs 튜플) 응답도 받는다", async () => {
  const d = validDraft();
  d.glance.specs = d.glance.specs.map((x) => [x.label, x.value]);
  const { content } = await generateDraft(lead, { call: fakeCall(d) });
  assert.deepEqual(content.glance.specs[1], ["크기", "완성 15~20cm"]);
});

test("generateDraft: 형식이 깨진 응답은 던지고 이유는 '형식'", async () => {
  await assert.rejects(generateDraft(lead, { call: fakeCall("not an object") }), (e) => {
    assert.match(describeGenerateError(e), /형식/);
    return true;
  });
});

test("generateDraft (c) 402 → 크레딧 안내", async () => {
  const call = async () => {
    const e = new Error("Payment Required");
    e.statusCode = 402;
    throw e;
  };
  await assert.rejects(generateDraft(lead, { call }), (e) => {
    assert.match(describeGenerateError(e), /크레딧/);
    return true;
  });
});

test("describeGenerateError: 인증·속도 제한·시간 초과·재시도 감싸기", () => {
  const auth = Object.assign(new Error("AI Gateway authentication failed: No authentication provided."), {
    name: "GatewayAuthenticationError",
    statusCode: 401,
  });
  assert.match(describeGenerateError(auth), /인증/);
  assert.match(describeGenerateError(Object.assign(new Error("x"), { statusCode: 429 })), /잠시 막혔/);
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  assert.match(describeGenerateError(timeout), /90초/);
  // AI SDK RetryError 는 lastError 로 원인을 감싼다
  const retry = Object.assign(new Error("Failed after 2 attempts"), {
    name: "AI_RetryError",
    lastError: Object.assign(new Error("insufficient funds"), { statusCode: 402 }),
  });
  assert.match(describeGenerateError(retry), /크레딧/);
  assert.match(describeGenerateError(new Error("boom")), /boom/);
});

test("출처 URL: outreach 의 URL 칸·운영자 메모만, 본문 속 링크·앞부분만 맞춘 주소는 버린다", async () => {
  const l = {
    ...lead,
    email: "",
    notes: "담당 공고 https://www.tongyeong.go.kr/notice/1.",
    outreach: {
      ...lead.outreach,
      body_text: "본문 속 링크 https://agent-made.example.com/article 와 tour@tongyeong.go.kr",
      contact_form_url: "https://www.tongyeong.go.kr/contact",
      research: { view_url: "https://news.example.com/v/9/", sources: [{ label: "기사", url: "https://press.example.com/a" }] },
      links: ["https://blog.example.com/p"],
    },
  };
  const allowed = allowedSourceUrls(l);
  assert.ok(allowed.has("https://www.tongyeong.go.kr/notice/1"), "메모의 링크(끝 마침표 제거)");
  assert.ok(allowed.has("https://www.tongyeong.go.kr/contact"));
  assert.ok(allowed.has("https://news.example.com/v/9"), "중첩 view_url, 끝 / 제거");
  assert.ok(allowed.has("https://press.example.com/a"), "sources 안의 url");
  assert.ok(allowed.has("https://blog.example.com/p"), "links 배열의 문자열");
  assert.equal(allowed.has("https://agent-made.example.com/article"), false, "자유 서술 본문 속 링크는 아니다");

  const d = validDraft();
  d.contact.email = "tour@tongyeong.go.kr"; // 본문에 있는 주소라도 리드 메일이 아니면 받지 않는다
  d.observation.sources = [
    { label: "본문 링크", url: "https://agent-made.example.com/article" },
    { label: "앞부분만 맞춤", url: "https://www.tongyeong.go.kr" },
    { label: "기사", url: "https://news.example.com/v/9/" },
    { label: "문의", url: "https://www.tongyeong.go.kr/contact" },
  ];
  const c = (await generateDraft(l, { call: fakeCall(d) })).content;
  assert.deepEqual(
    c.observation.sources.map((x) => x.url),
    ["https://news.example.com/v/9/", "https://www.tongyeong.go.kr/contact"]
  );
  assert.equal(c.contact.email, "", "리드 메일이 없으면 비운다 — 모델·본문의 주소를 쓰지 않는다");

  const c2 = (await generateDraft({ ...l, email: "desk@tongyeong.go.kr" }, { call: fakeCall(d) })).content;
  assert.equal(c2.contact.email, "desk@tongyeong.go.kr", "리드 자신의 메일만");
});
