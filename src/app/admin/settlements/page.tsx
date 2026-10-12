import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { listAssignmentViews } from "@/lib/assignments";
import {
  availableMonths,
  formatMonthLabel,
  monthKeyOf,
  payoutMonthsOf,
  receivedMonthOf,
} from "@/lib/settlement";
import SettlementBoard from "@/components/admin/SettlementBoard";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** YYYY-MM, 월은 01~12 만 — 그 밖의 값은 이번 달로 돌린다 */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 컬럼 없음 신호 — 마이그레이션 20261013 전에는 assignments.client_paid_at 이 없다 */
function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

export default async function AdminSettlementsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  const sp = await searchParams;
  const raw = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  // 로컬 기준 이번 달 — 대시보드 "이번 달 매출"과 같은 방식
  const thisMonth = new Date().toLocaleDateString("en-CA").slice(0, 7);
  const month = raw && MONTH_RE.test(raw) ? raw : thisMonth;

  // 배정 전체 + 수금일 컬럼 존재 확인을 병렬로 (테이블이 없으면 listAssignmentViews 는 빈 배열)
  const [all, probe] = await Promise.all([
    listAssignmentViews(),
    supabaseAdmin.from("assignments").select("client_paid_at").limit(1),
  ]);
  const needsMigration = isMissingColumn(probe.error);

  const live = all.filter((a) => a.status !== "cancelled");
  // 이 달에 귀속된 배정 (납기 → 생성일 기준)
  const rows = live.filter((a) => monthKeyOf(a) === month);
  // 귀속 달은 다르지만 이 달에 돈이 오간 배정 — 수금·지급 타일 숫자의 근거를 함께 보여 준다
  const otherRows = live.filter(
    (a) =>
      monthKeyOf(a) !== month &&
      (receivedMonthOf(a) === month || payoutMonthsOf(a).includes(month))
  );

  // 주소로 직접 들어온 달은 데이터가 없어도 선택지에 넣는다 — 안 그러면 셀렉트가 엉뚱한 달을 보여 준다
  const months = availableMonths(all);
  if (!months.includes(month)) months.push(month);
  months.sort().reverse();

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">월 정산</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {formatMonthLabel(month)}의 매출·작업비·수금·지급을 봅니다. 날짜를 넣으면 바로 저장됩니다.
        </p>
      </div>

      {needsMigration && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          수금일 컬럼이 아직 없습니다. 수금일을 기록하려면 마이그레이션을 먼저 적용하세요.{" "}
          <Link href="/admin/setup" className="font-semibold underline">DB 셋업으로 이동 →</Link>
        </div>
      )}

      <SettlementBoard
        key={month}
        month={month}
        months={months}
        rows={rows}
        otherRows={otherRows}
        canEditReceipt={!needsMigration}
      />
    </div>
  );
}
