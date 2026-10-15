"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 서체와 그림이 다 실린 뒤 인쇄 창을 띄운다.
 * 바로 window.print() 를 부르면 명조가 아직 안 내려와 시스템 서체로 찍힌 PDF 가 나온다
 * (agents-bd 의 헤드리스 출력에서 실제로 겪었다). 자동으로 못 띄우는 브라우저를 위해 버튼도 둔다.
 */
export default function PrintTrigger({ auto = true }: { auto?: boolean }) {
  const [ready, setReady] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(".pb-root img"));
    const imagesLoaded = Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((res) => {
              img.addEventListener("load", () => res(), { once: true });
              img.addEventListener("error", () => res(), { once: true });
            })
      )
    );
    // 그림 하나가 끝내 안 오더라도 인쇄를 영원히 막지는 않는다
    const timeout = new Promise<void>((res) => setTimeout(res, 15000));
    Promise.race([Promise.all([document.fonts.ready, imagesLoaded]), timeout]).then(() => {
      if (cancelled) return;
      setReady(true);
      if (auto && !fired.current) {
        fired.current = true;
        window.print();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [auto]);

  return (
    <div className="flex items-center gap-3 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        style={{ background: "#1E22B2" }}
      >
        인쇄 / PDF로 저장
      </button>
      <span className="text-xs text-slate-500">
        {ready ? "인쇄 창에서 대상을 ‘PDF로 저장’으로, 여백은 ‘없음’으로 고르세요." : "서체와 그림을 불러오는 중입니다…"}
      </span>
    </div>
  );
}
