import Link from "next/link";
import { redirect } from "next/navigation";
import { getArtistSession } from "@/lib/session";
import { listArtistWorks } from "@/lib/artist-portal";
import { summarize } from "@/lib/artist-portal-types";
import {
  FEE_TAX_SHORT,
  PAYOUT_STATUS_COLORS,
  PAYOUT_STATUS_LABELS,
  formatWon,
} from "@/lib/assignment-types";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";

export const dynamic = "force-dynamic";

/**
 * 정산 내역 — 수락한 업무의 작업비만 모아 본다.
 *
 * 여기 나오는 금액은 전부 내 작업비다. 원청 매출과 마진은 ArtistWork 타입에
 * 애초에 없으므로(src/lib/artist-portal-types.ts) 이 화면에서 셀 수 없다.
 */
export default async function ArtistSettlementsPage() {
  const artist = await getArtistSession();
  if (!artist) redirect("/admin/works");

  const works = await listArtistWorks(artist.artistId);
  // 정산 대상 = 수락했고 취소되지 않은 업무
  const rows = works.filter((w) => w.offerStatus === "accepted" && w.status !== "cancelled");
  const summary = summarize(works);

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900">정산 내역</h1>
      <p className="mt-0.5 text-sm text-slate-500">
        수락한 업무의 작업비 지급 현황입니다. 모든 금액은 세전(공급가액) 기준입니다.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-semibold text-amber-700">받을 작업비</p>
          <p className="mt-1 text-2xl font-bold text-amber-900">
            {formatWon(summary.unpaidTotal)}원
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-[11px] font-semibold text-emerald-700">지급 완료</p>
          <p className="mt-1 text-2xl font-bold text-emerald-900">
            {formatWon(summary.paidTotal)}원
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">아직 정산할 업무가 없습니다.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-bold text-slate-400">
                <th className="px-4 py-3">업무</th>
                <th className="px-4 py-3 text-right">작업비</th>
                <th className="px-4 py-3 text-right">실지급액</th>
                <th className="px-4 py-3">선금</th>
                <th className="px-4 py-3">잔금</th>
                <th className="px-4 py-3">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/artist/works/${w.id}`}
                      className="font-semibold text-slate-800 underline decoration-slate-200 hover:decoration-slate-400"
                    >
                      {label(PRODUCT_LABELS, w.brief.product) || "제작 의뢰"}
                    </Link>
                    <p className="text-[11px] text-slate-400">
                      {w.brief.createdAt ? w.brief.createdAt.slice(0, 10) : ""}
                      {w.dueDate && ` · 납기 ${w.dueDate}`}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">
                    {w.payout.fee == null ? "—" : formatWon(w.payout.fee)}
                    {w.payout.feeTaxMode !== "none" && (
                      <span className="ml-1 text-[11px] text-slate-400">
                        {FEE_TAX_SHORT[w.payout.feeTaxMode]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {w.payout.net == null ? "—" : formatWon(w.payout.net)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {w.payout.deposit ? formatWon(w.payout.deposit) : "—"}
                    <p className="text-[11px] text-slate-400">
                      {w.payout.depositPaidAt ?? (w.payout.deposit ? "미지급" : "")}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {w.payout.balance == null ? "—" : formatWon(w.payout.balance)}
                    <p className="text-[11px] text-slate-400">
                      {w.payout.balancePaidAt ?? "미지급"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        PAYOUT_STATUS_COLORS[w.payout.payoutStatus]
                      }`}
                    >
                      {PAYOUT_STATUS_LABELS[w.payout.payoutStatus]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-400">
        지급일은 관리자가 실제 송금 시점에 기록합니다. 금액이 다르게 보이면 담당자에게
        문의해 주세요.
      </p>
    </div>
  );
}
