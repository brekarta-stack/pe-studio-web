"use client";

/**
 * 아티스트 포털 껍데기 — 상단 탭 + 로그아웃.
 *
 * 어드민(AdminShell)의 사이드바 대신 상단 탭을 쓴다. 메뉴가 둘뿐이고,
 * 아티스트는 작업실·현장에서 휴대폰으로 열어 보는 경우가 많기 때문.
 * 로그인 전(공개 페이지)에는 껍데기 없이 내용만 보여준다 — AdminShell 과 같은 방침.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

const TABS = [
  { href: "/artist", exact: true, label: "내 업무" },
  { href: "/artist/settlements", exact: false, label: "정산 내역" },
];

export default function ArtistShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // 로그인 전(로딩 중 or 비로그인) → 껍데기 없이 렌더 (로그인·가입 신청·초대 수락 페이지)
  if (status === "loading" || !session) return <>{children}</>;

  const name = session.user?.name || session.user?.email || "아티스트";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex items-center justify-between py-4">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                PE Studio 아티스트
              </p>
              <p className="truncate text-lg font-bold text-slate-900">{name} 님</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/artist/login" })}
              className="flex-shrink-0 rounded-lg border border-red-100 px-3 py-2 text-xs text-red-500 transition-colors hover:bg-red-50"
            >
              로그아웃
            </button>
          </div>

          <nav className="flex gap-1" aria-label="포털 메뉴">
            {TABS.map((tab) => {
              const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                    active
                      ? "border-[#1E22B2] text-[#1E22B2]"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:py-8">{children}</div>
    </div>
  );
}
