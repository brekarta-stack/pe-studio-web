/**
 * IP 단위 요청 한도 (인스턴스 메모리 기준).
 *
 * 제작 문의(/quote)에서 뽑아낸 모듈이다. 원래는 라우트 안에 숨어 있어서
 * 테스트가 불가능했고, 그 사이 이런 사고가 났다 —
 *
 *   "요청 5회/분" 한도가 **실패한 시도까지** 셌다. 입력이 서버 검증에 걸려 400 이
 *   나면 고객은 이유를 모른 채 다시 누르는데, 그 재시도가 한도를 채워 그다음부터는
 *   429 로 바뀌었다. 고칠 수 없는 오류가 된 것이다.
 *
 * 그래서 세는 축을 둘로 나눈다.
 *   · accepted — 실제로 접수된 건수. 중복 제출을 막는다.
 *   · total    — 총 요청. 남용을 막는다. 고객사 사무실은 공용 IP(NAT)라
 *                여러 담당자가 한 IP 로 잡히므로 넉넉해야 한다.
 *
 * 서버리스 인스턴스마다 별도 맵이라 정확한 전역 한도는 아니다. 목적이
 * "실수·남용 완화"지 "정밀 과금"이 아니므로 이 정도로 충분하다.
 */

export interface RateWindow {
  /** 이 창에서 받은 총 요청 수 */
  total: number;
  /** 이 창에서 실제로 접수된 건수 */
  accepted: number;
  /** 창이 끝나는 시각 (ms) */
  reset: number;
}

export interface RateLimiterOptions {
  /** 창당 접수 성공 상한 */
  acceptLimit: number;
  /** 창당 총 요청 상한 */
  totalLimit: number;
  /** 창 길이 (ms) */
  windowMs: number;
  /** 이 개수를 넘으면 만료 항목을 청소한다 */
  maxEntries?: number;
}

export interface RateLimiter {
  /** 요청을 받아도 되는가. 호출할 때마다 총 요청 수가 1 올라간다 */
  allow(ip: string, now?: number): boolean;
  /** 접수 성공을 기록한다 — 실패한 시도는 한도를 깎지 않는다 */
  recordAccepted(ip: string, now?: number): void;
  /** 현재 창 상태 (테스트·진단용) */
  peek(ip: string, now?: number): RateWindow | null;
  /** 보관 중인 IP 수 (테스트·진단용) */
  size(): number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { acceptLimit, totalLimit, windowMs, maxEntries = 5_000 } = opts;
  const windows = new Map<string, RateWindow>();

  /** 살아 있는 창을 돌려주고, 만료됐으면 새로 연다 */
  function currentWindow(ip: string, now: number): RateWindow {
    const cur = windows.get(ip);
    if (cur && now <= cur.reset) return cur;

    /* 인스턴스가 오래 살아 있으면(Fluid Compute) 이 맵만 계속 커진다 — 새 창을 열 때 청소한다 */
    if (windows.size >= maxEntries) {
      for (const [k, v] of windows) if (now > v.reset) windows.delete(k);
    }
    const fresh: RateWindow = { total: 0, accepted: 0, reset: now + windowMs };
    windows.set(ip, fresh);
    return fresh;
  }

  return {
    allow(ip, now = Date.now()) {
      const w = currentWindow(ip, now);
      w.total++;
      return w.total <= totalLimit && w.accepted < acceptLimit;
    },
    recordAccepted(ip, now = Date.now()) {
      currentWindow(ip, now).accepted++;
    },
    peek(ip, now = Date.now()) {
      const w = windows.get(ip);
      return w && now <= w.reset ? { ...w } : null;
    },
    size: () => windows.size,
  };
}
