import Link from "next/link";
import HideSiteChrome from "@/components/proposal-book/HideSiteChrome";

/**
 * 제안서 편집기·인쇄 화면의 404 — 리드 번호가 틀렸거나 리드가 지워졌을 때(notFound()).
 * 이 경로는 사이드바가 없으므로 머리말·꼬리말도 숨기고 보드로 돌아가는 길만 남긴다.
 */
export default function ProposalNotFound() {
  return (
    <>
      <HideSiteChrome />
      <div className="mx-auto max-w-3xl p-6 md:p-8">
        <Link href="/admin/outreach" className="text-sm text-slate-500 hover:text-slate-800">
          ← 제안 영업
        </Link>
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-bold text-amber-800">리드를 찾지 못했습니다</p>
          <p className="mt-1 text-sm text-amber-700">주소가 틀렸거나 리드가 지워졌습니다. 제안 영업 보드에서 다시 열어 주세요.</p>
        </div>
      </div>
    </>
  );
}
