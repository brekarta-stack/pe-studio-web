/**
 * 제작 문의 개략 견적 — 클라이언트/서버 공용 순수 로직.
 *
 * 폼에서 디자인 라인을 추가할 때마다 대략적인 금액 범위를 보여주기 위한 계산.
 * 확정 견적이 아니라 **범위 안내**다. 실제 금액은 구조 난이도·용지·후가공에
 * 따라 달라지므로 회신으로 안내한다.
 *
 * 단가 기준:
 *   · 디자인비 — 디자인 1종당 50만 ~ 700만원
 *   · 생산비   — 1개당 1,000 ~ 15,000원
 *   · 포장비   — 1개당 벌크 0원 / OPP 500원 / 종이박스 1,500원 (범위 아님, 고정)
 */

/** 디자인 1종당 디자인 비용 (원) */
export const DESIGN_COST_MIN = 500_000;
export const DESIGN_COST_MAX = 7_000_000;

/** 1개당 생산 비용 (원) */
export const UNIT_COST_MIN = 1_000;
export const UNIT_COST_MAX = 15_000;

/** 포장 방식별 1개당 추가 비용 (원) */
export const PACKAGING_UNIT_COST: Record<string, number> = {
  bulk: 0,
  opp: 500,
  "paper-box": 1_500,
};

/** 수량 입력 단위 — 1,000부 단위로 받는다 */
export const QUANTITY_STEP = 1_000;

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
  /** 생산 종류 수 = 디자인 라인 수 */
  designCount: number;
  /** 총 생산 수량 = 라인별 수량 합계 */
  totalQuantity: number;
  designMin: number;
  designMax: number;
  productionMin: number;
  productionMax: number;
  /** 포장비 (범위 없음) */
  packagingCost: number;
  totalMin: number;
  totalMax: number;
  /** 수량이 하나도 입력되지 않아 생산비를 셀 수 없는 상태 */
  quantityMissing: boolean;
}

/** 수량 문자열 → 개수. 숫자가 아니거나 음수면 0 */
export function parseQuantity(v: string): number {
  const n = Number(String(v).replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 디자인 라인 + 포장 방식 → 개략 견적.
 *
 * 라인이 없으면 전부 0 — 폼에서는 이때 견적 카드를 감춘다.
 * (0원 범위를 보여주면 "무료"로 읽힐 수 있다)
 */
export function estimateQuote(lines: DesignLine[], packaging: string): QuoteEstimate {
  const designCount = lines.length;
  const totalQuantity = lines.reduce((sum, l) => sum + parseQuantity(l.quantity), 0);
  const packUnit = PACKAGING_UNIT_COST[packaging] ?? 0;

  const designMin = designCount * DESIGN_COST_MIN;
  const designMax = designCount * DESIGN_COST_MAX;
  const productionMin = totalQuantity * UNIT_COST_MIN;
  const productionMax = totalQuantity * UNIT_COST_MAX;
  const packagingCost = totalQuantity * packUnit;

  return {
    designCount,
    totalQuantity,
    designMin,
    designMax,
    productionMin,
    productionMax,
    packagingCost,
    totalMin: designMin + productionMin + packagingCost,
    totalMax: designMax + productionMax + packagingCost,
    quantityMissing: designCount > 0 && totalQuantity === 0,
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
