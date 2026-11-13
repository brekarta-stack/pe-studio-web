import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getArtistSession } from "@/lib/session";
import { getOpenJob } from "@/lib/job-board";
import { formatWon } from "@/lib/assignment-types";
import { PRODUCT_LABELS, label } from "@/lib/quote-labels";
import BriefPanels from "@/components/artist/BriefPanels";
import ClaimJobButton from "@/components/artist/ClaimJobButton";

export const dynamic = "force-dynamic";

/**
 * 공고 상세 — 공고 중일 때만 열린다. 누가 가져갔거나 내려간 공고는 404:
 * 가져간 뒤에는 다른 작업자에게 내용이 공개되지 않아야 한다.
 */
export default async function ArtistJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const artist = await getArtistSession();
  if (!artist) redirect("/admin/jobs");

  const { id } = await params;
  const job = await getOpenJob(id);
  if (!job) notFound();

  return (
    <div>
      <Link href="/artist/jobs" className="inline-block text-sm text-slate-400 transition-colors hover:text-slate-600">
        ← 작업 공고
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-slate-900">
        {label(PRODUCT_LABELS, job.brief.product) || "제작 의뢰"}
      </h1>
      <p className="mt-0.5 text-sm text-slate-500">접수 {job.brief.createdAt ? job.brief.createdAt.slice(0, 10) : "—"}</p>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <BriefPanels brief={job.brief} />
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-2 text-sm font-bold text-slate-700">작업 조건</h2>
            <dl className="text-sm">
              <div className="flex items-baseline justify-between border-b border-slate-100 py-2.5">
                <dt className="text-slate-500">작업비 (세전)</dt>
                <dd className="font-bold text-slate-900">{formatWon(job.artistFee)}원</dd>
              </div>
              <div className="flex items-baseline justify-between py-2.5">
                <dt className="text-slate-500">마감일</dt>
                <dd className="font-bold text-slate-900">{job.dueDate}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[11px] text-slate-400">
              마감까지 기간의 50%·25%·10%가 남으면 메일로 알려 드립니다.
            </p>
          </div>

          {job.memo && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
              <h2 className="mb-2 text-sm font-bold text-blue-800">전달 사항</h2>
              <p className="whitespace-pre-wrap text-sm text-blue-900">{job.memo}</p>
            </div>
          )}

          <ClaimJobButton postingId={job.id} />
        </div>
      </div>
    </div>
  );
}
