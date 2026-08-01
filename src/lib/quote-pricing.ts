/**
 * 제작 문의 개략 견적 — 클라이언트/서버 공용 순수 로직.
 *
 * 확정 견적이 아니라 **범위 안내**다. 실제 금액은 구조 난이도·용지·후가공에
 * 따라 달라지므로 회신으로 안내한다.
 *
 * 금액 구조는 주문 형태(무엇을 받을 것인가)에 따라 통째로 달라진다.
 * 메인 캐릭터 및 디자인을 1종으로 계산한다:
 *
 *   도면만 의뢰  디자인비만 (100만~500만/종). 실물이 없으니 수량·포장 개념이 없다.
 *   제품 생산    도면 디자인비 + 생산비(종 수 기반 정액: 1종 400만,
 *                2종째 +250만, 3종째부터 +200만씩) + 포장비(수량×단가).
 *   완제품 의뢰  제작비 하나로 묶는다 (300만~/종). 조립·설치까지 포함이라
 *                수량으로 곱하지 않는다.
 */

/** 주문 형태 — 무엇을 받을 것인지 */
export const ORDER_TYPES = ["blueprint", "production", "finished"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export function isOrderType(v: unknown): v is OrderType {
  return typeof v === "string" && (ORDER_TYPES as readonly string[]).includes(v);
}

/* ── 생산비 (제품 생산일 때만) ──
 * 부수가 아니라 **종 수** 기반 정액이다. 첫 종이 라인 셋업까지 짊어져서
 * 가장 비싸고, 종이 늘수록 한 종당 부담이 줄어든다. */

/** 생산 1종째 비용 (원) */
export const PRODUCTION_FIRST_COST = 4_000_000;
/** 생산 2종째 추가 비용 (원) */
export const PRODUCTION_SECOND_COST = 2_500_000;
/** 생산 3종째부터 종당 추가 비용 (원) */
export const PRODUCTION_NEXT_COST = 2_000_000;

/** 종 수 → 생산비 정액. 1종 400만 / 2종 650만 / 3종 850만 / 이후 +200만씩 */
export function productionCost(designCount: number): number {
  if (designCount <= 0) return 0;
  let cost = PRODUCTION_FIRST_COST;
  if (designCount >= 2) cost += PRODUCTION_SECOND_COST;
  if (designCount >= 3) cost += (designCount - 2) * PRODUCTION_NEXT_COST;
  return cost;
}

/**
 * 포장 방식별 1개당 추가 비용 (원).
 *
 * 총액의 하한·상한 양쪽에 모두 더한다. 처음에는 상한에만 얹었는데,
 * 그러면 포장을 골라도 왼쪽 금액이 꿈쩍하지 않아 "계산이 안 된다"고 읽힌다.
 * 포장은 고르는 순간 확정되는 비용이므로 범위가 아니라 정액으로 다룬다.
 */
export const PACKAGING_UNIT_COST: Record<string, number> = {
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
    costMin: 1_000_000,
    costMax: 5_000_000,
    hasProduction: false,
    hasPackaging: false,
    hasQuantity: false,
    defaultQuantity: 0,
  },
  production: {
    label: "제품 생산",
    // 디자인비는 도면만 의뢰와 같은 도면 디자인 비용 — 생산비가 따로 붙는다
    desc: "디자인부터 인쇄·재단까지. 완성된 키트를 납품받습니다.",
    costLabel: "디자인비",
    costMin: 1_000_000,
    costMax: 5_000_000,
    hasProduction: true,
    hasPackaging: true,
    hasQuantity: true,
    defaultQuantity: 1_000,
  },
  finished: {
    label: "완제품 의뢰",
    desc: "조립·설치까지 마친 완성품을 받습니다. 전시·연출물에 적합합니다.",
    costLabel: "제작비",
    costMin: 3_000_000,
    costMax: 10_000_000,
    hasProduction: false,
    // 조립까지 끝난 완성품이라 키트 포장 개념이 없다 — 포장 선택지를 보여주지 않는다
    hasPackaging: false,
    hasQuantity: true,
    defaultQuantity: 1,
  },
};

/* ── 제작 옵션 (샘플링·디자인 개선·감리·별도 가공) ──
 * 고르는 순간 확정되는 정액 비용이라 포장비처럼 하한·상한 양쪽에 더한다.
 * 별도 가공(premiumFinish)은 소재·가공에 따라 편차가 커서 금액은 상담으로 —
 * 납기(+1주)에만 반영한다. */

export const SAMPLING_COST = 1_000_000;
export const SAMPLING_IMPROVE_COST = 2_000_000;
export const SUPERVISION_COST = 1_000_000;

export interface QuoteExtras {
  /** 샘플링 희망 — +100만원, +2주 */
  sampling?: boolean;
  /** 샘플링 후 디자인 개선 — +200만원, +2주 */
  samplingImprove?: boolean;
  /** 생산 감리 — +100만원, +1.5주 */
  supervision?: boolean;
  /** 별도 가공·고급 소재 — 금액은 상담, 납기 +1주 */
  premiumFinish?: boolean;
}

/** 주문 형태별 기본 납기 (주) — 도면만 2주, 생산·완제품 4주 */
export const BASE_LEAD_WEEKS: Record<OrderType, number> = {
  blueprint: 2,
  production: 4,
  finished: 4,
};

/** 포장 방식별 추가 납기 (주) */
export const PACKAGING_LEAD_WEEKS: Record<string, number> = {
  "paper-box": 2,
  opp: 1,
  bulk: 0,
};

/**
 * 선택 옵션 기준 평균 납기 (주). 소수(1.5주 등)가 나올 수 있다.
 * 포장 납기는 포장 선택지가 있는 주문 형태(제품 생산)에서만 더한다.
 */
export function estimateLeadWeeks(
  orderType: OrderType,
  packaging: string,
  extras: QuoteExtras = {}
): number {
  let weeks = BASE_LEAD_WEEKS[orderType];
  if (ORDER_TYPE_SPECS[orderType].hasPackaging) {
    weeks += PACKAGING_LEAD_WEEKS[packaging] ?? 0;
  }
  if (extras.sampling) weeks += 2;
  if (extras.samplingImprove) weeks += 2;
  if (extras.supervision) weeks += 1.5;
  if (extras.premiumFinish) weeks += 1;
  return weeks;
}

/** 납기 주 수 → "약 4주" / "약 5.5주" */
export function formatWeeks(weeks: number): string {
  return `약 ${Number.isInteger(weeks) ? weeks : weeks.toFixed(1)}주`;
}

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
  /** 포장비 = 총수량 × 개당 단가. 하한·상한 양쪽에 더해진다 */
  packagingCost: number;
  /** 개당 포장 단가 (원) — 화면에 근거로 함께 보여준다 */
  packagingUnitCost: number;
  /** 샘플링 정액 비용 (미선택 시 0) — 하한·상한 양쪽에 더해진다 */
  samplingCost: number;
  /** 샘플링 후 디자인 개선 정액 비용 (미선택 시 0) */
  samplingImproveCost: number;
  /** 생산 감리 정액 비용 (미선택 시 0) */
  supervisionCost: number;
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
  packaging: string,
  extras: QuoteExtras = {}
): QuoteEstimate {
  const spec = ORDER_TYPE_SPECS[orderType];
  const designCount = lines.length;
  const totalQuantity = spec.hasQuantity
    ? lines.reduce((sum, l) => sum + parseQuantity(l.quantity), 0)
    : 0;

  const designMin = designCount * spec.costMin;
  const designMax = designCount * spec.costMax;

  // 생산비는 종 수 기반 정액 — 하한·상한이 같다
  const production = spec.hasProduction ? productionCost(designCount) : 0;
  const productionMin = production;
  const productionMax = production;

  const packagingUnitCost = spec.hasPackaging ? PACKAGING_UNIT_COST[packaging] ?? 0 : 0;
  const packagingCost = totalQuantity * packagingUnitCost;

  const samplingCost = extras.sampling ? SAMPLING_COST : 0;
  const samplingImproveCost = extras.samplingImprove ? SAMPLING_IMPROVE_COST : 0;
  const supervisionCost = extras.supervision ? SUPERVISION_COST : 0;
  const optionsCost = samplingCost + samplingImproveCost + supervisionCost;

  return {
    orderType,
    costLabel: spec.costLabel,
    designCount,
    totalQuantity,
    designMin,
    designMax,
    productionMin,
    productionMax,
    packagingCost,
    packagingUnitCost,
    samplingCost,
    samplingImproveCost,
    supervisionCost,
    totalMin: designMin + productionMin + packagingCost + optionsCost,
    totalMax: designMax + productionMax + packagingCost + optionsCost,
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
  return `${formatKrw(min)} ~ ${formatKrw(max)}`;
}

/**
 * "100만원~" 형태의 시작 금액 문자열.
 *
 * 고객 화면에는 상한을 보여주지 않는다 — 상한(600만·1,500만원 등)이 먼저
 * 눈에 들어와 문의 자체를 접는 경우가 있어, 최소 금액만 안내하고
 * 정확한 금액은 상담으로 잇는다.
 */
export function formatFrom(min: number): string {
  return `${formatKrw(min)}~`;
}
