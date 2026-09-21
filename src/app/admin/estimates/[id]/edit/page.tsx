import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdminSession } from "@/lib/session";
import { getEstimate, type Estimate } from "@/lib/estimates";
import { getConnection } from "@/lib/google-drive";
import { isEditable, isUuid } from "@/lib/estimate-types";
import EstimateForm from "@/components/admin/EstimateForm";

export const dynamic = "force-dynamic";
// 저장하면 서버 액션이 폴더 확인·파일 생성·시트 그리기까지 구글을 여러 번 부른다 (Hobby 상한)
export const maxDuration = 60;

export default async function EditEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminSession())) redirect("/admin/login");

  const { id } = await params;
  if (!isUuid(id)) notFound();
  let e: Estimate | null;
  try {
    e = await getEstimate(id);
  } catch (err) {
    return (
      <div className="mx-auto max-w-6xl p-6 md:p-8">
        <Link href="/admin/estimates" className="text-sm text-slate-500 hover:text-slate-800">← 견적서 목록</Link>
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {err instanceof Error ? err.message : String(err)}
        </div>
      </div>
    );
  }
  if (!e) notFound();
  const connection = await getConnection().catch(() => null);
  // 발송했거나 발송 중인 건은 고칠 수 없다 — 상세로 돌려보낸다
  if (!isEditable(e.status)) redirect(`/admin/estimates/${id}`);

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <Link href={`/admin/estimates/${id}`} className="text-sm text-slate-500 hover:text-slate-800">← 견적서로</Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold text-slate-900">견적서 수정 · {e.clientCompany}</h1>
      <EstimateForm
        mode="edit"
        estimateId={e.id}
        docNumber={e.docNumber}
        googleConnected={!!connection}
        initial={{
          category: e.category,
          clientCompany: e.clientCompany,
          clientContact: e.clientContact,
          clientEmail: e.clientEmail,
          issuedOn: e.issuedOn,
          deliveryTerm: e.deliveryTerm,
          deliveryPlace: e.deliveryPlace,
          paymentTerm: e.paymentTerm,
          items: e.items,
          quoteId: e.quoteId,
        }}
      />
    </div>
  );
}
