/**
 * 유입·클릭 분석 — 추이 차트 규칙 테스트 (node --test)
 *   node --test tests/analytics-trend-chart.test.mjs
 *
 * 사용자 보고 버그: 일별 추이에 방문객 수 그래프가 안 보였다 (페이지뷰만 그렸음).
 *   - 차트는 방문(세션)·페이지뷰를 모두 그린다 (범례 포함)
 *   - 막대 호버 시 마우스 옆에 실제 수치가 표시된다 (마우스 추적 툴팁)
 *   - 집계(summarize)는 빈 날짜도 0 버킷으로 채워 준다 (막대 자리 유지)
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { summarize } from "../src/lib/analytics.ts";

const CHART = new URL("../src/components/admin/DailyTrendChart.tsx", import.meta.url);
const PAGE = new URL("../src/app/admin/analytics/page.tsx", import.meta.url);

test("추이 차트 — 방문(세션) 그래프와 범례가 있다", async () => {
  const src = await readFile(CHART, "utf8");
  assert.ok(src.startsWith('"use client"'), "마우스 이벤트를 쓰므로 클라이언트 컴포넌트여야 한다");
  assert.ok(src.includes("방문 (세션)"), "방문(세션) 범례가 있어야 한다");
  assert.ok(src.includes("페이지뷰"), "페이지뷰 범례가 있어야 한다");
  // 방문 막대: sessions 높이로 그린다
  assert.ok(src.includes("d.sessions"), "세션 수로 막대를 그려야 한다");
  assert.ok(src.includes("d.pageviews"), "페이지뷰 수로 막대를 그려야 한다");
});

test("추이 차트 — 마우스 추적 툴팁이 실제 수치를 보여준다", async () => {
  const src = await readFile(CHART, "utf8");
  assert.ok(src.includes("onMouseMove"), "마우스 이동을 추적해야 한다");
  assert.ok(src.includes("onMouseLeave"), "마우스가 떠나면 툴팁을 닫아야 한다");
  assert.ok(src.includes("fixed"), "툴팁은 커서 좌표 기준(fixed)으로 띄운다");
  assert.match(src, /방문 \{nf\(point\.sessions\)\}명/, "툴팁에 방문자 수가 있어야 한다");
  assert.match(src, /페이지뷰 \{nf\(point\.pageviews\)\}/, "툴팁에 페이지뷰 수가 있어야 한다");
});

test("분석 페이지 — 추이 차트를 컴포넌트로 사용한다", async () => {
  const src = await readFile(PAGE, "utf8");
  assert.ok(src.includes("<DailyTrendChart"), "DailyTrendChart 를 사용해야 한다");
  assert.ok(!src.includes("group-hover:block"), "구 CSS 툴팁이 남아 있으면 안 된다");
});

test("summarize — 일별 버킷에 방문·페이지뷰가 함께 집계된다 (빈 날 0 포함)", () => {
  const day = (d, extra = {}) => ({
    type: "pageview",
    path: "/",
    referrer: null,
    source: "direct",
    medium: "direct",
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    keyword: null,
    label: null,
    href: null,
    duration_ms: null,
    session_id: "s1",
    device: "desktop",
    created_at: d,
    ...extra,
  });
  // KST 7/1·7/3 에만 방문 (7/2 는 빈 날)
  const rows = [
    day("2026-07-01T03:00:00Z"),
    day("2026-07-01T04:00:00Z", { session_id: "s2" }),
    day("2026-07-03T03:00:00Z", { session_id: "s3" }),
  ];
  const from = Date.parse("2026-06-30T15:00:00Z"); // KST 7/1 00:00
  const to = Date.parse("2026-07-03T14:59:59Z"); // KST 7/3 23:59
  const s = summarize(rows, { from, to, unit: "day" });
  assert.equal(s.daily.length, 3);
  assert.deepEqual(
    s.daily.map((d) => [d.date, d.pageviews, d.sessions]),
    [
      ["2026-07-01", 2, 2],
      ["2026-07-02", 0, 0],
      ["2026-07-03", 1, 1],
    ],
  );
});
