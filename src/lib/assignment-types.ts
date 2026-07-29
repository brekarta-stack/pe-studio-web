/**
 * 업무 배정 타입 정의 — 클라이언트/서버 공용.
 * (DB 접근 함수는 server-only 인 src/lib/assignments.ts 에 있음)
 *
 * 배정 = "이 리드(제작 문의)를 이 아티스트가 맡는다" 는 한 줄.
 * 작업비·청구금액·진행률·납기·지급상태가 모두 이 단위로 붙는다.
 */

/** 리드 진행 단계 — quotes.stage
 *  (보류·취소(on_hold)는 제거 — 제외는 Drop 기능으로 처리한다) */
export const QUOTE_STAGES = [
  "new",
  "consulting",
  "quoted",
  "contracted",
  "producing",
  "delivered",
  "settled",
] as const;

export type QuoteStage = (typeof QUOTE_STAGES)[number];

export const STAGE_LABELS: Record<QuoteStage, string> = {
  new:        "신규 접수",
  consulting: "상담중",
  quoted:     "견적 발송",
  contracted: "계약 확정",
  producing:  "제작중",
  delivered:  "납품완료",
  settled:    "정산완료",
};

/** 단계별 배지 색 (Tailwind 클래스 — 어드민 팔레트에 맞춘 pastel) */
export const STAGE_COLORS: Record<QuoteStage, string> = {
  new:        "bg-blue-50 text-blue-700 border-blue-200",
  consulting: "bg-sky-50 text-sky-700 border-sky-200",
  quoted:     "bg-violet-50 text-violet-700 border-violet-200",
  contracted: "bg-indigo-50 text-indigo-700 border-indigo-200",
  producing:  "bg-amber-50 text-amber-700 border-amber-200",
  delivered:  "bg-teal-50 text-teal-700 border-teal-200",
  settled:    "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function isQuoteStage(v: unknown): v is QuoteStage {
  return typeof v === "string" && (QUOTE_STAGES as readonly string[]).includes(v);
}

/** 배정 작업 상태 — assignments.status */
export const ASSIGNMENT_STATUSES = ["assigned", "working", "review", "done", "cancelled"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  assigned:  "배정됨",
  working:   "작업중",
  review:    "검수",
  done:      "완료",
  cancelled: "취소",
};

export const ASSIGNMENT_STATUS_COLORS: Record<AssignmentStatus, string> = {
  assigned:  "bg-blue-50 text-blue-700 border-blue-200",
  working:   "bg-amber-50 text-amber-700 border-amber-200",
  review:    "bg-violet-50 text-violet-700 border-violet-200",
  done:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

export function isAssignmentStatus(v: unknown): v is AssignmentStatus {
  return typeof v === "string" && (ASSIGNMENT_STATUSES as readonly string[]).includes(v);
}

/** 작업비 지급 상태 — assignments.payout_status */
export const PAYOUT_STATUSES = ["unpaid", "partial", "paid"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  unpaid:  "미지급",
  partial: "부분지급",
  paid:    "지급완료",
};

export const PAYOUT_STATUS_COLORS: Record<PayoutStatus, string> = {
  unpaid:  "bg-red-50 text-red-600 border-red-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  paid:    "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function isPayoutStatus(v: unknown): v is PayoutStatus {
  return typeof v === "string" && (PAYOUT_STATUSES as readonly string[]).includes(v);
}

/* ── 업무 제안 (아티스트 포털) ────────────────────────────────
 * 배정을 만들었다고 곧바로 일이 시작되는 게 아니다. 관리자가 작업비·납기까지
 * 정한 뒤 "제안"을 보내면 아티스트가 포털에서 수락/거절한다.
 *   draft    관리자가 조건을 다듬는 중 — 아티스트에게 아직 안 보임
 *   offered  제안 발송 — 아티스트 응답 대기
 *   accepted 수락 — 이제부터 실제 작업
 *   declined 거절 — 이 배정은 무효, 다른 아티스트에게 재배정한다
 *
 * 마이그레이션 20260802 이전의 배정은 전부 accepted 로 이행된다
 * (이미 합의하고 진행 중인 건이므로). */
export const OFFER_STATUSES = ["draft", "offered", "accepted", "declined"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  draft:    "미제안",
  offered:  "응답 대기",
  accepted: "수락됨",
  declined: "거절됨",
};

export const OFFER_STATUS_COLORS: Record<OfferStatus, string> = {
  draft:    "bg-slate-100 text-slate-500 border-slate-200",
  offered:  "bg-amber-50 text-amber-700 border-amber-200",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  declined: "bg-red-50 text-red-600 border-red-200",
};

export function isOfferStatus(v: unknown): v is OfferStatus {
  return typeof v === "string" && (OFFER_STATUSES as readonly string[]).includes(v);
}

/** 아티스트에게 이 배정이 보여야 하는가 — draft 는 관리자만 본다 */
export function isVisibleToArtist(offerStatus: OfferStatus): boolean {
  return offerStatus !== "draft";
}

/** 아티스트가 지금 수락/거절할 수 있는가 — 응답 대기일 때만 */
export function canRespondToOffer(offerStatus: OfferStatus): boolean {
  return offerStatus === "offered";
}

/**
 * 아티스트가 작업 내용(진행률·상태·결과물)을 만질 수 있는가.
 * 수락한 건만 — 아직 응답 안 했거나 거절한 일을 진행할 수는 없다.
 */
export function canArtistWorkOn(a: Pick<Assignment, "offerStatus" | "status">): boolean {
  return a.offerStatus === "accepted" && a.status !== "cancelled";
}

/** 아티스트가 올린 결과물 파일 한 건 */
export interface Deliverable {
  name: string;
  url: string;
  /** 업로드 시각 (ISO) */
  uploadedAt: string;
}

export interface Assignment {
  id: string;
  /** 대상 리드 (quotes.id) */
  quoteId: string;
  /** 담당 아티스트 (artists.id) */
  artistId: string;
  status: AssignmentStatus;
  /** 0~100 */
  progress: number;
  /** 아티스트에게 줄 작업비(하청 원가) — **세전**. 미입력이면 null */
  artistFee: number | null;
  /** 내 매출 — **부가세 별도**. 미입력이면 null */
  clientAmount: number | null;
  /** 작업비 세금 처리 — 사업자(vat) / 프리랜서(withholding) / 없음 */
  feeTaxMode: FeeTaxMode;
  /** 매출에 부가세 10%를 더해 청구하는지 (켠 경우에만 계산) */
  clientVat: boolean;
  /** 선금 (세전). null/0 이면 선금 없이 잔금 일괄 지급 */
  depositAmount: number | null;
  /** 선금 지급일 (YYYY-MM-DD). null 이면 미지급 */
  depositPaidAt: string | null;
  /** 잔금 지급일 (YYYY-MM-DD). null 이면 미지급 */
  balancePaidAt: string | null;
  payoutStatus: PayoutStatus;
  /** 지급 완료 시각 (ISO) */
  paidAt: string | null;
  /** 납품 기한 (YYYY-MM-DD) */
  dueDate: string | null;
  /** 작업 착수일 (YYYY-MM-DD) */
  startedAt: string | null;
  memo: string;
  /** 제안 상태 — 아티스트 포털의 수락/거절 (마이그레이션 20260802) */
  offerStatus: OfferStatus;
  /** 제안 발송 시각 (ISO) */
  offeredAt: string | null;
  /** 아티스트가 수락/거절한 시각 (ISO) */
  respondedAt: string | null;
  /** 거절 사유 — 아티스트가 남긴 한 줄 */
  declineReason: string;
  /** 아티스트가 올린 결과물 */
  deliverables: Deliverable[];
  createdAt: string;
  updatedAt: string;
}

/** 생성/수정 입력 — id 는 서버가 생성 */
export type AssignmentInput = Omit<Assignment, "id" | "createdAt" | "updatedAt">;

/** 배정 + 리드/아티스트 표시 정보를 합친 화면용 뷰 모델 */
export interface AssignmentView extends Assignment {
  artistName: string;
  /** 고객명 (quotes.name) */
  quoteName: string;
  /** 제품 코드 (quotes.product) */
  quoteProduct: string;
  /** 리드 접수일 */
  quoteCreatedAt: string;
  quoteStage: QuoteStage;
}

/** 마진 = 매출 − 작업비 (둘 다 공급가액 기준). 둘 중 하나라도 없으면 null */
export function margin(a: Pick<Assignment, "artistFee" | "clientAmount">): number | null {
  if (a.clientAmount == null || a.artistFee == null) return null;
  return a.clientAmount - a.artistFee;
}

/* ── 세금 ────────────────────────────────────────────────────
 * 저장되는 금액(artistFee·clientAmount·depositAmount)은 전부 **세전 기준**이고,
 * 세액은 아래 함수로 그때그때 계산한다. 세액을 저장해 두면 세율이 바뀌었을 때
 * 과거 데이터가 어긋나므로 파생값으로만 다룬다.
 *
 * 세금은 **켠 경우에만** 계산한다(기본 없음):
 *   · 매출  — clientVat 를 켜면 고객에게 부가세 10% 를 더해 청구한다.
 *   · 작업비 — 아티스트에 따라 다르다.
 *       vat         : 사업자 → 작업비 + 부가세 10% 를 지급 (세금계산서 수취)
 *       withholding : 프리랜서 → 작업비 − 원천징수 3.3% 를 지급 (문재호 등)
 *       none        : 세금 처리 없이 액면 그대로 지급 */

/** 부가가치세율 (10%) */
export const VAT_RATE = 0.1;

/** 프리랜서 원천징수율 (3.3% = 소득세 3% + 지방소득세 0.3%) */
export const WITHHOLDING_RATE = 0.033;

/** 공급가액 → 부가세. 원 미만은 절사(세금계산서 관행) */
export function vatOf(supply: number | null | undefined): number | null {
  if (supply == null) return null;
  return Math.floor(supply * VAT_RATE);
}

/** 공급가액 → 합계(공급가액 + 부가세) */
export function withVat(supply: number | null | undefined): number | null {
  if (supply == null) return null;
  return supply + (vatOf(supply) ?? 0);
}

/** 작업비 세금 처리 방식 — 아티스트의 사업자 형태에 따라 고른다 */
export const FEE_TAX_MODES = ["none", "vat", "withholding"] as const;
export type FeeTaxMode = (typeof FEE_TAX_MODES)[number];

export const FEE_TAX_LABELS: Record<FeeTaxMode, string> = {
  none:        "세금 없음",
  vat:         "부가세 +10%",
  withholding: "원천징수 −3.3%",
};

/** 표에서 쓰는 짧은 라벨 */
export const FEE_TAX_SHORT: Record<FeeTaxMode, string> = {
  none:        "세금 없음",
  vat:         "+VAT",
  withholding: "−3.3%",
};

export function isFeeTaxMode(v: unknown): v is FeeTaxMode {
  return typeof v === "string" && (FEE_TAX_MODES as readonly string[]).includes(v);
}

/** 원천징수액 (원 미만 절사) */
export function withholdingOf(amount: number | null | undefined): number | null {
  if (amount == null) return null;
  return Math.floor(amount * WITHHOLDING_RATE);
}

/**
 * 세전 작업비 → 실제로 계좌에 넣어 줄 금액.
 *   vat         : +부가세   (아티스트가 세금계산서를 발행)
 *   withholding : −원천징수 (내가 3.3% 를 떼어 대신 납부)
 */
export function feeNetOf(amount: number | null | undefined, mode: FeeTaxMode): number | null {
  if (amount == null) return null;
  if (mode === "vat") return amount + (vatOf(amount) ?? 0);
  if (mode === "withholding") return amount - (withholdingOf(amount) ?? 0);
  return amount;
}

/** 실지급액과 세전 금액의 차이 (가산은 +, 공제는 −). 세금 없음이면 0 */
export function feeTaxAmountOf(amount: number | null | undefined, mode: FeeTaxMode): number {
  if (amount == null) return 0;
  if (mode === "vat") return vatOf(amount) ?? 0;
  if (mode === "withholding") return -(withholdingOf(amount) ?? 0);
  return 0;
}

/* ── 선금 / 잔금 ─────────────────────────────────────────────
 * 작업비(원가)를 선금·잔금 2회로 나눠 지급한다. 잔금은 저장하지 않고
 * 작업비 − 선금으로 계산한다 — 두 값을 따로 저장하면 합이 어긋날 수 있다. */

/** 잔금 = 작업비 − 선금. 작업비 미입력이면 null (음수는 0으로 막는다) */
export function balanceOf(a: Pick<Assignment, "artistFee" | "depositAmount">): number | null {
  if (a.artistFee == null) return null;
  return Math.max(0, a.artistFee - (a.depositAmount ?? 0));
}

type PayoutParts = Pick<
  Assignment,
  "artistFee" | "depositAmount" | "depositPaidAt" | "balancePaidAt"
>;

/** 실제로 지급 완료된 작업비 합계 (공급가액) */
export function paidFee(a: PayoutParts): number {
  const deposit = Math.min(a.depositAmount ?? 0, a.artistFee ?? 0);
  const balance = balanceOf(a) ?? 0;
  return (
    (deposit > 0 && a.depositPaidAt ? deposit : 0) +
    (balance > 0 && a.balancePaidAt ? balance : 0)
  );
}

/** 아직 지급하지 않은 작업비 (공급가액) */
export function unpaidFee(a: PayoutParts): number {
  return Math.max(0, (a.artistFee ?? 0) - paidFee(a));
}

/**
 * 선금·잔금 지급 여부로부터 지급 상태를 도출한다.
 * (payout_status 컬럼은 이 값을 저장해 두는 캐시 — 판단의 근거는 항상 선금/잔금)
 */
export function derivePayoutStatus(a: PayoutParts): PayoutStatus {
  const total = a.artistFee ?? 0;
  if (total <= 0) return "unpaid"; // 작업비 미입력
  const paid = paidFee(a);
  if (paid >= total) return "paid";
  return paid > 0 ? "partial" : "unpaid";
}

/**
 * 납기까지 남은 일수. 오늘 기준, 음수면 초과.
 * dueDate 가 없으면 null.
 *
 * 로컬 타임존의 자정끼리 비교한다 — Date 차이를 그대로 나누면
 * 시:분:초 때문에 D-day 가 하루씩 어긋난다.
 */
export function daysUntil(dueDate: string | null, today = new Date()): number | null {
  if (!dueDate) return null;
  const [y, m, d] = dueDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const due = new Date(y, m - 1, d);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - base.getTime()) / 86_400_000);
}

/** 납기 임박(D-7 이내)·초과 여부 — 완료/취소 건은 경고하지 않는다 */
export function dueUrgency(
  a: Pick<Assignment, "dueDate" | "status">,
  today = new Date()
): "none" | "soon" | "overdue" {
  if (a.status === "done" || a.status === "cancelled") return "none";
  const d = daysUntil(a.dueDate, today);
  if (d == null) return "none";
  if (d < 0) return "overdue";
  if (d <= 7) return "soon";
  return "none";
}

/** 진행중으로 간주하는 배정 상태 (부하 집계 기준) */
export function isActive(a: Pick<Assignment, "status">): boolean {
  return a.status === "assigned" || a.status === "working" || a.status === "review";
}

/**
 * 아티스트 포털에 보여줄 정산 요약.
 *
 * 이 함수를 통해서만 아티스트 화면에 금액을 내보낸다 — 매출(clientAmount)과
 * 마진은 여기서 애초에 뽑지 않으므로, 실수로 렌더링에 끼어들 여지가 없다.
 * (하청 구조에서 원청 매출은 공개하지 않는 게 기본)
 */
export interface ArtistPayout {
  /** 세전 작업비 */
  fee: number | null;
  feeTaxMode: FeeTaxMode;
  /** 세금 가감 (부가세는 +, 원천징수는 −) */
  taxAmount: number;
  /** 실제로 계좌에 들어오는 금액 */
  net: number | null;
  deposit: number | null;
  depositPaidAt: string | null;
  balance: number | null;
  balancePaidAt: string | null;
  /** 지급 완료된 금액 (세전) */
  paid: number;
  /** 아직 못 받은 금액 (세전) */
  unpaid: number;
  payoutStatus: PayoutStatus;
}

export function artistPayout(
  a: Pick<
    Assignment,
    "artistFee" | "feeTaxMode" | "depositAmount" | "depositPaidAt" | "balancePaidAt"
  >
): ArtistPayout {
  return {
    fee: a.artistFee,
    feeTaxMode: a.feeTaxMode,
    taxAmount: feeTaxAmountOf(a.artistFee, a.feeTaxMode),
    net: feeNetOf(a.artistFee, a.feeTaxMode),
    deposit: a.depositAmount,
    depositPaidAt: a.depositPaidAt,
    balance: balanceOf(a),
    balancePaidAt: a.balancePaidAt,
    paid: paidFee(a),
    unpaid: unpaidFee(a),
    payoutStatus: derivePayoutStatus(a),
  };
}

/** 원 단위 금액 표시 — 1234567 → "1,234,567" */
export function formatWon(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("ko-KR");
}
