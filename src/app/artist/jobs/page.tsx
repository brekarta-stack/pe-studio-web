import Link from "next/link";
import { redirect } from "next/navigation";
import { getArtistSession } from "@/lib/session";
import { listOpenJobs } from "@/lib/job-board";
import { daysUntil, formatWon } from "@/lib/assignment-types";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";
import { kstDateKey } from "@/lib/kst";

export const dynamic = "force-dynamic";

/** 마감까지 남은 날 — 한국 달력 기준 (서버는 UTC) */
function dDay(due: string): string {
  const [y, m, d] = kstDateKey().split("-").map(Number);
  const n = daysUntil(due, new Date(y, m - 1, d));
  if (n == null) return "";
  return n === 0 ? "D-day" : n > 0 ? `D-${n}` : `D+${-n}`;
}

/** 작업 공고 목록 — 공고 중인 건만. 누가 가져가면 여기서 사라진다 */
export default async function ArtistJobsPage() {
  const artist = await getArtistSession();
  if (!artist) redirect("/admin/jobs");

  const jobs = await listOpenJobs();

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">작업 공고</h1>
      <p className="mt-0.5 text-sm text-slate-500">
        먼저 가져간 분이 맡습니다. 가져간 작업은 내 업무에서 이어서 진행합니다.
      </p>

      {jobs.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <p className="font-bold text-slate-800">지금 올라온 공고가 없습니다</p>
          <p className="mt-1 text-sm text-slate-500">새 공고가 올라오면 메일로 알려 드립니다.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link
                href={`/artist/jobs/${j.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-[#1E22B2]/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">
                      {label(PRODUCT_LABELS, j.brief.product) || "제작 의뢰"}
                      {j.brief.quantity && <span className="font-normal text-slate-500"> · {j.brief.quantity}</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      마감 {j.dueDate} <span className="font-semibold text-amber-700">{dDay(j.dueDate)}</span>
                    </p>
                  </div>
                  <p className="text-right">
                    <span className="block text-[11px] text-slate-400">작업비 (세전)</span>
                    <b className="text-lg text-slate-900">{formatWon(j.artistFee)}원</b>
                  </p>
                </div>
                {j.memo && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{j.memo}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
