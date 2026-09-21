import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getConnection } from "@/lib/google-drive";
import { DEFAULT_TERMS, kstToday, templateItems } from "@/lib/estimate-types";
import EstimateForm, { type QuoteOption } from "@/components/admin/EstimateForm";

export const dynamic = "force-dynamic";
// 저장하면 서버 액션이 폴더 확인·파일 생성·시트 그리기까지 구글을 여러 번 부른다 (Hobby 상한)
export const maxDuration = 60;

export default async function NewEstimatePage() {
  if (!(await isAdminSession())) redirect("/admin/login");

  const [connection, quotesRes] = await Promise.all([
    getConnection().catch(() => null),
    // 최근 활성 제작 문의 — 견적서와 연결할 후보 (Drop 한 건 제외)
    supabaseAdmin
      .from("quotes")
      .select("id, name, email, created_at")
      .is("dropped_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const quotes: QuoteOption[] = (quotesRes.data ?? []).map((q) => ({
    id: q.id,
    name: q.name ?? "",
    email: q.email ?? "",
    label: `${q.name || "(이름 없음)"} · ${q.email || "이메일 없음"} · ${String(q.created_at).slice(0, 10)}`,
  }));

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <Link href="/admin/estimates" className="text-sm text-slate-500 hover:text-slate-800">← 견적서 목록</Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold text-slate-900">새 견적서</h1>
      <EstimateForm
        mode="create"
        googleConnected={!!connection}
        quotes={quotes}
        initial={{
          category: "papertoy",
          clientCompany: "",
          clientContact: "",
          clientEmail: "",
          issuedOn: kstToday(),
          ...DEFAULT_TERMS,
          items: templateItems("papertoy"),
          quoteId: null,
        }}
      />
    </div>
  );
}
