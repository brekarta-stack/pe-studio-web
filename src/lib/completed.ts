/**
 * 완료 프로젝트(/admin/completed) 집계 — 순수 함수 (클라이언트/서버 공용, DB 접근 없음).
 *
 * 매출·수금·지급은 리드(quotes)가 아니라 배정(assignments) 단위로 저장된다
 * (한 리드에 아티스트가 여럿일 수 있다 — docs/sales-pipeline-plan.md §7).
 * 완료 화면은 리드 한 줄에 그 합을 보여 줘야 하므로 여기서 묶는다.
 */

import { derivePayoutStatus } from "./assignment-types.ts";
import type { AssignmentView } from "./assignment-types.ts";

export interface QuoteBilling {
  /** 매출 공급가 합 (취소 제외) */
  revenue: number;
  /** 담당 아티스트 이름 (취소 제외, 중복 제거, 배정 순서) */
  artistNames: string[];
  /** 금액이 있는 배정이 하나 이상이고 전부 수금됐는가 */
  received: boolean;
  /** 금액이 있는데 아직 수금일이 없는 배정 수 */
  receivableCount: number;
  /** 작업비가 있는 배정이 하나 이상이고 전부 지급 완료인가 */
  payoutDone: boolean;
}

/**
 * 한 리드의 배정들 → 매출·수금·지급 요약.
 * 취소된 배정은 매출로도, 미수로도 치지 않는다 — 월 정산(summarizeMonth)과 같은 규칙.
 * 금액이 하나도 없으면 received/payoutDone 은 false — "받을 게 없음"을 "다 받음"으로 보이면
 * 금액 입력을 빼먹은 건이 완료처럼 묻힌다.
 */
export function summarizeQuoteBilling(views: AssignmentView[]): QuoteBilling {
  const live = views.filter((v) => v.status !== "cancelled");

  let revenue = 0;
  for (const v of live) revenue += v.clientAmount ?? 0;

  const artistNames = [...new Set(live.map((v) => v.artistName).filter(Boolean))];

  const billable = live.filter((v) => v.clientAmount != null && v.clientAmount > 0);
  const receivableCount = billable.filter((v) => !v.clientPaidAt).length;

  const payable = live.filter((v) => v.artistFee != null && v.artistFee > 0);

  return {
    revenue,
    artistNames,
    received: billable.length > 0 && receivableCount === 0,
    receivableCount,
    payoutDone: payable.length > 0 && payable.every((v) => derivePayoutStatus(v) === "paid"),
  };
}

/**
 * 완료일 — 완료 단계에 들어온 시각. 마이그레이션 전이거나 기록이 없는 옛 건은
 * 마지막 단계 변경 시각, 그것도 없으면 접수일로 대신한다.
 */
export function completedAtOf(q: {
  closedAt: string | null;
  stageChangedAt: string | null;
  createdAt: string;
}): string {
  return q.closedAt ?? q.stageChangedAt ?? q.createdAt;
}
