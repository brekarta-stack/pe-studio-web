/**
 * 월 정산 집계 — 순수 함수 (클라이언트/서버 공용, DB 접근 없음).
 * /admin/settlements 화면과 CSV 내려받기가 같은 계산을 쓰도록 여기로 모은다.
 *
 * 월 귀속 기준 (docs/sales-pipeline-plan.md §3.3, 화면에도 그대로 적는다):
 *   · 매출·작업비 = 납기(due_date)의 달, 납기가 없으면 배정 생성일의 달
 *     — 대시보드 "이번 달 매출"·/admin/works "이번 달 납기"와 같은 정의라 세 화면 숫자가 어긋나지 않는다.
 *   · 수금 = client_paid_at 의 달
 *   · 지급 = deposit_paid_at / balance_paid_at 의 달 (선금·잔금이 서로 다른 달일 수 있다)
 * 취소(cancelled) 배정은 모든 집계에서 뺀다. 금액은 전부 공급가액(세전)이고 세액은 파생값이다.
 */

import {
  ASSIGNMENT_STATUS_LABELS,
  balanceOf,
  feeTaxAmountOf,
  margin,
  unpaidFee,
  vatOf,
} from "./assignment-types.ts";
import type { AssignmentView } from "./assignment-types.ts";
import { kstDateOf, kstMonthKey } from "./kst.ts";

/**
 * 날짜/시각 문자열 → 한국 달력 YYYY-MM. 해석 불가면 null.
 * 날짜만 있는 값(DATE 컬럼)은 그대로 자르고(kstDateOf), 시각은 Asia/Seoul 로 환산한다 —
 * 서버(Vercel)가 UTC 라 로컬 계산이면 매월 1일 00~09시(KST) 건이 전달로 밀린다.
 */
function monthOfDate(v: string | null | undefined): string | null {
  const d = kstDateOf(v);
  return d ? d.slice(0, 7) : null;
}

function isLive(a: Pick<AssignmentView, "status">): boolean {
  return a.status !== "cancelled";
}

/**
 * 매출·작업비가 귀속되는 달 — 납기, 없으면 배정 생성일.
 * 생성일(TIMESTAMPTZ)은 한국 달력(KST) 기준으로 달을 정한다. 대시보드 "이번 달 매출"도
 * 같은 summarizeMonth 를 kstMonthKey 로 부르므로 두 화면이 어긋나지 않는다.
 */
export function monthKeyOf(a: Pick<AssignmentView, "dueDate" | "createdAt">): string {
  return monthOfDate(a.dueDate) ?? monthOfDate(a.createdAt) ?? "";
}

/** 수금된 달 — 미수면 null */
export function receivedMonthOf(a: Pick<AssignmentView, "clientPaidAt">): string | null {
  return monthOfDate(a.clientPaidAt);
}

/** 작업비를 지급한 달들 (선금·잔금 각각, 중복 제거) */
export function payoutMonthsOf(
  a: Pick<AssignmentView, "depositPaidAt" | "balancePaidAt">
): string[] {
  const months = [monthOfDate(a.depositPaidAt), monthOfDate(a.balancePaidAt)].filter(
    (m): m is string => m != null
  );
  return [...new Set(months)];
}

/**
 * 해당 달에 실제로 지급한 작업비 (공급가액).
 * paidFee() 를 그대로 쓰지 않는 이유: paidFee 는 선금+잔금 합이라, 선금은 9월·잔금은 10월에
 * 줬으면 두 달 모두에 전액이 잡힌다. 여기서는 paidFee 와 같은 선금/잔금 산식으로
 * **그 달에 지급된 몫만** 더한다.
 */
function paidInMonth(a: AssignmentView, month: string): number {
  const deposit = Math.min(a.depositAmount ?? 0, a.artistFee ?? 0);
  const balance = balanceOf(a) ?? 0;
  let sum = 0;
  if (deposit > 0 && monthOfDate(a.depositPaidAt) === month) sum += deposit;
  if (balance > 0 && monthOfDate(a.balancePaidAt) === month) sum += balance;
  return sum;
}

export interface MonthSummary {
  month: string;
  /** 이 달에 귀속된 배정 수 (취소 제외) */
  count: number;
  /** 매출 공급가 합 */
  revenue: number;
  /** 매출 부가세 합 — 부가세 청구(clientVat)를 켠 배정만 */
  revenueVat: number;
  /** 작업비 공급가 합 */
  cost: number;
  /** 작업비 세금 가감 합 (부가세 +, 원천징수 −) */
  costTax: number;
  /** 매출 − 작업비 (공급가 기준) */
  margin: number;
  /** 이 달에 들어온 돈 — 수금일 기준이라 귀속 달과 무관 */
  received: number;
  /** 이 달 귀속 매출 중 아직 못 받은 돈 */
  receivable: number;
  /** 이 달에 지급한 작업비 — 지급일 기준 */
  paidOut: number;
  /** 이 달 귀속 작업비 중 아직 안 준 돈 */
  unpaid: number;
}

export function summarizeMonth(all: AssignmentView[], month: string): MonthSummary {
  const live = all.filter(isLive);
  const inMonth = live.filter((a) => monthKeyOf(a) === month);

  let revenue = 0;
  let revenueVat = 0;
  let cost = 0;
  let costTax = 0;
  let receivable = 0;
  let unpaid = 0;
  for (const a of inMonth) {
    revenue += a.clientAmount ?? 0;
    if (a.clientVat) revenueVat += vatOf(a.clientAmount) ?? 0;
    cost += a.artistFee ?? 0;
    costTax += feeTaxAmountOf(a.artistFee, a.feeTaxMode);
    if (!a.clientPaidAt) receivable += a.clientAmount ?? 0;
    unpaid += unpaidFee(a);
  }

  let received = 0;
  let paidOut = 0;
  for (const a of live) {
    if (receivedMonthOf(a) === month) received += a.clientAmount ?? 0;
    paidOut += paidInMonth(a, month);
  }

  return {
    month,
    count: inMonth.length,
    revenue,
    revenueVat,
    cost,
    costTax,
    margin: revenue - cost,
    received,
    receivable,
    paidOut,
    unpaid,
  };
}

/** 오늘의 한국 달력 YYYY-MM */
function currentMonth(today: Date): string {
  return kstMonthKey(today);
}

/** 월 선택지 — 데이터가 있는 달 + 이번 달, 최신순. 이번 달은 배정이 없어도 고를 수 있어야 한다 */
export function availableMonths(all: AssignmentView[], today = new Date()): string[] {
  const set = new Set<string>([currentMonth(today)]);
  for (const a of all) {
    if (!isLive(a)) continue;
    const m = monthKeyOf(a);
    if (m) set.add(m);
  }
  return [...set].sort().reverse();
}

/** "2026-10" → "2026년 10월". 형식이 다르면 그대로 돌려준다 */
export function formatMonthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${m[1]}년 ${Number(m[2])}월`;
}

/* ── CSV ────────────────────────────────────────────────────
 * 운영자는 Windows 엑셀로 연다. BOM(U+FEFF)이 없으면 엑셀이 CP949 로 읽어 한글이 깨진다.
 * 줄바꿈은 CRLF (엑셀 기본). 금액은 숫자 그대로 — 쉼표를 넣으면 엑셀이 문자로 본다. */

const CSV_HEADER = [
  "고객", "제품", "아티스트", "납기", "매출(공급가)", "부가세", "작업비",
  "세금", "마진", "수금일", "선금일", "잔금일", "상태",
];

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  /* 엑셀 수식 주입 방지 — 고객명이 "=" 로 시작하면 엑셀이 수식으로 실행한다.
     숫자(음수 세금 포함)는 그대로 둔다 */
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 해당 달 귀속 배정(취소 제외)을 CSV 로 */
export function settlementCsv(rows: AssignmentView[], month: string): string {
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const a of rows) {
    if (!isLive(a) || monthKeyOf(a) !== month) continue;
    lines.push(
      [
        a.quoteName,
        a.quoteProduct,
        a.artistName,
        a.dueDate,
        a.clientAmount,
        a.clientVat ? vatOf(a.clientAmount) : null,
        a.artistFee,
        a.artistFee == null ? null : feeTaxAmountOf(a.artistFee, a.feeTaxMode),
        margin(a),
        a.clientPaidAt,
        a.depositPaidAt,
        a.balancePaidAt,
        ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
