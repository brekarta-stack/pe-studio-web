import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getPosts } from "@/lib/blog";
import { getItems } from "@/lib/portfolio";
import { supabaseAdmin } from "@/lib/supabase-admin";
import Link from "next/link";
import { quoteFromRow, type QuoteSubmission } from "@/lib/quote-types";
import { getReviewMap, mergeItems, computeStats, pickTodayTarget } from "@/lib/studio-review";

const PRODUCT_LABELS: Record<string, string> = {
  papercraft: "페이퍼 크래프트",
  action:     "액션 페이퍼 토이",
  popup:      "팝업북",
  foamboard:  "폼보드(우드락)",
  unsure:     "미정",
  education:  "용도 · 교육/교구",
  promotion:  "용도 · 홍보",
  hobby:      "용도 · 취미",
};

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  /* ── 데이터 병렬 로드 ── */
  const [posts, portfolioItems, quotesResult, reviewData, newQuotesResult, billingResult] =
    await Promise.all([
      getPosts(),
      getItems(),
      supabaseAdmin
        .from("quotes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(6),
      getReviewMap(),
      /* 아직 손대지 않은 신규 문의 수 — 로우를 가져오지 않고 개수만 센다(head).
         Drop 처리한 건은 목록에서도 빠지므로 여기서도 제외한다. */
      supabaseAdmin
        .from("quotes")
        .select("id", { count: "exact", head: true })
        .eq("stage", "new")
        .is("dropped_at", null),
      /* 이번 달 매출 — 배정 단위의 청구금액을 합산한다.
         건수가 적어 그대로 가져와 JS 에서 집계한다. */
      supabaseAdmin.from("assignments").select("client_amount, due_date, created_at, status"),
    ]);

  /* ── 도면 검수 진행 상황 ── */
  const reviewItems = mergeItems(reviewData.map);
  const reviewStats = computeStats(reviewItems);
  const reviewTarget = pickTodayTarget(reviewItems);

  const publishedPosts      = posts.filter((p) => p.published);
  const publishedPortfolio  = portfolioItems.filter((i) => i.published);
  const recentQuotes: QuoteSubmission[] = (quotesResult.data ?? []).map(quoteFromRow);

  /* 아직 검토하지 않은 신규 문의 (stage='new').
     마이그레이션 전이면 stage 컬럼이 없어 에러가 나므로 0 으로 떨어뜨린다. */
  const newQuoteCount = newQuotesResult.error ? 0 : newQuotesResult.count ?? 0;

  /* ── 이번 달 매출 ──
     이번 달 1일~말일에 해당하는 배정의 청구금액 합계.
     "이번 달"의 기준은 납기(due_date), 납기가 없으면 배정 생성일 —
     /admin/works 의 "이번 달 납기" 지표와 같은 정의라 두 화면 숫자가 어긋나지 않는다.
     취소된 배정과 부가세는 제외한다(부가세는 매출이 아니라 나중에 납부할 돈). */
  const thisMonth = new Date().toLocaleDateString("en-CA").slice(0, 7); // 로컬(KST) YYYY-MM
  const monthlyRevenue = (billingResult.data ?? [])
    .filter((a) => a.status !== "cancelled")
    .filter((a) => String(a.due_date ?? a.created_at ?? "").slice(0, 7) === thisMonth)
    .reduce((sum, a) => sum + Number(a.client_amount ?? 0), 0);

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
  const monthLabel = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long" });

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">

      {/* ── 헤더 ── */}
      <div className="mb-8">
        <p className="text-sm text-slate-400 mb-1">{today}</p>
        <h1 className="text-2xl font-bold text-slate-900">대시보드</h1>
      </div>

      {/* ── 통계 카드 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Link href="/admin/quotes" className="group bg-white rounded-2xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#EEF0FF" }}>
              <svg viewBox="0 0 20 20" fill="#1E22B2" className="w-5 h-5">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 0h8v12H6V4zm2 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1zm0 3a1 1 0 011-1h4a1 1 0 110 2H9a1 1 0 01-1-1zm0 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <p className={`text-3xl font-bold mb-0.5 ${newQuoteCount > 0 ? "text-[#1E22B2]" : "text-slate-900"}`}>
            {newQuoteCount}
          </p>
          <p className="text-sm text-slate-500">신규 제작 문의</p>
          <p className="text-xs text-slate-400 mt-1">
            {newQuoteCount > 0 ? "아직 검토하지 않은 건" : "검토 대기 없음"}
          </p>
        </Link>

        {/* 이번 달 매출 — 1일~말일. 납기(없으면 배정일)가 이번 달인 배정의 청구금액 합계 */}
        <Link href="/admin/works" className="group bg-white rounded-2xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#E8F7F0" }}>
              <svg viewBox="0 0 20 20" fill="#0E7A5F" className="w-5 h-5">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v.5c-1.4.25-2.5 1.3-2.5 2.75 0 1.7 1.5 2.35 2.9 2.75 1.2.35 1.6.6 1.6 1.1 0 .5-.5.9-1.5.9-.9 0-1.5-.35-1.8-.9a1 1 0 00-1.75.95c.5.95 1.4 1.6 2.55 1.8v.65a1 1 0 102 0v-.65c1.5-.25 2.6-1.3 2.6-2.8 0-1.75-1.55-2.4-2.95-2.8-1.2-.35-1.55-.6-1.55-1.05 0-.45.45-.85 1.4-.85.8 0 1.35.3 1.6.8a1 1 0 001.8-.85c-.45-.95-1.3-1.55-2.4-1.75V6z" clipRule="evenodd" />
              </svg>
            </div>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="text-3xl font-bold text-slate-900 mb-0.5 tabular-nums">
            {monthlyRevenue.toLocaleString("ko-KR")}
            <span className="text-lg font-semibold text-slate-400">원</span>
          </p>
          <p className="text-sm text-slate-500">이번 달 매출</p>
          <p className="text-xs text-slate-400 mt-1">
            {monthLabel} 1일~말일 · 부가세 제외
          </p>
        </Link>

        <Link href="/admin/portfolio" className="group bg-white rounded-2xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFF3F9" }}>
              <svg viewBox="0 0 20 20" fill="#E91E8C" className="w-5 h-5">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
              </svg>
            </div>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="text-3xl font-bold text-slate-900 mb-0.5">{portfolioItems.length}</p>
          <p className="text-sm text-slate-500">작업 포트폴리오</p>
          <p className="text-xs text-slate-400 mt-1">공개 {publishedPortfolio.length}건 · 비공개 {portfolioItems.length - publishedPortfolio.length}건</p>
        </Link>

        <Link href="/admin/blog" className="group bg-white rounded-2xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFF8E7" }}>
              <svg viewBox="0 0 20 20" fill="#F5C518" className="w-5 h-5">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zm-2.207 2.207L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </div>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="text-3xl font-bold text-slate-900 mb-0.5">{posts.length}</p>
          <p className="text-sm text-slate-500">블로그 포스트</p>
          <p className="text-xs text-slate-400 mt-1">공개 {publishedPosts.length}건 · 비공개 {posts.length - publishedPosts.length}건</p>
        </Link>
      </div>

      {/* ── 도면 검수 진행 ── */}
      <Link
        href="/admin/studio-review"
        className="group block bg-white rounded-2xl border border-slate-200 p-5 mb-6 hover:border-blue-300 hover:shadow-md transition-all"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-slate-900">도면 검수</h2>
            {reviewStats.reviewedToday >= 1 ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                오늘 {reviewStats.reviewedToday}건 완료
              </span>
            ) : reviewTarget ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: "#EEF0FF", color: "#1E22B2" }}>
                오늘의 검수: {reviewTarget.name_ko}
              </span>
            ) : (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                전체 완료 🎉
              </span>
            )}
          </div>
          <span className="text-xs font-semibold group-hover:underline" style={{ color: "#1E22B2" }}>
            검수하러 가기 →
          </span>
        </div>
        <div className="flex items-center gap-4 mb-2 text-sm">
          <span className="text-slate-500">전체 <b className="text-slate-800 tabular-nums">{reviewStats.total}</b></span>
          <span className="text-slate-500">검수완료 <b className="text-green-700 tabular-nums">{reviewStats.reviewed}</b></span>
          <span className="text-slate-500">미검수 <b className="text-amber-600 tabular-nums">{reviewStats.pending}</b></span>
          <span className="ml-auto text-slate-700 font-semibold tabular-nums">{reviewStats.percent}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${reviewStats.percent}%`, background: "#1E22B2" }} />
        </div>
      </Link>

      {/* ── 최근 제작 문의 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 mb-6">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">최근 제작 문의</h2>
          <Link href="/admin/quotes" className="text-xs font-semibold hover:underline" style={{ color: "#1E22B2" }}>
            전체 보기 →
          </Link>
        </div>

        {recentQuotes.length === 0 ? (
          <div className="px-6 py-10 text-center text-slate-400 text-sm">
            아직 접수된 견적이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentQuotes.map((q) => (
              <div key={q.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm text-slate-900">{q.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#EEF0FF", color: "#1E22B2" }}>
                      {PRODUCT_LABELS[q.product] ?? q.product}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">{q.email} · {q.phone}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-500">{q.quantity ? `${q.quantity}개` : "—"}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {new Date(q.createdAt).toLocaleDateString("ko-KR")}
                  </p>
                </div>
                <a
                  href={`mailto:${q.email}`}
                  className="ml-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700 transition-colors flex-shrink-0"
                >
                  회신
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 빠른 작업 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Link
          href="/admin/analytics"
          className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5 hover:border-blue-300 hover:shadow-sm transition-all group"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#EEF0FF" }}>
            <svg viewBox="0 0 20 20" fill="#1E22B2" className="w-4 h-4">
              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900">유입·클릭 분석</span>
        </Link>

        <Link
          href="/admin/portfolio/new"
          className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5 hover:border-pink-300 hover:shadow-sm transition-all group"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#FFF3F9" }}>
            <svg viewBox="0 0 20 20" fill="#E91E8C" className="w-4 h-4">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900">작업 포트폴리오 등록</span>
        </Link>

        <Link
          href="/admin/blog/new"
          className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5 hover:border-amber-300 hover:shadow-sm transition-all group"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#FFF8E7" }}>
            <svg viewBox="0 0 20 20" fill="#F5C518" className="w-4 h-4">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900">블로그 글 쓰기</span>
        </Link>

        <Link
          href="/admin/setup"
          className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5 hover:border-slate-300 hover:shadow-sm transition-all group"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-100">
            <svg viewBox="0 0 20 20" fill="#64748B" className="w-4 h-4">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900">DB 셋업 확인</span>
        </Link>
      </div>
    </div>
  );
}
