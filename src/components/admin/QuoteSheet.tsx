"use client";

/**
 * 제작 문의 시트 — 고객이 입력한 모든 항목을 컬럼별로 보여주는 표.
 *
 * 카드형에서는 style_type / product_text / sampling / rushed / packaging 이
 * 화면에 아예 나오지 않았다. 여기서는 수집 필드를 하나도 빠뜨리지 않는 것이 원칙이다.
 *
 * 인라인 편집: 진행 여부(체크박스) · 진행 단계 · 담당 아티스트.
 * 서버 액션 왕복 전에 화면을 먼저 바꾸고(낙관적 갱신), 실패하면 되돌린다.
 */

import { Fragment, useMemo, useState, useTransition } from "react";
import type { QuoteSubmission } from "@/lib/quote-types";
import {
  QUOTE_STAGES,
  STAGE_LABELS,
  STAGE_COLORS,
  type QuoteStage,
} from "@/lib/assignment-types";
import {
  PRODUCT_LABELS,
  STYLE_LABELS,
  PACKAGING_LABELS,
  CUSTOM_DESIGN_LABELS,
  label,
} from "@/lib/quote-labels";
import { setQuoteProgress, setQuoteStage, assignArtist } from "@/app/admin/quotes/actions";

export interface ArtistOption {
  id: string;
  name: string;
}

/** 리드별 배정된 아티스트 (0명 이상) */
export type AssignedMap = Record<string, ArtistOption[]>;

interface Props {
  quotes: QuoteSubmission[];
  artists: ArtistOption[];
  assigned: AssignedMap;
  /** assignments 테이블이 아직 없으면 배정 UI 를 비활성화하고 안내한다 */
  assignmentsReady: boolean;
}

/* ─── 컬럼 정의 ───
   key 는 표시/숨김 토글과 CSV 헤더에 함께 쓰인다. */
type ColKey =
  | "progress" | "stage" | "artist" | "createdAt" | "name" | "phone" | "email"
  | "product" | "quantity" | "deliveryDate" | "purpose" | "customDesign"
  | "styleType" | "productText" | "sampling" | "rushed" | "packaging"
  | "colorRequest" | "notes" | "files" | "acquisition";

const COLUMNS: { key: ColKey; label: string; width: string }[] = [
  { key: "progress",     label: "진행",        width: "w-14"  },
  { key: "stage",        label: "단계",        width: "w-32"  },
  { key: "artist",       label: "담당 아티스트", width: "w-36" },
  { key: "createdAt",    label: "접수일",      width: "w-32"  },
  { key: "name",         label: "이름",        width: "w-28"  },
  { key: "phone",        label: "연락처",      width: "w-32"  },
  { key: "email",        label: "이메일",      width: "w-48"  },
  { key: "product",      label: "제품",        width: "w-36"  },
  { key: "quantity",     label: "수량",        width: "w-24"  },
  { key: "deliveryDate", label: "납품 희망일",  width: "w-32"  },
  { key: "purpose",      label: "사용 목적",    width: "w-28"  },
  { key: "customDesign", label: "커스텀",      width: "w-20"  },
  { key: "styleType",    label: "디자인 스타일", width: "w-28" },
  { key: "productText",  label: "삽입 문구",    width: "w-36"  },
  { key: "sampling",     label: "샘플링",      width: "w-20"  },
  { key: "rushed",       label: "긴급",        width: "w-20"  },
  { key: "packaging",    label: "포장",        width: "w-28"  },
  { key: "colorRequest", label: "디자인 요청",  width: "w-56"  },
  { key: "notes",        label: "메모",        width: "w-56"  },
  { key: "files",        label: "첨부",        width: "w-40"  },
  { key: "acquisition",  label: "유입",        width: "w-32"  },
];

const HIDDEN_KEY = "pe-admin-quote-hidden-cols";

/* ─── 유입 배지 (카드형에서 쓰던 로직 유지) ─── */
function acqInfo(q: QuoteSubmission): { isAd: boolean; text: string } | null {
  const a = q.acquisition;
  if (!a) return null;
  const isAd = !!(a.adHint || a.gclid || a.utmMedium === "cpc");
  const src = a.utmSource || (a.gclid ? "google" : a.adHint) || "";
  if (!src && !isAd) return null;
  const text = a.utmCampaign ? `${src || "광고"}·${a.utmCampaign}` : src || "광고";
  return { isAd, text };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", {
    year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

/** 불리언 셀 — 체크된 것만 눈에 띄게 (표를 훑을 때 O/X 가 섞이면 읽기 어렵다) */
function BoolCell({ on, label: text }: { on: boolean; label: string }) {
  if (!on) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      {text}
    </span>
  );
}

export default function QuoteSheet({ quotes, artists, assigned, assignmentsReady }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /* 낙관적 갱신용 로컬 오버레이 — 서버 재검증 전까지 화면을 즉시 바꾼다 */
  const [progressOv, setProgressOv] = useState<Record<string, boolean>>({});
  const [stageOv, setStageOv] = useState<Record<string, QuoteStage>>({});
  const [artistOv, setArtistOv] = useState<Record<string, string>>({});

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | QuoteStage>("all");
  const [progressFilter, setProgressFilter] = useState<"all" | "on" | "off">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCols, setShowCols] = useState(false);
  const [hidden, setHidden] = useState<Set<ColKey>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(HIDDEN_KEY);
      return raw ? new Set(JSON.parse(raw) as ColKey[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const toggleCol = (key: ColKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      } catch {
        /* 저장 실패는 무시 — 표시 자체에는 영향 없음 */
      }
      return next;
    });
  };

  /* ── 현재 값 조회 (오버레이 우선) ── */
  const curProgress = (q: QuoteSubmission) => progressOv[q.id] ?? q.inProgress;
  const curStage = (q: QuoteSubmission) => stageOv[q.id] ?? q.stage;
  const curArtistId = (q: QuoteSubmission) =>
    artistOv[q.id] ?? assigned[q.id]?.[0]?.id ?? "";

  /* ── 편집 핸들러 ── */
  const onToggleProgress = (q: QuoteSubmission) => {
    const next = !curProgress(q);
    setProgressOv((p) => ({ ...p, [q.id]: next }));
    setError(null);
    startTransition(async () => {
      const res = await setQuoteProgress(q.id, next);
      if (!res.ok) {
        setProgressOv((p) => ({ ...p, [q.id]: !next })); // 롤백
        setError(res.error);
      }
    });
  };

  const onChangeStage = (q: QuoteSubmission, stage: QuoteStage) => {
    const prev = curStage(q);
    setStageOv((p) => ({ ...p, [q.id]: stage }));
    setError(null);
    startTransition(async () => {
      const res = await setQuoteStage(q.id, stage);
      if (!res.ok) {
        setStageOv((p) => ({ ...p, [q.id]: prev }));
        setError(res.error);
      }
    });
  };

  const onChangeArtist = (q: QuoteSubmission, artistId: string) => {
    const prev = curArtistId(q);
    setArtistOv((p) => ({ ...p, [q.id]: artistId }));
    setError(null);
    startTransition(async () => {
      const res = await assignArtist(q.id, artistId);
      if (!res.ok) {
        setArtistOv((p) => ({ ...p, [q.id]: prev }));
        setError(res.error);
      }
    });
  };

  /* ── 필터링 ── */
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((row) => {
      if (stageFilter !== "all" && curStage(row) !== stageFilter) return false;
      if (progressFilter === "on" && !curProgress(row)) return false;
      if (progressFilter === "off" && curProgress(row)) return false;
      if (!q) return true;
      return [
        row.name, row.email, row.phone, row.notes, row.colorRequest,
        row.productText, row.quantity, label(PRODUCT_LABELS, row.product),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    // curStage/curProgress 는 오버레이 state 에 의존하므로 함께 재계산되어야 한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, search, stageFilter, progressFilter, stageOv, progressOv]);

  const visible = COLUMNS.filter((c) => !hidden.has(c.key));

  /* ── CSV 내보내기 — 현재 필터·컬럼 구성 그대로 ── */
  const exportCsv = () => {
    const cell = (q: QuoteSubmission, key: ColKey): string => {
      switch (key) {
        case "progress":     return curProgress(q) ? "진행" : "";
        case "stage":        return STAGE_LABELS[curStage(q)];
        case "artist":       return artists.find((a) => a.id === curArtistId(q))?.name ?? "";
        case "createdAt":    return fmtDate(q.createdAt);
        case "name":         return q.name;
        case "phone":        return q.phone;
        case "email":        return q.email;
        case "product":      return label(PRODUCT_LABELS, q.product);
        case "quantity":     return q.quantity;
        case "deliveryDate": return q.deliveryDate;
        case "purpose":      return q.purpose;
        case "customDesign": return label(CUSTOM_DESIGN_LABELS, q.customDesign);
        case "styleType":    return label(STYLE_LABELS, q.styleType);
        case "productText":  return q.productText;
        case "sampling":     return q.sampling ? "희망" : "";
        case "rushed":       return q.rushed ? "긴급" : "";
        case "packaging":    return label(PACKAGING_LABELS, q.packaging);
        case "colorRequest": return q.colorRequest;
        case "notes":        return q.notes;
        case "files":        return [q.fileName, q.logoFileName].filter(Boolean).join(" / ");
        case "acquisition":  return acqInfo(q)?.text ?? "";
      }
    };
    const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const lines = [
      visible.map((c) => esc(c.label)).join(","),
      ...rows.map((q) => visible.map((c) => esc(cell(q, c.key))).join(",")),
    ];
    // BOM — 엑셀이 UTF-8 한글을 깨지 않게
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `제작문의_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const th =
    "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap border-b border-slate-200";
  const td = "px-3 py-2 text-sm text-slate-700 align-top border-b border-slate-100";

  return (
    <div>
      {/* ── 툴바 ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름·이메일·연락처·메모 검색"
          className="h-9 w-60 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as "all" | QuoteStage)}
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-400"
        >
          <option value="all">단계 전체</option>
          {QUOTE_STAGES.map((s) => (
            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
          ))}
        </select>
        <select
          value={progressFilter}
          onChange={(e) => setProgressFilter(e.target.value as "all" | "on" | "off")}
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-400"
        >
          <option value="all">진행 전체</option>
          <option value="on">진행중만</option>
          <option value="off">미진행만</option>
        </select>

        <div className="relative">
          <button
            onClick={() => setShowCols((v) => !v)}
            className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50"
          >
            컬럼 {hidden.size > 0 && <span className="text-slate-400">({visible.length}/{COLUMNS.length})</span>}
          </button>
          {showCols && (
            <div className="absolute z-30 mt-1 max-h-80 w-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {COLUMNS.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    onChange={() => toggleCol(c.key)}
                    className="h-3.5 w-3.5 accent-[#1E22B2]"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={exportCsv}
          className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50"
        >
          CSV 내보내기
        </button>

        <span className="ml-auto text-sm text-slate-400">
          {rows.length}건 {rows.length !== quotes.length && `/ 전체 ${quotes.length}건`}
          {isPending && <span className="ml-2 text-slate-300">저장 중…</span>}
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          저장하지 못했습니다: {error}
        </div>
      )}

      {!assignmentsReady && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <code className="font-mono">assignments</code> 테이블이 아직 없어 아티스트 배정을 저장할 수 없습니다.
          {" "}<a href="/admin/setup" className="font-semibold underline">DB 셋업</a>에서 마이그레이션을 실행하세요.
        </div>
      )}

      {/* ── 시트 ── */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              {visible.map((c) => (
                <th key={c.key} className={`${th} ${c.width}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visible.length} className="px-4 py-16 text-center text-slate-400">
                  {quotes.length === 0 ? "아직 접수된 제작 문의가 없습니다." : "조건에 맞는 문의가 없습니다."}
                </td>
              </tr>
            ) : (
              rows.map((q) => {
                const acq = acqInfo(q);
                const stage = curStage(q);
                const isOpen = expanded === q.id;
                const extra = (assigned[q.id]?.length ?? 0) - 1;
                return (
                  <Fragment key={q.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : q.id)}
                      className={`cursor-pointer transition-colors ${isOpen ? "bg-slate-50" : "hover:bg-slate-50/60"}`}
                    >
                      {visible.map((c) => {
                        switch (c.key) {
                          case "progress":
                            return (
                              <td key={c.key} className={td} onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={curProgress(q)}
                                  onChange={() => onToggleProgress(q)}
                                  aria-label={`${q.name} 진행 여부`}
                                  className="h-4 w-4 cursor-pointer accent-[#1E22B2]"
                                />
                              </td>
                            );
                          case "stage":
                            return (
                              <td key={c.key} className={td} onClick={(e) => e.stopPropagation()}>
                                <select
                                  value={stage}
                                  onChange={(e) => onChangeStage(q, e.target.value as QuoteStage)}
                                  aria-label={`${q.name} 진행 단계`}
                                  className={`w-full cursor-pointer rounded-full border px-2 py-1 text-xs font-semibold outline-none ${STAGE_COLORS[stage]}`}
                                >
                                  {QUOTE_STAGES.map((s) => (
                                    <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                                  ))}
                                </select>
                              </td>
                            );
                          case "artist":
                            return (
                              <td key={c.key} className={td} onClick={(e) => e.stopPropagation()}>
                                <select
                                  value={curArtistId(q)}
                                  onChange={(e) => onChangeArtist(q, e.target.value)}
                                  disabled={!assignmentsReady}
                                  aria-label={`${q.name} 담당 아티스트`}
                                  className="w-full cursor-pointer rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                                >
                                  <option value="">미배정</option>
                                  {artists.map((a) => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                  ))}
                                </select>
                                {extra > 0 && (
                                  <span className="mt-1 block text-[11px] text-slate-400">외 {extra}명</span>
                                )}
                              </td>
                            );
                          case "createdAt":
                            return <td key={c.key} className={`${td} whitespace-nowrap text-xs text-slate-500`}>{fmtDate(q.createdAt)}</td>;
                          case "name":
                            return <td key={c.key} className={`${td} font-semibold text-slate-900`}>{q.name || "—"}</td>;
                          case "phone":
                            return (
                              <td key={c.key} className={td} onClick={(e) => e.stopPropagation()}>
                                {q.phone ? <a href={`tel:${q.phone}`} className="hover:text-blue-700 hover:underline">{q.phone}</a> : "—"}
                              </td>
                            );
                          case "email":
                            return (
                              <td key={c.key} className={td} onClick={(e) => e.stopPropagation()}>
                                {q.email ? <a href={`mailto:${q.email}`} className="hover:text-blue-700 hover:underline">{q.email}</a> : "—"}
                              </td>
                            );
                          case "product":
                            return (
                              <td key={c.key} className={td}>
                                <span className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "#F0F2FF", color: "#1E22B2" }}>
                                  {label(PRODUCT_LABELS, q.product) || "—"}
                                </span>
                              </td>
                            );
                          case "quantity":
                            return <td key={c.key} className={td}>{q.quantity ? `${q.quantity}개` : "—"}</td>;
                          case "deliveryDate":
                            return <td key={c.key} className={td}>{q.deliveryDate || "—"}</td>;
                          case "purpose":
                            return <td key={c.key} className={td}>{q.purpose || "—"}</td>;
                          case "customDesign":
                            return <td key={c.key} className={td}>{label(CUSTOM_DESIGN_LABELS, q.customDesign) || "—"}</td>;
                          case "styleType":
                            return <td key={c.key} className={td}>{label(STYLE_LABELS, q.styleType) || "—"}</td>;
                          case "productText":
                            return <td key={c.key} className={`${td} max-w-[9rem] truncate`} title={q.productText}>{q.productText || "—"}</td>;
                          case "sampling":
                            return <td key={c.key} className={td}><BoolCell on={q.sampling} label="희망" /></td>;
                          case "rushed":
                            return <td key={c.key} className={td}><BoolCell on={q.rushed} label="긴급" /></td>;
                          case "packaging":
                            return <td key={c.key} className={td}>{label(PACKAGING_LABELS, q.packaging) || "—"}</td>;
                          case "colorRequest":
                            return <td key={c.key} className={`${td} max-w-[14rem]`}><span className="line-clamp-2">{q.colorRequest || "—"}</span></td>;
                          case "notes":
                            return <td key={c.key} className={`${td} max-w-[14rem]`}><span className="line-clamp-2">{q.notes || "—"}</span></td>;
                          case "files":
                            return (
                              <td key={c.key} className={td} onClick={(e) => e.stopPropagation()}>
                                <div className="flex flex-col gap-1">
                                  {q.fileName ? (
                                    q.fileUrl ? (
                                      <a href={q.fileUrl} target="_blank" rel="noreferrer" className="truncate text-xs text-blue-700 hover:underline" title={q.fileName}>📎 {q.fileName}</a>
                                    ) : (
                                      <span className="truncate text-xs text-slate-400" title="구버전 폼 접수 건이라 파일이 없습니다">📎 {q.fileName} (없음)</span>
                                    )
                                  ) : null}
                                  {q.logoFileName && q.logoFileUrl && (
                                    <a href={q.logoFileUrl} target="_blank" rel="noreferrer" className="truncate text-xs text-blue-700 hover:underline" title={q.logoFileName}>🏷️ {q.logoFileName}</a>
                                  )}
                                  {!q.fileName && !q.logoFileName && "—"}
                                </div>
                              </td>
                            );
                          case "acquisition":
                            return (
                              <td key={c.key} className={td}>
                                {acq ? (
                                  <span
                                    className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
                                    style={{ background: acq.isAd ? "#FEE2E2" : "#F1F5F9", color: acq.isAd ? "#B91C1C" : "#475569" }}
                                  >
                                    {acq.isAd ? "광고 " : "유입 "}{acq.text}
                                  </span>
                                ) : "—"}
                              </td>
                            );
                        }
                      })}
                    </tr>

                    {/* 상세 패널 — 셀에서 잘린 긴 텍스트를 전문으로 확인 */}
                    {isOpen && (
                      <tr className="bg-slate-50">
                        <td colSpan={visible.length} className="border-b border-slate-200 px-5 py-4">
                          <div className="grid gap-4 text-sm md:grid-cols-2">
                            <div>
                              <p className="mb-1 text-xs font-bold text-slate-400">디자인 요청</p>
                              <p className="whitespace-pre-wrap text-slate-700">{q.colorRequest || "—"}</p>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-bold text-slate-400">메모</p>
                              <p className="whitespace-pre-wrap text-slate-700">{q.notes || "—"}</p>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-bold text-slate-400">삽입 문구</p>
                              <p className="whitespace-pre-wrap text-slate-700">{q.productText || "—"}</p>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-bold text-slate-400">제작 옵션</p>
                              <p className="text-slate-700">
                                디자인 스타일 {label(STYLE_LABELS, q.styleType) || "—"} · 포장 {label(PACKAGING_LABELS, q.packaging) || "—"}
                                {q.sampling && " · 샘플링 희망"}
                                {q.rushed && " · 긴급 제작"}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
