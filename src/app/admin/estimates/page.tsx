import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/session";
import { EVENT_LABELS, LIST_LIMIT, countByStatus, listEstimateEvents, listEstimates } from "@/lib/estimates";
import { getConnection, oauthRedirectUri } from "@/lib/google-drive";
import { getSealInfo } from "@/lib/estimate-assets";
import {
  CATEGORY_LABELS,
  ESTIMATE_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  ESTIMATE_CATEGORIES,
  formatAmount,
  formatKstDateTime,
  isEstimateCategory,
  isEstimateStatus,
  type EstimateCategory,
  type EstimateStatus,
} from "@/lib/estimate-types";
import GoogleDriveCard from "@/components/admin/GoogleDriveCard";

export const dynamic = "force-dynamic";
// 연결 해제(구글 권한 회수)·도장 등록 액션이 이 화면에서 돈다
export const maxDuration = 60;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * 주소로 넘어오는 결과는 코드만 받고 문구는 여기서 고른다 — 주소에 문구를 실으면
 * 누구나 관리 화면에 임의의 안내문을 띄우는 링크를 만들 수 있다.
 */
const NOTICES: Record<string, { tone: "ok" | "warn" | "error"; text: string }> = {
  "google:connected": { tone: "ok", text: "구글 드라이브를 연결했습니다." },
  "google:denied": { tone: "error", text: "구글 동의 화면에서 취소되었습니다. 다시 연결하려면 버튼을 눌러 주세요." },
  "google:state": { tone: "error", text: "연결 요청이 만료되었거나 올바르지 않습니다. 버튼을 다시 눌러 주세요." },
  "google:failed": { tone: "error", text: "구글 연결에 실패했습니다. 원인은 아래 '최근 기록'의 구글 연결 실패 항목에 있습니다." },
  "notice:trash_failed": { tone: "warn", text: "견적서는 삭제했지만 드라이브 시트를 휴지통으로 옮기지 못했습니다. 드라이브에서 직접 지워 주세요." },
};
const TONE_CLASS = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-red-200 bg-red-50 text-red-700",
} as const;

export default async function EstimatesPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await isAdminSession())) redirect("/admin/login");

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const rawStatus = one(sp.status);
  const status: EstimateStatus | "" = isEstimateStatus(rawStatus) ? rawStatus : "";
  const rawCategory = one(sp.category);
  const category: EstimateCategory | "" = isEstimateCategory(rawCategory) ? rawCategory : "";
  const q = one(sp.q).slice(0, 100);
  const notice = NOTICES[`google:${one(sp.google)}`] ?? NOTICES[`notice:${one(sp.notice)}`] ?? null;

  let redirectUri = "";
  try {
    redirectUri = oauthRedirectUri();
  } catch {
    redirectUri = "(NEXTAUTH_URL 미설정)";
  }

  const [list, connection, seal, events, counts] = await Promise.all([
    listEstimates({ status, category, q }),
    getConnection().catch(() => null),
    getSealInfo(),
    listEstimateEvents({ limit: 30 }),
    countByStatus(),
  ]);
  const totalCount = ESTIMATE_STATUSES.reduce((n, st) => n + counts[st], 0);

  const tab = (s: EstimateStatus | "") => {
    const p = new URLSearchParams();
    if (s) p.set("status", s);
    if (category) p.set("category", category);
    if (q) p.set("q", q);
    const qs = p.toString();
    return `/admin/estimates${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">견적서</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            생성 → 확인 → 발송. 만들면 구글 드라이브 견적서 폴더에 시트가 생기고, 확인한 뒤 PDF 로 메일 발송합니다.
          </p>
        </div>
        <Link href="/admin/estimates/new" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">
          + 새 견적서
        </Link>
      </div>

      {notice && <div className={`mb-4 rounded-xl border p-3 text-sm ${TONE_CLASS[notice.tone]}`}>{notice.text}</div>}

      <div className="mb-6">
        <GoogleDriveCard connection={connection} hasSeal={!!seal} redirectUri={redirectUri} />
      </div>

      {list.error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          DB 오류: {list.error}
          <span className="mt-1 block text-xs text-red-500">
            <code>estimates</code> 표가 없다면 <Link href="/admin/setup" className="underline">DB 셋업</Link>에서
            20260921_estimates.sql 을 적용하세요.
          </span>
        </div>
      )}

      {/* 상태 탭 + 검색 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1.5">
          <Link href={tab("")} className={`rounded-full px-3 py-1 text-xs font-bold ${!status ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            전체 {totalCount}
          </Link>
          {ESTIMATE_STATUSES.map((s) => (
            <Link key={s} href={tab(s)} className={`rounded-full px-3 py-1 text-xs font-bold ${status === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {STATUS_LABELS[s]} {counts[s]}
            </Link>
          ))}
        </nav>
        {/* GET 폼 — 조회 결과 주소를 그대로 공유할 수 있다 */}
        <form method="get" className="flex flex-wrap items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <select name="category" defaultValue={category} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
            <option value="">구분 전체</option>
            {ESTIMATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="고객사·문서번호·이메일"
            className="h-9 w-52 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
          />
          <button className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-700">검색</button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2.5">문서 번호</th>
              <th className="px-3 py-2.5">구분</th>
              <th className="px-3 py-2.5">고객사</th>
              <th className="px-3 py-2.5">견적 일자</th>
              <th className="px-3 py-2.5 text-right">공급가액</th>
              <th className="px-3 py-2.5">상태</th>
              <th className="px-3 py-2.5">발송</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">
                  {q || status || category ? "조건에 맞는 견적서가 없습니다." : "아직 만든 견적서가 없습니다. '+ 새 견적서'로 시작하세요."}
                </td>
              </tr>
            ) : (
              list.rows.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-bold">
                    <Link href={`/admin/estimates/${e.id}`} className="text-slate-900 hover:underline">{e.docNumber}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{CATEGORY_LABELS[e.category]}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/estimates/${e.id}`} className="hover:underline">{e.clientCompany}</Link>
                    {e.clientContact && <span className="text-slate-400"> · {e.clientContact}</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{e.issuedOn}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatAmount(e.supply)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_COLORS[e.status]}`}>{STATUS_LABELS[e.status]}</span>
                    {e.lastError && e.status !== "sent" && <span className="ml-1 text-xs text-red-500" title={e.lastError}>⚠</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{e.sentAt ? formatKstDateTime(e.sentAt) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {list.truncated && (
        <p className="mt-2 text-xs text-slate-500">상태별로 최근 {LIST_LIMIT}건까지만 보여 줍니다. 오래된 견적서는 검색으로 찾으세요.</p>
      )}

      {/* 감사 기록 — 삭제된 견적서의 기록도 여기서 본다 */}
      <details className="mt-8 rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-900">최근 기록 {events.length}건</summary>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {events.length === 0 && <li className="py-2 text-slate-400">기록이 없습니다.</li>}
          {events.map((ev) => (
            <li key={ev.id} className="flex flex-wrap gap-x-3 gap-y-0.5 py-2">
              <span className="w-32 shrink-0 tabular-nums text-xs text-slate-500">{formatKstDateTime(ev.createdAt)}</span>
              <span className="w-28 shrink-0 font-bold text-slate-700">{EVENT_LABELS[ev.action] ?? ev.action}</span>
              <span className="w-32 shrink-0 text-slate-600">
                {ev.estimateId && ev.action !== "deleted" ? (
                  <Link href={`/admin/estimates/${ev.estimateId}`} className="hover:underline">{ev.docNumber || "—"}</Link>
                ) : (
                  ev.docNumber || "—"
                )}
              </span>
              <span className="text-xs text-slate-500">{ev.actor}</span>
              {Object.keys(ev.detail).length > 0 && (
                <code className="basis-full break-all text-[11px] text-slate-400">{JSON.stringify(ev.detail)}</code>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
