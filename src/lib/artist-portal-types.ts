/**
 * 아티스트 포털 화면 타입 — 클라이언트/서버 공용.
 * (DB 접근은 server-only 인 src/lib/artist-portal.ts)
 *
 * 여기 정의된 뷰 모델이 곧 "아티스트에게 보여도 되는 것"의 정의다.
 * 그래서 아래 두 가지는 **타입에 아예 없다** — 실수로 렌더링될 여지를 없앤다:
 *   · 고객 개인정보 (이름·이메일·전화)
 *   · 원청 매출(clientAmount)과 마진
 * 서버에서 이 타입으로 한 번 좁힌 뒤에만 클라이언트로 넘긴다.
 */

import type { QuoteFile } from "./quote-types";
import type { DesignLine } from "./quote-pricing";
import type {
  ArtistPayout,
  AssignmentStatus,
  Deliverable,
  OfferStatus,
} from "./assignment-types";

/** 아티스트에게 공개하는 의뢰 내용 — 고객 신원을 뺀 작업 브리프 */
export interface WorkBrief {
  /** 제품 코드 (quote-labels 의 PRODUCT_LABELS 로 표시) */
  product: string;
  quantity: string;
  /** 고객 희망 납품일 */
  deliveryDate: string;
  purpose: string;
  customDesign: string;
  styleType: string;
  productText: string;
  colorRequest: string;
  notes: string;
  packaging: string;
  sampling: boolean;
  rushed: boolean;
  /** 참고 자료 (다중 첨부 + 레거시 단일 첨부를 합친 것) */
  files: QuoteFile[];
  /** 제작 희망 디자인 — 몇 종을 몇 부씩 만드는지. 옛 문의는 빈 배열 */
  designs: DesignLine[];
  /** 회사 로고 (있으면) */
  logoFileName: string;
  logoFileUrl: string;
  /** 문의 접수일 */
  createdAt: string;
}

/** 포털의 업무 카드 한 장 */
export interface ArtistWork {
  /** assignments.id — 모든 액션의 키 */
  id: string;
  offerStatus: OfferStatus;
  offeredAt: string | null;
  respondedAt: string | null;
  declineReason: string;
  status: AssignmentStatus;
  progress: number;
  dueDate: string | null;
  startedAt: string | null;
  /** 관리자가 남긴 업무 메모 (전달 사항) */
  memo: string;
  deliverables: Deliverable[];
  /** 내 작업비 정산 — 매출·마진은 포함하지 않는다 */
  payout: ArtistPayout;
  brief: WorkBrief;
}

/** 대시보드 상단 요약 */
export interface ArtistSummary {
  /** 응답 대기 중인 제안 수 */
  pendingOffers: number;
  /** 진행 중(수락·미완료) 업무 수 */
  active: number;
  /** 완료한 업무 수 */
  done: number;
  /** 아직 못 받은 작업비 합계 (세전) */
  unpaidTotal: number;
  /** 지급 완료된 작업비 합계 (세전) */
  paidTotal: number;
}

/**
 * 업무 목록 → 요약. 거절한 건은 어느 집계에도 넣지 않는다 —
 * 내가 안 하기로 한 일의 금액이 정산에 잡히면 혼란만 준다.
 */
export function summarize(works: ArtistWork[]): ArtistSummary {
  let pendingOffers = 0;
  let active = 0;
  let done = 0;
  let unpaidTotal = 0;
  let paidTotal = 0;

  for (const w of works) {
    if (w.offerStatus === "offered") {
      pendingOffers++;
      continue;
    }
    if (w.offerStatus !== "accepted") continue; // declined / draft 는 집계 제외

    if (w.status === "done") done++;
    else if (w.status !== "cancelled") active++;

    // 취소된 업무의 작업비는 정산 대상이 아니다
    if (w.status !== "cancelled") {
      unpaidTotal += w.payout.unpaid;
      paidTotal += w.payout.paid;
    }
  }

  return { pendingOffers, active, done, unpaidTotal, paidTotal };
}

/** 대시보드 탭 — 목록을 성격별로 나눈다 */
export function partitionWorks(works: ArtistWork[]): {
  offers: ArtistWork[];
  active: ArtistWork[];
  done: ArtistWork[];
  declined: ArtistWork[];
} {
  return {
    offers: works.filter((w) => w.offerStatus === "offered"),
    active: works.filter(
      (w) => w.offerStatus === "accepted" && w.status !== "done" && w.status !== "cancelled"
    ),
    done: works.filter((w) => w.offerStatus === "accepted" && w.status === "done"),
    declined: works.filter((w) => w.offerStatus === "declined" || w.status === "cancelled"),
  };
}
