"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";

/* ─── 네비게이션 항목 ─── */
const NAV_GROUPS = [
  {
    label: null,
    items: [
      {
        href: "/admin",
        exact: true,
        label: "대시보드",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M2 10a8 8 0 1116 0A8 8 0 012 10zm8-5a1 1 0 011 1v3.586l2.707 2.707a1 1 0 01-1.414 1.414l-3-3A1 1 0 019 10V6a1 1 0 011-1z" />
          </svg>
        ),
      },
      {
        href: "/admin/analytics",
        exact: false,
        label: "유입·클릭 분석",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
          </svg>
        ),
      },
    ],
  },
  {
    // 수주 파이프라인 — 리드가 들어와서 아티스트에게 배정되고 납품·정산되기까지
    label: "운영",
    items: [
      {
        href: "/admin/quotes",
        exact: false,
        label: "제작 문의",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 0h8v12H6V4zm2 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1zm0 3a1 1 0 011-1h4a1 1 0 110 2H9a1 1 0 01-1-1zm0 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        href: "/admin/works",
        exact: false,
        label: "작업 관리",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M6 2a1 1 0 011 1v1h6V3a1 1 0 112 0v1h1a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h1V3a1 1 0 011-1zM4 8v8h12V8H4zm2.7 3.3a1 1 0 011.4 0l.9.9 2.9-2.9a1 1 0 111.4 1.4l-3.6 3.6a1 1 0 01-1.4 0l-1.6-1.6a1 1 0 010-1.4z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        // 아티스트 포털 로그인 계정 — 초대 발급·가입 신청 승인·아티스트 매칭
        href: "/admin/accounts",
        exact: false,
        label: "아티스트 계정",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6zm-3 3a1.25 1.25 0 01.75 2.25V15a.75.75 0 01-1.5 0v-.75A1.25 1.25 0 0110 12z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        // Drop(제외) 처리한 제작 문의 — 목록에서 빠진 건을 따로 모아 본다(복구 가능)
        href: "/admin/drops",
        exact: false,
        label: "Drop",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "콘텐츠",
    items: [
      {
        href: "/admin/portfolio",
        exact: false,
        label: "작업 포트폴리오",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        href: "/admin/artists",
        exact: false,
        label: "아티스트",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        href: "/admin/blog",
        exact: false,
        label: "블로그",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zm-2.207 2.207L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
        ),
      },
      {
        href: "/admin/studio-review",
        exact: false,
        label: "도면 검수",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        // 종이모형 스튜디오는 아직 공개 메뉴에서 숨겼지만, 관리자는 새 탭으로
        // 실제 카탈로그를 확인할 수 있다(프록시가 관리자 세션만 통과시킴).
        href: "/studio",
        exact: false,
        external: true,
        label: "종이모형 스튜디오",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M4 3a2 2 0 00-2 2v1h16V5a2 2 0 00-2-2H4z" />
            <path fillRule="evenodd" d="M18 8H2v7a2 2 0 002 2h12a2 2 0 002-2V8zM6 11a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "시스템",
    items: [
      {
        href: "/admin/setup",
        exact: false,
        label: "DB 셋업",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
        ),
      },
    ],
  },
];

/* ─── 개별 NavLink ─── */
function NavLink({
  item,
  onClick,
}: {
  item: { href: string; exact?: boolean; external?: boolean; label: string; icon: React.ReactNode };
  onClick?: () => void;
}) {
  const pathname = usePathname();

  // 외부/새 탭 링크(예: 공개 사이트의 /studio) — 활성 표시 없이 새 탭으로 연다.
  if (item.external) {
    return (
      <a
        href={item.href}
        onClick={onClick}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <span className="flex-shrink-0">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        <span className="text-slate-300 text-xs">↗</span>
      </a>
    );
  }

  const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
        isActive
          ? "text-white shadow-sm"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
      style={isActive ? { background: "#1E22B2" } : {}}
    >
      <span className="flex-shrink-0">{item.icon}</span>
      {item.label}
    </Link>
  );
}

/* ─── 사이드바 내용 ─── */
function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const { data: session } = useSession();

  return (
    <div className="flex flex-col h-full">
      {/* 로고 */}
      <div className="px-4 py-5 border-b border-slate-100">
        <Link href="/admin" className="flex items-center gap-2.5" onClick={onNavClick}>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "#1E22B2" }}
          >
            <svg viewBox="0 0 28 28" className="w-4 h-4" fill="none">
              <path d="M6 4 H14 A6 6 0 0 1 14 16 H10 V24 H6 Z" fill="white" />
              <path d="M14 4 L20 10 V24 H22 V8 L16 2 H14 Z" fill="white" opacity="0.6" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="font-bold text-slate-900 text-sm">PE Studio</div>
            <div className="text-[11px] text-slate-400">관리자</div>
          </div>
        </Link>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? "main"}>
            {group.label && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-3 mb-1.5">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} onClick={onNavClick} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* 사용자 + 로그아웃 */}
      <div className="px-3 py-4 border-t border-slate-100">
        <div className="flex items-center gap-2.5 px-3 py-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold" style={{ color: "#1E22B2" }}>
              {session?.user?.email?.[0]?.toUpperCase() ?? "A"}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700 truncate">
              {session?.user?.email ?? "관리자"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/"
            target="_blank"
            className="flex-1 text-center text-xs py-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
          >
            사이트 보기
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/admin/login" })}
            className="flex-1 text-center text-xs py-2 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── AdminShell (메인 export) ─── */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: session, status } = useSession();

  // 로그인 전(로딩 중 or 비로그인) → 사이드바 없이 렌더
  if (status === "loading" || !session) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* ── 데스크톱 사이드바 ── */}
      <aside className="hidden lg:flex flex-col w-60 flex-shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      {/* ── 모바일 오버레이 ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100">
          <span className="font-bold text-slate-900">PE Studio 관리자</span>
          <button
            onClick={() => setMobileOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
        <SidebarContent onNavClick={() => setMobileOpen(false)} />
      </aside>

      {/* ── 메인 컨텐츠 ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 모바일 상단 바 */}
        <header className="lg:hidden sticky top-0 z-20 bg-white border-b border-slate-200 flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          </button>
          <span className="font-bold text-slate-900 text-sm">PE Studio 관리자</span>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
