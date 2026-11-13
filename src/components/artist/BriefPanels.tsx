/**
 * 작업 브리프 패널 — 의뢰 내용·제작 희망 디자인·참고 자료.
 * 업무 상세(/artist/works/[id])와 공고 상세(/artist/jobs/[id])가 함께 쓴다.
 * WorkBrief 타입에는 고객 신원이 없다 — 여기서 보여 줄 수 있는 것도 그뿐이다.
 */

import type { WorkBrief } from "@/lib/artist-portal-types";
import {
  CUSTOM_DESIGN_LABELS,
  PACKAGING_LABELS,
  PRODUCT_LABELS,
  STYLE_LABELS,
  label,
} from "@/lib/quote-labels";

/** 값이 있을 때만 나오는 항목 — 빈 칸이 줄줄이 늘어서지 않게 */
function Row({ label: name, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="w-28 flex-shrink-0 text-sm text-slate-400">{name}</dt>
      <dd className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-slate-700">{value}</dd>
    </div>
  );
}

export default function BriefPanels({ brief }: { brief: WorkBrief }) {
  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-bold text-slate-700">의뢰 내용</h2>
        <dl>
          <Row label="제품" value={label(PRODUCT_LABELS, brief.product)} />
          <Row label="수량" value={brief.quantity} />
          <Row
            label="희망 납품일"
            value={brief.rushed ? "최대한 빠르게" : brief.deliveryDate}
          />
          <Row label="용도" value={brief.purpose} />
          <Row label="디자인" value={label(CUSTOM_DESIGN_LABELS, brief.customDesign)} />
          <Row label="스타일" value={label(STYLE_LABELS, brief.styleType)} />
          <Row label="삽입 문구" value={brief.productText} />
          <Row label="색상 요청" value={brief.colorRequest} />
          <Row label="포장" value={label(PACKAGING_LABELS, brief.packaging)} />
          <Row label="샘플링" value={brief.sampling ? "필요" : ""} />
          <Row label="추가 요청" value={brief.notes} />
        </dl>
        <p className="mt-3 text-[11px] text-slate-400">
          고객 연락처는 포털에 표시되지 않습니다. 고객 응대는 관리자가 담당합니다.
        </p>
      </div>

      {brief.designs.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-slate-700">
            제작 희망 디자인{" "}
            <span className="font-medium text-slate-400">
              {brief.designs.length}종 ·{" "}
              {brief.designs
                .reduce((sum, d) => sum + (Number(String(d.quantity).replace(/[^0-9]/g, "")) || 0), 0)
                .toLocaleString("ko-KR")}
              부
            </span>
          </h2>
          <ul className="space-y-2">
            {brief.designs.map((d, i) => (
              <li
                key={d.id || i}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              >
                <span className="w-5 flex-shrink-0 text-xs font-bold text-slate-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800">
                  {d.name || "(이름 없음)"}
                </span>
                <span className="flex-shrink-0 tabular-nums text-slate-500">
                  {d.quantity ? `${Number(String(d.quantity).replace(/[^0-9]/g, "")).toLocaleString("ko-KR")}부` : "—"}
                </span>
                {d.file?.url && (
                  <a
                    href={d.file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 text-xs text-[#1E22B2] underline"
                  >
                    참고 자료
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(brief.files.length > 0 || brief.logoFileUrl) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-slate-700">참고 자료</h2>
          <ul className="space-y-2">
            {brief.files.map((f) => (
              <li key={f.url}>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 underline transition-colors hover:bg-slate-50"
                >
                  {f.name || "첨부파일"}
                </a>
              </li>
            ))}
            {brief.logoFileUrl && (
              <li>
                <a
                  href={brief.logoFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 underline transition-colors hover:bg-slate-50"
                >
                  {brief.logoFileName || "회사 로고"} (로고)
                </a>
              </li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}
