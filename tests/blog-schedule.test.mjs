import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  weeklySlot,
  weekStartUtc,
  isoWeekKey,
  SLOT_DAYS,
  SLOT_MINUTE_OFFSETS,
  WINDOW_START_HOUR_KST,
} from "../src/lib/blog-schedule-shared.mjs";

const KST_MS = 9 * 3600_000;
const kstParts = (utcDate) => {
  const k = new Date(utcDate.getTime() + KST_MS);
  return {
    day: k.getUTCDay() || 7, // 월=1 … 일=7
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
  };
};

test("weeklySlot: 같은 주 어느 시점에 계산해도 동일 (결정론)", () => {
  const mon = new Date("2026-08-03T00:00:00Z");
  const thu = new Date("2026-08-06T23:00:00Z");
  assert.equal(weeklySlot(mon).getTime(), weeklySlot(thu).getTime());
});

test("weeklySlot: 화~목, 14:00~16:00 KST, 30분 단위만 나온다 (100주 검사)", () => {
  for (let i = 0; i < 100; i++) {
    const d = new Date(Date.UTC(2026, 0, 5) + i * 7 * 86_400_000);
    const { day, hour, minute } = kstParts(weeklySlot(d));
    assert.ok(SLOT_DAYS.includes(day), `요일 이탈: ${day}`);
    const offset = (hour - 14) * 60 + minute;
    assert.ok(SLOT_MINUTE_OFFSETS.includes(offset), `시각 이탈: ${hour}:${minute}`);
  }
});

test("weeklySlot: 주마다 슬롯이 실제로 흩어진다 (한 값 고정 아님)", () => {
  const slots = new Set();
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.UTC(2026, 0, 5) + i * 7 * 86_400_000);
    const { day, hour, minute } = kstParts(weeklySlot(d));
    slots.add(`${day}-${hour}:${minute}`);
  }
  assert.ok(slots.size >= 5, `30주 동안 슬롯 종류가 ${slots.size}개뿐`);
});

test("weeklySlot 은 자기 주 안에 있다", () => {
  for (let i = 0; i < 50; i++) {
    const d = new Date(Date.UTC(2026, 2, 2) + i * 7 * 86_400_000);
    const slot = weeklySlot(d);
    const start = weekStartUtc(d);
    assert.ok(slot >= start, "슬롯이 주 시작보다 이전");
    assert.ok(slot < new Date(start.getTime() + 7 * 86_400_000), "슬롯이 주 범위 밖");
    assert.equal(isoWeekKey(slot), isoWeekKey(d), "슬롯의 주차가 다름");
  }
});

test("weekStartUtc: 월요일 00:00 KST 를 가리킨다", () => {
  const anyDay = new Date("2026-08-05T10:00:00Z"); // 수요일
  const start = weekStartUtc(anyDay);
  const { day, hour, minute } = kstParts(start);
  assert.equal(day, 1);
  assert.equal(hour, 0);
  assert.equal(minute, 0);
});

test("isoWeekKey: 주가 바뀌면 키도 바뀐다 (KST 기준)", () => {
  // 일요일 23:59 KST vs 월요일 00:01 KST
  const sunLateKst = new Date("2026-08-09T14:59:00Z"); // 08-09 23:59 KST
  const monEarlyKst = new Date("2026-08-09T15:01:00Z"); // 08-10 00:01 KST
  assert.notEqual(isoWeekKey(sunLateKst), isoWeekKey(monEarlyKst));
});

test("vercel.json 크론: Hobby 하루 1회 제한을 지키고, 매 슬롯 이후에 두드린다", async () => {
  const { crons } = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const cron = crons.find((c) => c.path === "/api/cron/blog-publish");
  assert.ok(cron, "blog-publish 크론이 vercel.json에 없다");
  // Hobby 플랜은 하루 1회 초과 크론이면 배포 자체가 거부된다 — 분·시가 단일 값이어야 한다
  const [minute, hour, dom, month, dow] = cron.schedule.split(/\s+/);
  assert.match(minute, /^\d+$/, `분 필드가 단일 값이 아니다: ${minute}`);
  assert.match(hour, /^\d+$/, `시 필드가 단일 값이 아니다: ${hour}`);
  assert.equal(dom, "*");
  assert.equal(month, "*");
  assert.equal(dow, "*", "요일을 제한하면 하루 1회여도 슬롯 실패 시 따라잡을 틱이 없다");
  // 틱(KST)은 가장 늦은 슬롯(16:00 KST)보다 뒤여야 슬롯 당일에 발행된다
  const tickKstMinutes = ((Number(hour) + 9) % 24) * 60 + Number(minute);
  const lastSlotMinutes = WINDOW_START_HOUR_KST * 60 + Math.max(...SLOT_MINUTE_OFFSETS);
  assert.ok(
    tickKstMinutes > lastSlotMinutes,
    `크론 틱(${tickKstMinutes}분 KST)이 마지막 슬롯(${lastSlotMinutes}분 KST) 이전이다`
  );
});

test("발행 라우트: created_at 은 틱 시각이 아니라 슬롯 시각으로 기록한다", async () => {
  const src = await readFile(
    new URL("../src/app/api/cron/blog-publish/route.ts", import.meta.url),
    "utf8"
  );
  assert.ok(
    src.includes("created_at: slot.toISOString()"),
    "created_at 이 슬롯 시각이 아니다 — 매일 같은 틱 시각으로 발행되면 발행 시각 랜덤 정책이 깨진다"
  );
  assert.ok(src.includes("auto_published_at: nowIso"), "주 1회 가드용 auto_published_at 은 실제 시각이어야 한다");
});
