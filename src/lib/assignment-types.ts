/**
 * 업무 배정 타입 정의 — 클라이언트/서버 공용.
 * (DB 접근 함수는 server-only 인 src/lib/assignments.ts 에 있음)
 *
 * 배정 = "이 리드(제작 문의)를 이 아티스트가 맡는다" 는 한 줄.
 * 작업비·청구금액·진행률·납기·지급상태가 모두 이 단위로 붙는다.
 */

/** 리드 진행 단계 — quotes.stage */
export const QUOTE_STAGES = [
  "new",
  "consulting",
  "quoted",
  "contracted",
  "producing",
  "delivered",
  "settled",
  "on_hold",
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
  on_hold:    "보류·취소",
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
  on_hold:    "bg-slate-100 text-slate-500 border-slate-200",
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

export interface Assignment {
  id: string;
  /** 대상 리드 (quotes.id) */
  quoteId: string;
  /** 담당 아티스트 (artists.id) */
  artistId: string;
  status: AssignmentStatus;
  /** 0~100 */
  progress: number;
  /** 아티스트 작업비 (원). 미입력이면 null */
  artistFee: number | null;
  /** 고객 청구금액 (원). 미입력이면 null */
  clientAmount: number | null;
  payoutStatus: PayoutStatus;
  /** 지급 완료 시각 (ISO) */
  paidAt: string | null;
  /** 납품 기한 (YYYY-MM-DD) */
  dueDate: string | null;
  /** 작업 착수일 (YYYY-MM-DD) */
  startedAt: string | null;
  memo: string;
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

/** 마진 = 청구금액 − 작업비. 둘 중 하나라도 없으면 null */
export function margin(a: Pick<Assignment, "artistFee" | "clientAmount">): number | null {
  if (a.clientAmount == null || a.artistFee == null) return null;
  return a.clientAmount - a.artistFee;
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

/** 원 단위 금액 표시 — 1234567 → "1,234,567" */
export function formatWon(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("ko-KR");
}
