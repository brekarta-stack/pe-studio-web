import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weeklySlot,
  weekStartUtc,
  isoWeekKey,
  SLOT_DAYS,
  SLOT_MINUTE_OFFSETS,
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
