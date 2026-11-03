/**
 * 한국 시간(Asia/Seoul) 달력 날짜 — 순수 헬퍼 (클라이언트/서버 공용).
 *
 * 왜 따로 두는가: 서버(Vercel)는 UTC 로 돈다. getFullYear()/getDate() 같은 로컬 계산은
 * 맥(KST)에서는 맞고 운영 서버에서는 오전 9시 전까지 하루(월초엔 한 달) 밀린다.
 * "오늘", "이번 달"은 운영자가 보는 한국 달력이어야 하므로 타임존을 명시해 계산한다.
 */

const KST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Date → 한국 달력 YYYY-MM-DD */
export function kstDateKey(d: Date = new Date()): string {
  return KST_DATE.format(d);
}

/** Date → 한국 달력 YYYY-MM */
export function kstMonthKey(d: Date = new Date()): string {
  return kstDateKey(d).slice(0, 7);
}

/**
 * 날짜/시각 문자열 → 한국 달력 YYYY-MM-DD. 해석 불가면 null.
 * 날짜만 있는 값("2026-10-05", DATE 컬럼)은 그대로 쓴다 — new Date("2026-10-05") 는
 * UTC 자정이라 타임존을 거치면 날짜가 밀릴 수 있다.
 */
export function kstDateOf(v: string | null | undefined): string | null {
  if (!v) return null;
  if (DATE_ONLY.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return kstDateKey(d);
}

/** YYYY-MM-DD 에 n일을 더한 YYYY-MM-DD — UTC 산술이라 서버 타임존과 무관하다 */
export function addDaysKey(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 두 YYYY-MM-DD 사이 일수 (b − a). 형식이 틀리면 null */
export function diffDaysKey(a: string, b: string): number | null {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  if (pa.length !== 3 || pb.length !== 3 || [...pa, ...pb].some((n) => !Number.isFinite(n) || !n)) return null;
  const ta = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const tb = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  return Math.round((tb - ta) / 86_400_000);
}
