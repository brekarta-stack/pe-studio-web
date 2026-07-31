/**
 * 제작 문의 개략 견적 — 클라이언트/서버 공용 순수 로직.
 *
 * 확정 견적이 아니라 **범위 안내**다. 실제 금액은 구조 난이도·용지·후가공에
 * 따라 달라지므로 회신으로 안내한다.
 *
 * 금액 구조는 주문 형태(무엇을 받을 것인가)에 따라 통째로 달라진다:
 *
 *   도면만 의뢰  디자인비만. 실물이 없으니 수량·포장 개념이 없다.
 *   제품 생산    디자인비 + 생산비 + 포장비. 수량이 금액을 좌우한다.
 *   완제품 의뢰  제작비 하나로 묶는다. 조립·설치까지 포함이라 부수보다
 *                건별 난이도가 금액을 정한다 — 수량으로 곱하지 않는다.
 */

/** 주문 형태 — 무엇을 받을 것인지 */
export const ORDER_TYPES = ["blueprint", "production", "finished"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export function isOrderType(v: unknown): v is OrderType {
  return typeof v === "string" && (ORDER_TYPES as readonly string[]).includes(v);
}

/** 1개당 생산 비용 (원) — 제품 생산일 때만 */
export const UNIT_COST_MIN = 2_000;
export const UNIT_COST_MAX = 15_000;

/**
 * 포장 방식별 1개당 **최대** 추가 비용 (원).
 * 사양에 따라 0원까지 내려갈 수 있어 하한은 두지 않는다 — "~500원" 처럼 상한만 안내한다.
 */
export const PACKAGING_UNIT_MAX: Record<string, number> = {
  bulk: 0,
  opp: 500,
  "paper-box": 2_000,
};

/** 수량 입력 단위 — 1,000부 단위로 받는다 */
export const QUANTITY_STEP = 1_000;

interface OrderTypeSpec {
  label: string;
  desc: string;
  /** 견적에서 디자인 비용을 부르는 이름 — 완제품은 '제작비' */
  costLabel: string;
  /** 1종당 비용 (원) */
  costMin: number;
  costMax: number;
  /** 수량에 비례하는 생산비가 붙는가 */
  hasProduction: boolean;
  /** 포장 선택·비용이 의미 있는가 */
  hasPackaging: boolean;
  /** 수량을 입력받는가 — 도면만 의뢰는 실물이 없어 받지 않는다 */
  hasQuantity: boolean;
  /** 라인을 새로 추가할 때 채워 넣을 기본 수량 */
  defaultQuantity: number;
}

export const ORDER_TYPE_SPECS: Record<OrderType, OrderTypeSpec> = {
  blueprint: {
    label: "도면만 의뢰",
    desc: "전개도·설계 데이터만 받습니다. 생산은 직접 진행하시는 경우.",
    costLabel: "디자인비",
    costMin: 500_000,
    costMax: 6_000_000,
    hasProduction: false,
    hasPackaging: false,
    hasQuantity: false,
    defaultQuantity: 0,
  },
  production: {
    label: "제품 생산",
    desc: "디자인부터 인쇄·재단까지. 완성된 키트를 납품받습니다.",
    costLabel: "디자인비",
    costMin: 500_000,
    costMax: 6_000_000,
    hasProduction: true,
    hasPackaging: true,
    hasQuantity: true,
    defaultQuantity: 1_000,
  },
  finished: {
    label: "완제품 의뢰",
    desc: "조립·설치까지 마친 완성품을 받습니다. 전시·연출물에 적합합니다.",
    costLabel: "제작비",
    costMin: 500_000,
    costMax: 10_000_000,
    hasProduction: false,
    hasPackaging: true,
    hasQuantity: true,
    defaultQuantity: 1,
  },
};

/** 제작 희망 디자인 한 줄 */
export interface DesignLine {
  /** 라인 식별자 (React key + 파일 매칭용) */
  id: string;
  /** 무엇을 만들 것인지 — 예: "마스코트 캐릭터 A" */
  name: string;
  /** 이 디자인의 생산 수량 (개). 빈 문자열이면 미입력 */
  quantity: string;
  /** 이 디자인의 참고 자료 (선택) */
  file: { name: string; url: string } | null;
}

export interface QuoteEstimate {
  orderType: OrderType;
  /** 견적에서 1종당 비용을 부르는 이름 (디자인비 / 제작비) */
  costLabel: string;
  /** 생산 종류 수 = 디자인 라인 수 */
  designCount: number;
  /** 총 생산 수량 = 라인별 수량 합계 */
  totalQuantity: number;
  designMin: number;
  designMax: number;
  productionMin: number;
  productionMax: number;
  /** 포장비는 상한만 있다 (사양에 따라 0원까지) */
  packagingMax: number;
  totalMin: number;
  totalMax: number;
  /** 수량이 필요한 주문인데 하나도 입력되지 않은 상태 */
  quantityMissing: boolean;
}

/** 수량 문자열 → 개수. 숫자가 아니거나 음수면 0 */
export function parseQuantity(v: string): number {
  const n = Number(String(v).replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 주문 형태 + 디자인 라인 + 포장 → 개략 견적.
 *
 * 라인이 없으면 전부 0 — 폼에서는 이때 금액 대신 안내 문구를 보여준다.
 * (0원 범위를 그대로 보여주면 "무료"로 읽힌다)
 */
export function estimateQuote(
  orderType: OrderType,
  lines: DesignLine[],
  packaging: string
): QuoteEstimate {
  const spec = ORDER_TYPE_SPECS[orderType];
  const designCount = lines.length;
  const totalQuantity = spec.hasQuantity
    ? lines.reduce((sum, l) => sum + parseQuantity(l.quantity), 0)
    : 0;

  const designMin = designCount * spec.costMin;
  const designMax = designCount * spec.costMax;

  const productionMin = spec.hasProduction ? totalQuantity * UNIT_COST_MIN : 0;
  const productionMax = spec.hasProduction ? totalQuantity * UNIT_COST_MAX : 0;

  const packUnitMax = spec.hasPackaging ? PACKAGING_UNIT_MAX[packaging] ?? 0 : 0;
  const packagingMax = totalQuantity * packUnitMax;

  return {
    orderType,
    costLabel: spec.costLabel,
    designCount,
    totalQuantity,
    designMin,
    designMax,
    productionMin,
    productionMax,
    packagingMax,
    // 포장비는 하한이 0이라 최소 금액에는 더하지 않는다
    totalMin: designMin + productionMin,
    totalMax: designMax + productionMax + packagingMax,
    quantityMissing: spec.hasQuantity && designCount > 0 && totalQuantity === 0,
  };
}

/** 원 단위 금액 → 사람이 읽는 문자열. 1,000,000 → "100만원" */
export function formatKrw(n: number): string {
  if (n <= 0) return "0원";
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  const rest = n % 10_000;

  const parts: string[] = [];
  if (eok > 0) parts.push(`${eok.toLocaleString("ko-KR")}억`);
  if (man > 0) parts.push(`${man.toLocaleString("ko-KR")}만`);
  // 억·만 단위가 있으면 자잘한 끝자리는 생략해 읽기 쉽게 (개략 견적이라 무의미)
  if (parts.length === 0) return `${rest.toLocaleString("ko-KR")}원`;
  return `${parts.join(" ")}원`;
}

/** "100만원 ~ 1,500만원" 형태의 범위 문자열 */
export function formatRange(min: number, max: number): string {
  if (min === max) return formatKrw(min);
  // 하한이 0이면 "0원 ~"보다 "~ 상한"이 뜻을 정확히 전한다 (포장비처럼 안 들 수도 있는 항목)
  if (min <= 0) return `~ ${formatKrw(max)}`;
  return `${formatKrw(min)} ~ ${formatKrw(max)}`;
}
