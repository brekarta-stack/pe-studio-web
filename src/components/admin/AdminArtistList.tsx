"use client";

/**
 * 어드민 아티스트 목록 — 추가/편집/삭제 + 노출 토글.
 * source === "seed" 면 artists 테이블 미생성 상태 → 마이그레이션 안내 배너.
 */

import { useState } from "react";
import type { Artist } from "@/lib/artist-types";
import { viaImageOptimizer } from "@/lib/image-url";

interface Props {
  initialItems: Artist[];
  source: "db" | "seed";
}

export default function AdminArtistList({ initialItems, source }: Props) {
  const [items, setItems] = useState(initialItems);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function remove(id: string, name: string) {
    if (!confirm(`'${name}' 아티스트를 삭제할까요?\n작업 포트폴리오에 붙은 태그는 그대로 남습니다.`)) return;
    const res = await fetch(`/api/artists/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert((err as { error?: string }).error || "삭제 실패");
      return;
    }
    setItems((prev) => prev.filter((a) => a.id !== id));
  }

  /** 노출 토글 — 낙관적 업데이트 + 실패 시 롤백 */
  async function togglePublished(artist: Artist) {
    const next = !artist.published;
    setSavingId(artist.id);
    setItems((prev) => prev.map((a) => (a.id === artist.id ? { ...a, published: next } : a)));
    try {
      const res = await fetch(`/api/artists/${artist.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...artist, published: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems((prev) => prev.map((a) => (a.id === artist.id ? { ...a, published: artist.published } : a)));
      alert("노출 상태 변경에 실패했습니다.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">아티스트</h1>
          <p className="text-sm text-slate-400 mt-0.5">총 {items.length}명 · 회사소개 페이지에 노출</p>
        </div>
        <a
          href="/admin/artists/new"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-white font-semibold rounded-xl text-sm transition-opacity hover:opacity-90"
          style={{ background: "#1E22B2" }}
        >
          ＋ 아티스트 추가
        </a>
      </div>

      {/* 테이블 미생성 안내 */}
      {source === "seed" && (
        <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800" style={{ wordBreak: "keep-all" }}>
          <strong>DB 테이블이 아직 없습니다.</strong> 지금 보이는 것은 코드에 내장된 샘플이며,
          추가·편집·삭제가 저장되지 않습니다. Supabase 대시보드 &gt; SQL Editor 에서{" "}
          <code className="px-1.5 py-0.5 bg-amber-100 rounded font-mono text-xs">
            supabase/migrations/20260607_artists.sql
          </code>{" "}
          을 실행하면 활성화됩니다.
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">🎨</div>
          <p className="text-slate-500">등록된 아티스트가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
              {/* 프로필 */}
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
                {a.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={viaImageOptimizer(a.photo, "", 256)} alt={`${a.name} 프로필`} className="w-full h-full object-cover" />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center text-white text-xl font-extrabold"
                    style={{ background: "linear-gradient(135deg, #06C6C8, #1E22B2)" }}
                  >
                    {a.name.charAt(0)}
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="font-semibold text-slate-900 truncate">{a.name}</h3>
                  {a.published ? (
                    <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full flex-shrink-0">노출</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full flex-shrink-0">숨김</span>
                  )}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {a.role}
                  <span className="mx-1.5 text-slate-300">·</span>
                  태그 <span className="text-pink-500 font-medium">#{a.portfolioTag}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* 노출 토글 */}
                <button
                  type="button"
                  onClick={() => togglePublished(a)}
                  disabled={savingId === a.id || source === "seed"}
                  className={`w-10 h-6 rounded-full transition-colors relative disabled:opacity-40 ${a.published ? "" : "bg-slate-200"}`}
                  style={a.published ? { background: "#1E22B2" } : {}}
                  title="회사소개 노출 토글"
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${a.published ? "left-5" : "left-1"}`}
                  />
                </button>
                <a
                  href={`/admin/artists/${a.id}/edit`}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
                >
                  편집
                </a>
                <button
                  type="button"
                  onClick={() => remove(a.id, a.name)}
                  disabled={source === "seed"}
                  className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
