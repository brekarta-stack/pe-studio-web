import ApplyForm from "@/components/artist/ApplyForm";

export const dynamic = "force-dynamic";

export default function ArtistApplyPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold text-slate-900">아티스트 가입 신청</h1>
        <p className="mt-1 text-sm text-slate-500">
          신청 후 관리자가 확인·승인하면 포털에 로그인할 수 있습니다.
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <ApplyForm />
      </div>
    </div>
  );
}
