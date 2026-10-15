import { getServerSession } from "next-auth";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { quoteFromRow } from "@/lib/quote-types";
import { isUuid } from "@/lib/estimate-types";
import { getProposalDoc } from "@/lib/proposal-docs";
import { ALL_FONTS, fontStylesheetUrls } from "@/lib/proposal-book/fonts";
import { DEFAULT_STYLE } from "@/lib/proposal-book/schema";
import ProposalEditor from "@/components/proposal-book/ProposalEditor";

export const dynamic = "force-dynamic";

/**
 * 제안서 편집기 — 리드 하나의 편집 디자인 10쪽 원고를 칸 안에서 고친다 (docs/proposal-editor-plan.md §4).
 * 저장된 문서가 없으면 편집기가 열리자마자 AI 초안을 요청한다.
 *
 * 서체는 고를 수 있는 Google 서체를 전부 한 주소로 미리 받는다 — 서체 목록에서 고르는 즉시
 * 지면에 보여야 해서다(고른 뒤에 받으면 한동안 시스템 서체로 보인다). 인쇄 화면은 쓰는 것만 받는다.
 */
export default async function ProposalEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { data: row, error: leadError } = await supabaseAdmin.from("quotes").select("*").eq("id", id).maybeSingle();
  if (leadError) {
    return (
      <Notice title="리드를 불러오지 못했습니다.">
        {(leadError as { message?: string }).message ?? String(leadError)}
      </Notice>
    );
  }
  if (!row) notFound();
  const lead = quoteFromRow(row);

  let result: Awaited<ReturnType<typeof getProposalDoc>>;
  try {
    result = await getProposalDoc(id);
  } catch (e) {
    return <Notice title="제안서를 불러오지 못했습니다.">{e instanceof Error ? e.message : String(e)}</Notice>;
  }
  if (result.tableMissing) {
    return (
      <Notice title="제안서 문서 표가 아직 없습니다">
        DB 셋업에서 제안서(proposal_docs) 마이그레이션을 먼저 실행해 주세요.{" "}
        <Link href="/admin/setup" className="font-semibold underline">
          DB 셋업으로 →
        </Link>
      </Notice>
    );
  }
  const doc = result.doc;

  const allFonts = fontStylesheetUrls({
    ...DEFAULT_STYLE,
    overrides: Object.fromEntries(ALL_FONTS.map((f) => [f.id, { font: f.id }])),
  });

  return (
    <>
      {/* 사이트 공용 머리말·꼬리말은 루트 레이아웃이 그린다 — 편집기는 화면 전체를 쓴다 */}
      <style>{`body > header, body > footer { display: none !important; }`}</style>
      {allFonts.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="proposal-fonts" />
      ))}
      <ProposalEditor lead={{ id: lead.id, org: lead.org || lead.name || "" }} initialDoc={doc} />
    </>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl p-6 md:p-8">
      <Link href="/admin/outreach" className="text-sm text-slate-500 hover:text-slate-800">
        ← 제안 영업
      </Link>
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <p className="font-bold text-amber-800">{title}</p>
        <p className="mt-1 text-sm text-amber-700">{children}</p>
      </div>
    </div>
  );
}
