"use client";

import { useCallback, useRef, useState } from "react";

/**
 * 일별/월별 추이 차트 — 방문(세션)·페이지뷰 이중 막대 + 마우스 추적 툴팁.
 *
 * 집계는 서버(/admin/analytics)에서 끝내고, 이 컴포넌트는 그리기만 한다.
 *   · 연한 막대 = 페이지뷰, 진한 막대 = 방문(세션). 방문 ≤ 페이지뷰라 겹쳐 그린다.
 *   · 막대에 마우스를 올리면 커서 옆에 실제 수치(방문·페이지뷰)가 따라다닌다.
 */

export interface TrendPoint {
  date: string; // 버킷 키 (YYYY-MM-DD 또는 YYYY-MM)
  label: string; // X축 라벨
  pageviews: number;
  sessions: number;
}

const SESSION_COLOR = "#1E22B2";
const PAGEVIEW_COLOR = "#C7CBF2";
const EMPTY_COLOR = "#E2E8F0";
const TIP_WIDTH = 190; // 화면 오른쪽 끝에서 툴팁 뒤집기 판정용 대략 폭

export default function DailyTrendChart({
  data,
  niceMax,
  ticks,
  labelEvery,
}: {
  data: TrendPoint[];
  niceMax: number;
  ticks: number[];
  labelEvery: number;
}) {
  const nf = (n: number) => n.toLocaleString("ko-KR");
  const areaRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; i: number } | null>(null);

  const onMove = useCallback(
    (e: React.MouseEvent) => {
      const el = areaRef.current;
      if (!el || data.length === 0) return;
      const r = el.getBoundingClientRect();
      const i = Math.min(
        data.length - 1,
        Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * data.length)),
      );
      setTip({ x: e.clientX, y: e.clientY, i });
    },
    [data.length],
  );

  const point = tip ? data[tip.i] : null;
  // 오른쪽 끝에서는 커서 왼쪽으로 뒤집어 화면 밖으로 나가지 않게
  const flip = tip !== null && typeof window !== "undefined" && tip.x + TIP_WIDTH + 24 > window.innerWidth;

  return (
    <div className="pl-9 pr-1 pt-2">
      {/* 범례 */}
      <div className="mb-2 flex justify-end gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SESSION_COLOR }} />
          방문 (세션)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PAGEVIEW_COLOR }} />
          페이지뷰
        </span>
      </div>

      {/* 차트 영역 — 기준선(눈금) 위에 막대 */}
      <div
        ref={areaRef}
        className="relative h-40"
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
      >
        {/* Y축 기준선 + 눈금 라벨 (0은 바닥 실선) */}
        {[0, ...ticks].map((v) => (
          <div
            key={v}
            className="absolute inset-x-0"
            style={{ bottom: `${(v / niceMax) * 100}%` }}
          >
            <div className={v === 0 ? "border-t border-slate-200" : "border-t border-dashed border-slate-200/80"} />
            <span className="absolute right-full top-0 -translate-y-1/2 pr-2 text-[10px] text-slate-400 tabular-nums leading-none">
              {nf(v)}
            </span>
          </div>
        ))}
        {/* 막대 — 페이지뷰(연한색) 위에 방문(진한색) 겹쳐 그리기 */}
        <div className="absolute inset-0 flex items-end gap-1.5">
          {data.map((d, i) => {
            const hp = (d.pageviews / niceMax) * 100;
            const hs = (d.sessions / niceMax) * 100;
            const hovered = tip?.i === i;
            return (
              <div key={d.date} className="relative h-full flex-1">
                {hovered && <div className="absolute inset-y-0 -inset-x-0.5 rounded-md bg-slate-100/80" />}
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-md"
                  style={{
                    height: `${Math.max(hp, 2)}%`,
                    background: d.pageviews ? PAGEVIEW_COLOR : EMPTY_COLOR,
                    opacity: hovered ? 0.85 : 1,
                  }}
                />
                {d.sessions > 0 && (
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-t-md"
                    style={{
                      height: `${Math.max(hs, 2)}%`,
                      background: SESSION_COLOR,
                      opacity: hovered ? 0.85 : 1,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* X축 라벨 (버킷이 많으면 일부만 표기) */}
      <div className="mt-1.5 flex gap-1.5">
        {data.map((d, i) => (
          <div key={d.date} className="flex-1 overflow-hidden text-center text-[9px] tabular-nums text-slate-400">
            {i % labelEvery === 0 ? d.label : ""}
          </div>
        ))}
      </div>

      {/* 마우스 옆 툴팁 — 실제 수치 */}
      {tip && point && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: flip ? tip.x - 14 : tip.x + 14,
            top: tip.y - 12,
            transform: flip ? "translate(-100%, -100%)" : "translateY(-100%)",
          }}
        >
          <div className="whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-white shadow-lg">
            <div className="text-[10px] tabular-nums text-slate-300">{point.date}</div>
            <div className="text-[11px] font-semibold tabular-nums">
              방문 {nf(point.sessions)}명 · 페이지뷰 {nf(point.pageviews)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
