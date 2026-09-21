import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdminSession } from "@/lib/session";
import { EVENT_LABELS, getEstimate, listEstimateEvents, type Estimate } from "@/lib/estimates";
import { getConnection, getFileMeta } from "@/lib/google-drive";
import {
  CATEGORY_FOLDERS,
  CATEGORY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  completedSteps,
  defaultEmailDraft,
  formatAmount,
  formatKstDateTime,
  isUuid,
  SEND_STUCK_MS,
} from "@/lib/estimate-types";
import EstimateActions from "@/components/admin/EstimateActions";
import EstimatePreview from "@/components/admin/EstimatePreview";

export const dynamic = "force-dynamic";
// 이 화면의 서버 액션(확인·발송)은 구글·메일 호출을 여러 번 한다. 함수는 이 시간에 강제로 끝나므로
// 늦게 풀린 요청이 "발송 중 멈춤" 정리(3분 뒤) 이후에 메일을 보내는 일은 없다. Hobby 요금제 상한과 같다.
export const maxDuration = 60;

const STEPS = ["생성", "확인", "발송"] as const;

export default async function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [events, connection, sheetVersion] = await Promise.all([
    listEstimateEvents({ estimateId: id, limit: 50 }),
    getConnection().catch(() => null),
    // 확인 대기일 때만 — 확인 버튼이 "지금 본 판본"을 서버에 넘겨 대조한다
    e.status === "generated" && e.sheetId
      ? getFileMeta(e.sheetId).then((m) => (m && !m.trashed ? m.modifiedTime : null), () => null)
      : Promise.resolve(null),
  ]);

  const done = completedSteps(e.status);
  const draft = defaultEmailDraft(e);
  // 서버에서 한 번만 잰다 — 렌더 중에 시계를 읽으면 서버·클라이언트 값이 달라진다
  // eslint-disable-next-line react-hooks/purity
  const stuck = e.status === "sending" && Date.now() - new Date(e.updatedAt).getTime() > SEND_STUCK_MS;

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <Link href="/admin/estimates" className="text-sm text-slate-500 hover:text-slate-800">← 견적서 목록</Link>

      <div className="mt-2 mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{e.clientCompany}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_COLORS[e.status]}`}>{STATUS_LABELS[e.status]}</span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {e.docNumber} · {CATEGORY_LABELS[e.category]} (드라이브 견적서/{CATEGORY_FOLDERS[e.category]}) · 견적 일자 {e.issuedOn}
            {e.quoteId && (
              <>
                {" · "}
                <Link href="/admin/quotes" className="underline">제작 문의 연결됨</Link>
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">공급가액 (부가세 별도)</div>
          <div className="text-2xl font-bold tabular-nums text-slate-900">{formatAmount(e.supply)}원</div>
          <div className="text-xs tabular-nums text-slate-500">VAT 포함 {formatAmount(e.total)}원</div>
        </div>
      </div>

      {/* 진행 단계 */}
      <ol className="mb-6 grid grid-cols-3 gap-2">
        {STEPS.map((s, i) => {
          const complete = i < done;
          const current = i === done;
          return (
            <li
              key={s}
              className={`rounded-lg border px-3 py-2 text-sm font-bold ${
                complete
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : current
                    ? "border-slate-900 bg-white text-slate-900"
                    : "border-slate-200 bg-slate-50 text-slate-400"
              }`}
            >
              {complete ? "✓ " : `${i + 1}. `}
              {s}
            </li>
          );
        })}
      </ol>

      {e.lastError && e.status !== "sent" && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">최근 오류: {e.lastError}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="order-2 rounded-xl border border-slate-200 bg-white p-5 lg:order-1">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">앱에 저장된 내용</h2>
            <span className="text-xs text-slate-400">실제 발송본은 &lsquo;발송될 PDF 보기&rsquo;로 확인</span>
          </div>
          <EstimatePreview data={e} />
        </section>

        <aside className="order-1 space-y-6 lg:order-2">
          <EstimateActions
            id={e.id}
            status={e.status}
            docNumber={e.docNumber}
            clientCompany={e.clientCompany}
            hasSheet={!!e.sheetId}
            sheetUrl={e.sheetUrl}
            supply={e.supply}
            total={e.total}
            sentTo={e.sentTo}
            sentAt={e.sentAt}
            stuck={stuck}
            googleConnected={!!connection}
            sheetVersion={sheetVersion}
            draft={{ to: e.clientEmail, subject: draft.subject, body: draft.body }}
          />

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-bold text-slate-900">기록</h2>
            <ul className="space-y-2 text-sm">
              {events.length === 0 && <li className="text-slate-400">기록이 없습니다.</li>}
              {events.map((ev) => (
                <li key={ev.id}>
                  <div className="flex justify-between gap-2">
                    <b className="text-slate-700">{EVENT_LABELS[ev.action] ?? ev.action}</b>
                    <span className="tabular-nums text-xs text-slate-400">{formatKstDateTime(ev.createdAt)}</span>
                  </div>
                  <div className="text-xs text-slate-500">{ev.actor}</div>
                  {typeof ev.detail.error === "string" && <div className="text-xs text-red-500">{ev.detail.error}</div>}
                  {typeof ev.detail.reason === "string" && <div className="text-xs text-amber-600">{ev.detail.reason}</div>}
                  {Array.isArray(ev.detail.to) && <div className="break-all text-xs text-slate-500">→ {(ev.detail.to as string[]).join(", ")}</div>}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
