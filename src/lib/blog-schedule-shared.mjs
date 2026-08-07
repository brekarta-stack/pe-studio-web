/**
 * 블로그 주간 자동 발행 슬롯 — 순수 로직 (TS 라우트·node --test 공용).
 *
 * 규칙: 주 1회, 화·수·목 중 랜덤 요일, 14:00~16:00 KST 사이 30분 단위 랜덤 시각.
 * ISO 주차 문자열을 시드로 쓰는 결정론적 난수라서
 * 같은 주에는 언제 계산해도 항상 같은 슬롯이 나온다 (크론 중복 실행에 안전).
 */

const KST_MS = 9 * 3600_000;

/** 발행 후보 요일 (KST, 월=1 … 일=7) — 화·수·목 */
export const SLOT_DAYS = [2, 3, 4];
/** 14:00 기준 분 오프셋 — 14:00 / 14:30 / 15:00 / 15:30 / 16:00 */
export const SLOT_MINUTE_OFFSETS = [0, 30, 60, 90, 120];
export const WINDOW_START_HOUR_KST = 14;

/** KST 벽시계 기준 자정으로 정규화된 UTC Date (시각 연산용 내부 헬퍼) */
function kstMidnight(date) {
  const kst = new Date(date.getTime() + KST_MS);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}

/** ISO 주차 키 — 예: "2026-W32" (KST 기준) */
export function isoWeekKey(date) {
  const d = kstMidnight(date);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // 그 주의 목요일로 이동 (ISO 규칙)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 문자열 → 32비트 해시 (xmur3 축약) — 주차 키를 난수 시드로 */
function hash32(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** 해당 ISO 주 월요일 00:00 KST 를 UTC Date 로 */
export function weekStartUtc(date) {
  const d = kstMidnight(date);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return new Date(d.getTime() - KST_MS);
}

/** 이번 주의 발행 슬롯 (UTC Date). 같은 주 입력이면 항상 동일한 값 */
export function weeklySlot(date) {
  const h = hash32(isoWeekKey(date));
  const day = SLOT_DAYS[h % SLOT_DAYS.length];
  const minutes = SLOT_MINUTE_OFFSETS[Math.floor(h / SLOT_DAYS.length) % SLOT_MINUTE_OFFSETS.length];
  const start = weekStartUtc(date); // 월 00:00 KST (UTC 표현)
  return new Date(
    start.getTime() +
      (day - 1) * 86_400_000 +
      WINDOW_START_HOUR_KST * 3600_000 +
      minutes * 60_000
  );
}
