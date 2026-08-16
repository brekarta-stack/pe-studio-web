"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/", label: "홈" },
  { href: "/about", label: "회사소개" },
  { href: "/products", label: "주문 제작" },
  // 페이퍼크래프트 스튜디오(웹 /studio · 데스크톱 /download)는 베타라 메뉴에서 비공개.
  // 페이지 자체는 직접 접근·SEO 색인 유지 — 정식 출시 시 아래 두 줄 주석 해제.
  // { href: "/studio", label: "무료도면" },  // 웹 카탈로그 — 품질 정비 전까지 비공개(2026-07-11)
  // { href: "/download", label: "다운로드" },  // 데스크톱 프로그램 배포 — 베타라 비공개(2026-07-21)
  { href: "/portfolio", label: "작업 포트폴리오" },
  { href: "/blog", label: "블로그" },
];

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5" aria-label="Paper Engineering Studio 홈으로 이동">
            {/* 만세 인형 마크 — 밝은 배경이라 별도 판 없이 그대로 얹는다.
                글자는 이미지가 아니라 아래 HTML 텍스트라 어느 폭에서도 선명하다. */}
            <Image
              src="/brand/pe-studio-mark.png"
              alt=""
              width={202}
              height={256}
              priority
              className="h-9 w-auto flex-shrink-0"
              aria-hidden
            />
            <span className="font-bold text-lg text-slate-900 tracking-tight">
              PE Studio
              <span className="hidden lg:inline text-slate-400 font-medium text-sm ml-1.5">
                · 페이퍼 엔지니어링
              </span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "text-white"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
                style={pathname === link.href ? { background: "#1E22B2" } : {}}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* CTA + Mobile Toggle */}
          <div className="flex items-center gap-3">
            <Link
              href="/quote"
              className="hidden sm:inline-flex items-center px-4 py-2 text-white text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #06C6C8, #1E22B2)" }}
            >
              제작 문의
            </Link>
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={isOpen ? "메뉴 닫기" : "메뉴 열기"}
              aria-expanded={isOpen}
              aria-controls="mobile-menu"
            >
              {isOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div id="mobile-menu" className="md:hidden border-t border-slate-200 bg-white">
          <div className="px-4 py-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "text-white"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
                style={pathname === link.href ? { background: "#1E22B2" } : {}}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/quote"
              onClick={() => setIsOpen(false)}
              className="block px-4 py-2.5 text-white text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 text-center mt-2"
              style={{ background: "linear-gradient(135deg, #06C6C8, #1E22B2)" }}
            >
              제작 문의
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
