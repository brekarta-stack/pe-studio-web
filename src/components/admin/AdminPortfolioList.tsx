"use client";

import { useEffect, useRef, useState } from "react";
import type { PortfolioItem } from "@/lib/portfolio-types";
import { parseYearMonth, autoHyphenYearMonth } from "@/lib/portfolio-meta";
import { viaImageOptimizer } from "@/lib/image-url";

/**
 * 제작 시기 텍스트 입력 — 숫자 직접 입력.
 * - 타이핑 중 자동 하이픈: 201806 → 2018-06
 * - 6자리(연+월)가 완성되면 즉시 저장하고 다음 행 입력칸으로 포커스 이동
 * - Enter = 저장 후 다음 칸, blur = 저장, Esc = 되돌리기
 */
function ProducedAtField({
  value,
  disabled,
  onSave,
  onAdvance,
  inputRef,
}: {
  /** 저장된 값 (YYYY-MM-DD | null) */
  value: string | null;
  disabled: boolean;
  /** 정규화된 YYYY-MM (또는 비우기 null) 전달 */
  onSave: (ym: string | null) => void;
  /** 입력 완성 시 다음 행으로 포커스 이동 */
  onAdvance: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  const committed = (value ?? "").slice(0, 7);
  const [draft, setDraft] = useState(committed);
  const [invalid, setInvalid] = useState(false);

  /** 정규화된 값으로 확정 + 변경 시 저장. 성공 여부 반환 */
  function commitDraft(text: string): boolean {
    const parsed = parseYearMonth(text);
    if (parsed === "invalid") {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    setDraft(parsed ?? "");
    if ((parsed ?? "") !== committed) onSave(parsed);
    return true;
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      placeholder="YYYY-MM"
      maxLength={12}
      value={draft}
      disabled={disabled}
      onChange={(e) => {
        const v = autoHyphenYearMonth(e.target.value);
        setDraft(v);
        if (invalid) setInvalid(false);
        // 연 4자리 + 월 2자리가 완성되면 자동 저장 후 다음 칸으로
        if (/^\d{4}-\d{2}$/.test(v) && commitDraft(v)) onAdvance();
      }}
      onBlur={() => commitDraft(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && commitDraft(draft)) onAdvance();
        if (e.key === "Escape") {
          setDraft(committed);
          setInvalid(false);
        }
      }}
      title={invalid ? "형식 오류 — 예: 2021-05, 202105, 2021년 5월" : "노출 순서 기준 — 최신이 앞에 노출됩니다"}
      className={`w-24 px-2 py-1 border rounded-lg text-xs text-slate-700 text-center focus:outline-none focus:ring-2 disabled:opacity-50 ${
        invalid
          ? "border-red-400 focus:ring-red-300 bg-red-50"
          : "border-slate-200 focus:ring-[#1E22B2]/30"
      }`}
    />
  );
}

const categoryColors: Record<string, string> = {
  "자체 제작": "bg-emerald-100 text-emerald-700",
  "팝업북": "bg-pink-100 text-pink-700",
  "페이퍼 크래프트": "bg-blue-100 text-blue-700",
  "액션 크래프트": "bg-orange-100 text-orange-700",
  "우드락": "bg-amber-100 text-amber-700",
  "모자/마스크": "bg-cyan-100 text-cyan-700",
  "기타": "bg-slate-100 text-slate-600",
};

export default function AdminPortfolioList({ initialItems }: { initialItems: PortfolioItem[] }) {
  const [items, setItems] = useState(initialItems);
  /** 현재 토글 저장 중인 항목 id (UI 비활성화용) */
  const [savingId, setSavingId] = useState<string | null>(null);
  /** 행별 '제작 시기' 입력 ref — 입력 완성 시 다음 행으로 포커스 이동용 */
  const producedAtRefs = useRef<(HTMLInputElement | null)[]>([]);

  /* ── 작업 아티스트 드롭다운 — /api/artists 에서 로드, 태그로 저장 ── */
  const [artistOptions, setArtistOptions] = useState<{ name: string; portfolioTag: string }[]>([]);
  useEffect(() => {
    fetch("/api/artists")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.artists)) {
          setArtistOptions(
            d.artists.map((a: { name: string; portfolioTag: string }) => ({
              name: a.name,
              portfolioTag: a.portfolioTag,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);
  const artistTagList = artistOptions.map((a) => a.portfolioTag);
  /** 항목 태그 중 아티스트 태그(첫 매칭) — 드롭다운 표시값 */
  const currentArtistTag = (item: PortfolioItem) =>
    (item.tags ?? []).find((t) => artistTagList.includes(t)) ?? "";

  /**
   * '작업 아티스트' 인라인 변경 — 기존 아티스트 태그 제거 후 새 태그 부착, 즉시 PUT (낙관적).
   * 아티스트가 아닌 일반 태그는 보존한다. 실패 시 롤백 + alert.
   */
  async function setItemArtist(id: string, newTag: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const prevTags = item.tags ?? [];
    const rest = prevTags.filter((t) => !artistTagList.includes(t));
    const nextTags = newTag ? [...rest, newTag] : rest;
    setSavingId(id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, tags: nextTags } : i)));
    try {
      const res = await fetch(`/api/portfolio/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: nextTags }),
      });
      if (!res.ok) throw new Error("저장 실패");
    } catch {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, tags: prevTags } : i)));
      alert("작업 아티스트 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSavingId(null);
    }
  }

  /** idx 다음 행의 제작 시기 칸으로 포커스 이동 (마지막 행이면 포커스 해제) */
  function advanceProducedAt(idx: number) {
    const next = producedAtRefs.current[idx + 1];
    if (next) {
      next.focus();
      next.select();
    } else {
      producedAtRefs.current[idx]?.blur();
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await fetch(`/api/portfolio/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  /**
   * '제작 시기' 인라인 변경 — 즉시 PUT API 호출 (낙관적 업데이트).
   * 사이트 노출 순서는 제작 시기(없으면 등록일) 최신순. 실패 시 롤백 + alert.
   */
  async function saveProducedAt(id: string, ym: string | null) {
    const current = items.find((i) => i.id === id)?.producedAt ?? null;
    const next = ym ? `${ym}-01` : null;
    if ((current ?? null) === next) return;
    setSavingId(id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, producedAt: next } : i)));
    try {
      const res = await fetch(`/api/portfolio/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ producedAt: next }),
      });
      if (!res.ok) throw new Error("저장 실패");
    } catch {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, producedAt: current } : i)));
      alert("'제작 시기' 저장에 실패했습니다. (DB 마이그레이션 적용 여부를 확인하세요)");
    } finally {
      setSavingId(null);
    }
  }

  /**
   * '메인 노출' 체크박스 토글 — 즉시 PUT API 호출 (낙관적 업데이트).
   * 실패 시 롤백 + alert.
   */
  async function toggleFeatured(id: string, current: boolean) {
    const next = !current;
    setSavingId(id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, featured: next } : i)));
    try {
      const res = await fetch(`/api/portfolio/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured: next }),
      });
      if (!res.ok) throw new Error("저장 실패");
    } catch {
      // 롤백
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, featured: current } : i)));
      alert("'메인 노출' 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSavingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
        <div className="text-4xl mb-3">🖼️</div>
        <p className="text-slate-500">아직 등록된 작품이 없습니다.</p>
        <a
          href="/admin/portfolio/new"
          className="inline-block mt-4 px-5 py-2 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition-colors"
        >
          첫 작품 등록하기
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        사이트(작업 포트폴리오·홈)는 <strong className="text-slate-500">제작 시기(없으면 등록일) 최신순</strong>으로
        노출됩니다. 행의 제작 시기를 바꾸면 즉시 저장되며, 목록 순서는 새로고침 시 반영됩니다.
      </p>
      {items.map((item, idx) => (
        <div
          key={item.id}
          className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4"
        >
          {/* '메인 노출' 체크박스 — 홈 "이런 걸 만듭니다" 섹션 노출 여부 */}
          <label
            className="flex flex-col items-center justify-center gap-1 cursor-pointer select-none flex-shrink-0"
            title="홈 '이런 걸 만듭니다' 섹션에 표시"
          >
            <input
              type="checkbox"
              checked={!!item.featured}
              disabled={savingId === item.id}
              onChange={() => toggleFeatured(item.id, !!item.featured)}
              className="w-5 h-5 rounded border-slate-300 text-[#1E22B2] focus:ring-2 focus:ring-[#1E22B2]/30 cursor-pointer disabled:opacity-50"
            />
            <span className="text-[10px] text-slate-500 font-medium leading-none">메인</span>
          </label>

          {/* Thumbnail */}
          <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
            {item.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viaImageOptimizer(item.images[0], "", 256)} alt={`${item.title} 썸네일`} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-300 text-xl">🖼️</div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-semibold text-slate-900 truncate">{item.title}</h3>
              {item.published ? (
                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full flex-shrink-0">공개</span>
              ) : (
                <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full flex-shrink-0">비공개</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className={`px-2 py-0.5 rounded-full font-medium ${categoryColors[item.category] ?? "bg-slate-100 text-slate-600"}`}>
                {item.category}
              </span>
              {item.client && <span>{item.client}</span>}
              <span>이미지 {item.images.length}장</span>
            </div>
          </div>

          {/* 제작 시기 — 노출 순서 기준 (숫자 직접 입력, 6자리 완성 시 자동 저장+다음 칸) */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0 select-none">
            <ProducedAtField
              value={item.producedAt ?? null}
              disabled={savingId === item.id}
              onSave={(ym) => saveProducedAt(item.id, ym)}
              onAdvance={() => advanceProducedAt(idx)}
              inputRef={(el) => {
                producedAtRefs.current[idx] = el;
              }}
            />
            <span className="text-[10px] text-slate-500 font-medium leading-none">제작 시기</span>
          </div>

          {/* 작업 아티스트 — 목록에서 바로 선택 (편집 페이지 진입 불필요) */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0 select-none">
            <select
              value={currentArtistTag(item)}
              disabled={savingId === item.id || artistOptions.length === 0}
              onChange={(e) => setItemArtist(item.id, e.target.value)}
              title="이 작업을 만든 아티스트 선택 — 회사소개 '작품 보기' 필터와 연동"
              className="w-28 px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1E22B2]/30 disabled:opacity-50"
            >
              <option value="">— 미지정 —</option>
              {artistOptions.map((a) => (
                <option key={a.portfolioTag} value={a.portfolioTag}>{a.name}</option>
              ))}
            </select>
            <span className="text-[10px] text-slate-500 font-medium leading-none">작업 아티스트</span>
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <a
              href={`/admin/portfolio/${item.id}/edit`}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
            >
              편집
            </a>
            <button
              onClick={() => deleteItem(item.id)}
              className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
            >
              삭제
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
