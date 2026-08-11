import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { unstable_cache } from "next/cache";
import NoTrackToggle from "@/components/admin/NoTrackToggle";
import {
  summarize,
  resolvePeriod,
  sourceLabel,
  MEDIUM_META,
  formatDuration,
  type AnalyticsRow,
} from "@/lib/analytics";
import AnalyticsPeriodPicker from "@/components/admin/AnalyticsPeriodPicker";
import DailyTrendChart from "@/components/admin/DailyTrendChart";

export const dynamic = "force-dynamic";

/** 테이블이 아직 생성되지 않은 경우(PostgREST relation 없음) 감지 */
function isMissingTable(message: string, code?: string): boolean {
  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    code === "PGRST205" ||
    code === "42P01"
  );
}

/**
 * 기간 집계 결과를 캐싱 (Supabase 재쿼리 + JS 재집계 비용 제거).
 * - 키 = (fromISO, toISO, unit) → 같은 기간 재조회/재방문 시 즉시 응답.
 * - revalidate 60초: 분석 지표는 실시간일 필요가 없어 ≤60초 신선도 허용.
 * - 호출 측에서 현재시각을 1분 단위로 양자화하므로 '이번 달' 등 now-종료 구간도 키가 안정 → 캐시 적중.
 * - 에러는 throw (캐시에 저장되지 않음) → 일시 오류가 60초 고착되지 않음.
 * - select 는 집계에 쓰는 컬럼만 (id 등 미사용 컬럼 제외).
 */
const getCachedSummary = unstable_cache(
  async (fromISO: string, toISO: string, unit: "day" | "month") => {
    const { data, error } = await supabaseAdmin
      .from("analytics_events")
      .select(
        "type,path,referrer,source,medium,utm_source,utm_medium,utm_campaign,keyword,label,href,duration_ms,session_id,device,created_at",
      )
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .order("created_at", { ascending: false })
      .limit(50000);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const rows = (data ?? []) as AnalyticsRow[];
    return {
      summary: summarize(rows, { from: Date.parse(fromISO), to: Date.parse(toISO), unit }),
      rowCount: rows.length,
    };
  },
  ["analytics-summary-v1"],
  { revalidate: 60, tags: ["analytics"] },
);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // 현재 시각을 1분 단위로 양자화 → 같은 기간 재조회 시 캐시 적중률↑
  const nowMs = Math.floor(new Date().getTime() / 60000) * 60000;
  const period = resolvePeriod(
    { month: one(sp.month), from: one(sp.from), to: one(sp.to), preset: one(sp.preset) },
    nowMs,
  );

  const cached = await getCachedSummary(period.fromISO, period.toISO, period.unit).catch(
    (e: unknown) => ({ error: (e ?? {}) as { message?: string; code?: string } }),
  );

  /* ── 테이블 미생성 안내 ── */
  if ("error" in cached && isMissingTable(cached.error.message ?? "", cached.error.code)) {
    return (
      <div className="p-6 md:p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">유입·클릭 분석</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 mt-4">
          <p className="font-bold text-amber-800 mb-1">📊 분석 테이블을 먼저 생성해야 합니다</p>
          <p className="text-sm text-amber-700 mb-4">
            <code className="font-mono">analytics_events</code> 테이블이 아직 없습니다.
            <strong> DB 셋업</strong> 페이지의 SQL을 Supabase에서 한 번 실행하면
            방문 유입 경로와 클릭이 수집되기 시작합니다.
          </p>
          <Link
            href="/admin/setup"
            className="inline-block px-4 py-2.5 rounded-xl font-bold text-white text-sm"
            style={{ background: "#1E22B2" }}
          >
            DB 셋업으로 이동 →
          </Link>
        </div>
      </div>
    );
  }

  if ("error" in cached) {
    return (
      <div className="p-6 md:p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">유입·클릭 분석</h1>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 mt-4 text-sm text-red-700">
          데이터를 불러오지 못했습니다: {cached.error.message}
        </div>
      </div>
    );
  }

  const s = cached.summary;
  const rowCount = cached.rowCount;

  const maxDaily = Math.max(1, ...s.daily.map((d) => d.pageviews));
  /* 일별 추이 Y축 눈금 — 1·2·5×10ⁿ 라운드 간격으로 ~4개 기준선 */
  const dailyStep = (() => {
    const raw = maxDaily / 4;
    const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
    const m = [1, 2, 5, 10].find((k) => raw <= k * pow) ?? 10;
    return Math.max(1, m * pow);
  })();
  const dailyNiceMax = Math.ceil(maxDaily / dailyStep) * dailyStep;
  const dailyTicks = Array.from(
    { length: Math.floor(dailyNiceMax / dailyStep) },
    (_, i) => (i + 1) * dailyStep
  );
  const maxSource = Math.max(1, ...s.sources.map((x) => x.sessions));
  const maxKeyword = Math.max(1, ...s.keywords.map((x) => x.sessions));
  const maxPage = Math.max(1, ...s.topPages.map((x) => x.count));
  const maxClick = Math.max(1, ...s.topClicks.map((x) => x.count));
  const maxCampaign = Math.max(1, ...s.campaigns.map((x) => x.count));
  // 추이 X축 라벨이 너무 많으면 일부만 표기 (최대 ~16개)
  const labelEvery = Math.max(1, Math.ceil(s.daily.length / 16));

  const nf = (n: number) => n.toLocaleString("ko-KR");

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* ── 헤더 ── */}
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">유입·클릭 분석</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              <span className="font-semibold text-slate-600">{period.label}</span> · 방문자가 어디서 왔고 무엇을 클릭했는지 (외부 도구 없이 자체 수집)
            </p>
          </div>
          <NoTrackToggle />
        </div>
        <AnalyticsPeriodPicker />
      </div>

      {rowCount === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <p className="text-3xl mb-2">📭</p>
          <p className="font-bold text-slate-700 mb-1">
            {period.label}에 수집된 데이터가 없습니다
          </p>
          <p className="text-sm text-slate-400">
            다른 기간을 선택하거나, 방문자가 사이트를 둘러보면 이곳에 유입 경로와 클릭이 집계됩니다.
          </p>
        </div>
      ) : (
        <>
          {/* ── 요약 카드 ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <SummaryCard label="방문 (세션)" value={nf(s.totalSessions)} hint={period.label} bg="#EEF0FF" fg="#1E22B2" />
            <SummaryCard label="페이지뷰" value={nf(s.totalPageviews)} hint={period.label} bg="#E0F2FE" fg="#0369A1" />
            <SummaryCard label="평균 체류시간" value={formatDuration(s.avgSessionMs)} hint={period.label} bg="#ECFDF5" fg="#0F766E" />
            <SummaryCard label="클릭" value={nf(s.totalClicks)} hint={period.label} bg="#FFF3F9" fg="#E91E8C" />
          </div>

          {/* ── 추이 (일/월) — 방문·페이지뷰 이중 막대 + 마우스 툴팁 ── */}
          <Section title={`${period.unit === "month" ? "월별" : "일별"} 추이 · ${period.label}`}>
            <DailyTrendChart
              data={s.daily}
              niceMax={dailyNiceMax}
              ticks={dailyTicks}
              labelEvery={labelEvery}
            />
          </Section>

          {/* ── 검색 키워드 ── */}
          <Section title="검색 키워드 (어떤 검색어로 왔나)">
            {s.keywords.length === 0 ? (
              <p className="text-sm text-slate-400 py-2">아직 수집된 검색어가 없습니다.</p>
            ) : (
              <ul className="space-y-2.5">
                {s.keywords.map((x) => {
                  const meta = MEDIUM_META[x.medium] ?? { label: x.medium, color: "#64748B" };
                  const pct = Math.round((x.sessions / maxKeyword) * 100);
                  return (
                    <li key={`${x.keyword}|${x.medium}`}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-slate-700 truncate">{x.keyword}</span>
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: `${meta.color}1A`, color: meta.color }}
                          >
                            {meta.label}
                          </span>
                        </span>
                        <span className="font-bold text-slate-900 tabular-nums flex-shrink-0 ml-2">{nf(x.sessions)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.color }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-[11px] text-slate-400 mt-3 leading-relaxed" style={{ wordBreak: "keep-all" }}>
              ※ 광고 키워드(<span className="font-mono">utm_term</span>)는 정확히 집계됩니다. 자연검색(구글·네이버)
              검색어는 개인정보 보호 정책으로 대부분 전달되지 않아, 광고를 집행하면 이 섹션이 본격적으로 채워집니다.
            </p>
          </Section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ── 유입 경로 ── */}
            <Section title="유입 경로 (어디서 왔나)">
              {s.sources.length === 0 ? (
                <Empty />
              ) : (
                <ul className="space-y-2.5">
                  {s.sources.slice(0, 12).map((x) => {
                    const meta = MEDIUM_META[x.medium] ?? { label: x.medium, color: "#64748B" };
                    const pct = Math.round((x.sessions / maxSource) * 100);
                    return (
                      <li key={`${x.source}|${x.medium}`}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-slate-700 truncate">{sourceLabel(x.source)}</span>
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ background: `${meta.color}1A`, color: meta.color }}
                            >
                              {meta.label}
                            </span>
                          </span>
                          <span className="font-bold text-slate-900 tabular-nums flex-shrink-0 ml-2">{nf(x.sessions)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.color }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            {/* ── 인기 페이지 ── */}
            <Section title="인기 페이지">
              {s.topPages.length === 0 ? (
                <Empty />
              ) : (
                <ul className="space-y-2.5">
                  {s.topPages.map((x) => {
                    const pct = Math.round((x.count / maxPage) * 100);
                    return (
                      <li key={x.key}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <code className="text-slate-600 truncate font-mono text-xs">{x.key}</code>
                          <span className="flex items-center gap-2 flex-shrink-0 ml-2">
                            {x.avgDwellMs > 0 && (
                              <span className="text-[11px] text-slate-400" title="평균 체류 시간">
                                {formatDuration(x.avgDwellMs)}
                              </span>
                            )}
                            <span className="font-bold text-slate-900 tabular-nums">{nf(x.count)}</span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#0EA5E9" }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>

          {/* ── 캠페인별 유입 (광고/UTM 캠페인이 있을 때만) ── */}
          {s.campaigns.length > 0 && (
            <div className="mt-6">
              <Section title="캠페인별 유입 (UTM 캠페인 · 광고 효과)">
                <ul className="space-y-2.5">
                  {s.campaigns.map((c) => {
                    const pct = Math.round((c.count / maxCampaign) * 100);
                    return (
                      <li key={c.key}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-slate-700 font-medium truncate">🎯 {c.key}</span>
                          <span className="font-bold text-slate-900 tabular-nums flex-shrink-0 ml-2">{nf(c.count)} 방문</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#F59E0B" }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            </div>
          )}

          {/* ── 클릭 순위 ── */}
          <div className="mt-6">
            <Section title="가장 많이 클릭한 항목">
              {s.topClicks.length === 0 ? (
                <Empty />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {s.topClicks.map((x, i) => {
                    const pct = Math.round((x.count / maxClick) * 100);
                    return (
                      <li key={`${x.label}-${i}`} className="py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-slate-300 w-5 tabular-nums flex-shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{x.label}</p>
                            {x.href && (
                              <p className="text-[11px] text-slate-400 truncate font-mono">{x.href}</p>
                            )}
                          </div>
                          <div className="w-28 hidden sm:block flex-shrink-0">
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#E91E8C" }} />
                            </div>
                          </div>
                          <span className="font-bold text-slate-900 tabular-nums w-12 text-right flex-shrink-0">{nf(x.count)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>

          {/* ── 방문자 여정 ── */}
          <div className="mt-6">
            <Section title="방문자 여정 (최근 방문 흐름)">
              {s.journeys.length === 0 ? (
                <Empty />
              ) : (
                <ul className="space-y-3">
                  {s.journeys.map((j) => {
                    const meta = MEDIUM_META[j.medium] ?? { label: j.medium, color: "#64748B" };
                    return (
                      <li key={j.sessionId} className="border border-slate-100 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: `${meta.color}1A`, color: meta.color }}
                          >
                            {sourceLabel(j.source)} · {meta.label}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {j.device === "mobile" ? "📱 모바일" : "💻 데스크톱"}
                          </span>
                          <span className="text-[11px] text-slate-400">· {j.pageCount}페이지</span>
                          <span className="text-[11px] text-slate-400">· 체류 {formatDuration(j.durationMs)}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-wrap">
                          {j.pages.map((p, i) => (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && <span className="text-slate-300 text-xs">→</span>}
                              <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-50 text-slate-600">
                                {p}
                              </code>
                            </span>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>

          <p className="text-xs text-slate-400 mt-6 text-center">
            쿠키를 사용하지 않으며 IP·개인정보를 저장하지 않는 자체 집계입니다. 세션은 브라우저를 닫으면 만료됩니다.
          </p>
        </>
      )}
    </div>
  );
}

/* ── 소형 프레젠테이션 컴포넌트 ── */

function SummaryCard({
  label,
  value,
  hint,
  bg,
  fg,
}: {
  label: string;
  value: string;
  hint: string;
  bg: string;
  fg: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: bg }}>
          <svg viewBox="0 0 20 20" fill={fg} className="w-5 h-5">
            <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
          </svg>
        </div>
      </div>
      <p className="text-3xl font-bold text-slate-900 mb-0.5">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-xs text-slate-400 mt-1">{hint}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 mb-6">
      <h2 className="font-bold text-slate-900 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-slate-400 py-4 text-center">데이터가 없습니다.</p>;
}
