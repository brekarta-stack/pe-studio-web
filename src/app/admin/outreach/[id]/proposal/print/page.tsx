import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdminSession } from "@/lib/session";
import { isUuid } from "@/lib/estimate-types";
import { getProposalDoc } from "@/lib/proposal-docs";
import { fontStylesheetUrls } from "@/lib/proposal-book/fonts";
import { listTbd } from "@/lib/proposal-book/markup";
import BookPages from "@/components/proposal-book/BookPages";
import HideSiteChrome from "@/components/proposal-book/HideSiteChrome";
import PrintTrigger from "./PrintTrigger";

export const dynamic = "force-dynamic";

/**
 * 제안서 인쇄 화면 — 브라우저의 "PDF로 저장"으로 발송본을 만든다.
 *
 * 관리자 껍데기(사이드바)는 AdminShell 이 이 경로에서 그리지 않는다. 사이트 공용 머리말·꼬리말은
 * 루트 레이아웃이 모든 화면에 그리므로 여기서만 숨긴다(이 화면이 사라지면 같이 사라지는 인라인 style).
 * 빈칸([확인 필요])이 남아 있으면 쪽마다 "초안 — 발송 불가" 띠가 함께 찍힌다.
 */
export default async function ProposalPrintPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminSession())) redirect("/admin/login");

  const { id } = await params;
  if (!isUuid(id)) notFound();

  let result: Awaited<ReturnType<typeof getProposalDoc>>;
  try {
    result = await getProposalDoc(id);
  } catch (e) {
    return (
      <Notice id={id} title="제안서를 불러오지 못했습니다.">
        {e instanceof Error ? e.message : String(e)}
      </Notice>
    );
  }

  if (result.tableMissing) {
    return (
      <Notice id={id} title="제안서 표가 아직 없습니다.">
        DB 셋업에서 제안서(proposal_docs) 마이그레이션을 먼저 실행해 주세요.{" "}
        <Link href="/admin/setup" className="font-semibold underline">DB 셋업으로 →</Link>
      </Notice>
    );
  }

  const doc = result.doc;
  if (!doc) {
    return (
      <Notice id={id} title="아직 저장된 제안서가 없습니다.">
        편집기에서 초안을 만든 뒤 인쇄할 수 있습니다.
      </Notice>
    );
  }

  // 숨긴 쪽의 빈칸은 지면에 실리지 않으므로 세지 않는다
  const hidden = new Set(doc.pages.filter((p) => p.hidden).map((p) => p.id));
  const tbd = listTbd(doc.content).filter((h) => !h.page || !hidden.has(h.page)).length;

  return (
    <>
      <HideSiteChrome />
      {fontStylesheetUrls(doc.style).map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="proposal-fonts" />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3 print:hidden">
        <div className="flex items-center gap-4">
          <Link href={`/admin/outreach/${id}/proposal`} className="text-sm text-slate-500 hover:text-slate-800">
            ← 편집기로
          </Link>
          <p className="text-sm font-bold text-slate-900">{doc.content.org} 제안서</p>
          {tbd > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
              빈칸 {tbd}곳 — 초안으로 찍힙니다
            </span>
          )}
        </div>
        <PrintTrigger />
      </div>
      <BookPages content={doc.content} style={doc.style} pages={doc.pages} mode="print" draftBanner={tbd > 0} />
    </>
  );
}

function Notice({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl p-6 md:p-8">
      {/* 안내 화면도 정상 화면과 같은 껍데기 — 사이드바가 없는 경로라 머리말만 남으면 엉뚱해 보인다 */}
      <HideSiteChrome />
      <Link href="/admin/outreach" className="text-sm text-slate-500 hover:text-slate-800">← 제안 영업</Link>
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <p className="font-bold text-amber-800">{title}</p>
        <p className="mt-1 text-sm text-amber-700">{children}</p>
        <Link
          href={`/admin/outreach/${id}/proposal`}
          className="mt-4 inline-block rounded-xl px-4 py-2.5 text-sm font-bold text-white"
          style={{ background: "#1E22B2" }}
        >
          제안서 편집기 열기
        </Link>
      </div>
    </div>
  );
}
