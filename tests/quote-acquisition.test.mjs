/**
 * 제작 문의 유입 배지 테스트 (node --test)
 *   node --test tests/quote-acquisition.test.mjs
 *
 * 이 로직은 예전에 UTM·gclid 가 있을 때만 배지를 만들어서, 검색·외부링크로
 * 들어온 문의가 referrer 를 저장해 놓고도 화면에는 "—" 로만 보였다.
 * "표시가 안 된다"는 조용한 실패라 눈으로는 잡히지 않는다 — 여기서 못 박아 둔다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { acquisitionBadge } from "../src/lib/quote-acquisition.ts";
import { manualAcquisition } from "../src/lib/quote-types.ts";

const HOST = "www.papercraft.kr";

/** 유입정보 한 벌 — 지정한 필드만 덮어쓴다 */
function acq(over = {}) {
  return {
    referrer: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    gclid: "",
    adHint: "",
    ...over,
  };
}

test("구글 자연검색 유입이 표시된다 — 이게 '—' 로 나오던 버그", () => {
  const b = acquisitionBadge(acq({ referrer: "https://www.google.com/" }), HOST);
  assert.ok(b, "배지가 있어야 한다");
  assert.equal(b.text, "google · 검색");
  assert.equal(b.tone, "plain");
});

test("네이버 자연검색 유입이 표시된다", () => {
  const b = acquisitionBadge(acq({ referrer: "https://search.naver.com/search.naver?query=%ED%8E%98%EC%9D%B4%ED%8D%BC" }), HOST);
  assert.equal(b.text, "naver · 검색");
});

test("외부 사이트 링크는 호스트명과 함께 외부링크로 표시된다", () => {
  const b = acquisitionBadge(acq({ referrer: "https://blog.example.co.kr/post/1" }), HOST);
  assert.equal(b.text, "blog.example.co.kr · 외부링크");
});

test("소셜 유입이 검색보다 우선한다 — blog.naver 같은 케이스", () => {
  const b = acquisitionBadge(acq({ referrer: "https://www.instagram.com/" }), HOST);
  assert.equal(b.text, "instagram · 소셜");
});

test("광고 유입은 눈에 띄는 톤으로 구분된다", () => {
  const gclid = acquisitionBadge(acq({ gclid: "CjwKCAjw" }), HOST);
  assert.equal(gclid.tone, "ad");
  assert.equal(gclid.text, "google · 광고");

  const utm = acquisitionBadge(
    acq({ utmSource: "naver", utmMedium: "cpc", utmCampaign: "여름행사" }),
    HOST
  );
  assert.equal(utm.tone, "ad");
  assert.equal(utm.text, "naver · 광고 · 여름행사", "캠페인명까지 붙는다");
});

test("chatgpt 링크(utm_source 자동 부착)도 그대로 잡힌다", () => {
  // 이전 로직에서 유일하게 표시되던 케이스 — 회귀하지 않는지 확인
  const b = acquisitionBadge(acq({ utmSource: "chatgpt.com" }), HOST);
  assert.equal(b.text, "chatgpt.com · 캠페인");
});

test("referrer 가 없으면 '직접 유입' — 'direct · 직접' 같은 군더더기 없이", () => {
  const b = acquisitionBadge(acq(), HOST);
  assert.equal(b.text, "직접 유입");
  assert.equal(b.tone, "plain");
});

test("우리 사이트에서 온 이동은 내부이동으로 분류된다", () => {
  const b = acquisitionBadge(acq({ referrer: "https://www.papercraft.kr/products" }), HOST);
  assert.equal(b.text, "direct · 내부이동");
});

test("유입정보가 아예 없으면 null — '정보 없음'과 '직접 유입'은 다르다", () => {
  assert.equal(acquisitionBadge(null, HOST), null, "유입 수집 이전 데이터");
  assert.equal(acquisitionBadge(undefined, HOST), null);
});

test("수동 등록 문의는 접수 경로와 함께 구분되어 보인다", () => {
  for (const [channel, expected] of [
    ["phone", "직접 등록 · 전화"],
    ["email", "직접 등록 · 이메일"],
    ["kakao", "직접 등록 · 카카오톡"],
    ["referral", "직접 등록 · 소개·추천"],
  ]) {
    const b = acquisitionBadge(manualAcquisition(channel), HOST);
    assert.equal(b.text, expected, channel);
    assert.equal(b.tone, "manual", channel);
  }
});

test("수동 등록이 referrer 해석보다 우선한다", () => {
  // utmSource='manual' 이면 그 자체가 출처다 — parseAcquisition 으로 넘기면
  // "manual · phone" 같은 엉뚱한 라벨이 된다
  const b = acquisitionBadge(
    { ...manualAcquisition("phone"), referrer: "https://www.google.com/" },
    HOST
  );
  assert.equal(b.text, "직접 등록 · 전화");
});
