/**
 * 견적서 미리보기 — 구글 시트 양식을 화면용으로 옮긴 것.
 *
 * 작성 중에는 입력값으로, 상세 화면에서는 DB 값으로 그린다. 발송되는 실물은 시트에서
 * 뽑은 PDF 이므로, 상세 화면에서는 "PDF 보기"로 최종본을 따로 확인하게 한다.
 * 훅이 없어 서버·클라이언트 컴포넌트 어디서나 쓸 수 있다.
 */

import { computeTotals, formatAmount, formatKoreanDate, isIsoDate, lineAmount, type EstimateItem } from "@/lib/estimate-types";
import { ESTIMATE_NOTES, SUPPLIER, groupSpans } from "@/lib/estimate-sheet";

export interface EstimatePreviewData {
  clientCompany: string;
  clientContact: string;
  issuedOn: string;
  docNumber: string;
  deliveryTerm: string;
  deliveryPlace: string;
  paymentTerm: string;
  items: EstimateItem[];
}

const BRAND = "bg-[#1E22B2]";

export default function EstimatePreview({ data }: { data: EstimatePreviewData }) {
  const totals = computeTotals(data.items);
  // 품목 칸 세로 병합 — 시트와 같은 규칙(품목이 빈 행은 위 행에 묶임)
  const rowSpan = new Map<number, number>();
  const hidden = new Set<number>();
  for (const [s, e] of groupSpans(data.items)) {
    rowSpan.set(s, e - s + 1);
    for (let i = s + 1; i <= e; i++) hidden.add(i);
  }

  const recv: [string, string, boolean][] = [
    ["수 신 처", data.clientCompany ? `${data.clientCompany} 貴中` : "", true],
    ["담 당 자", data.clientContact ? `${data.clientContact} 님 貴下` : "", false],
    ["견적 일자", isIsoDate(data.issuedOn) ? formatKoreanDate(data.issuedOn) : "", false],
    ["문서 번호", data.docNumber, false],
    ["납품 기일", data.deliveryTerm, false],
    ["납품 장소", data.deliveryPlace, false],
    ["결재 조건", data.paymentTerm, false],
  ];
  const cell = "border border-slate-800 px-2 py-1 text-center";
  const dot = "border-x border-dotted border-slate-500 px-2 py-1 text-center";

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px] bg-white text-[12px] text-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/estimate/banner.png" alt="PE Studio" className={`block w-full ${BRAND}`} />
        <div className={`${BRAND} mt-4 py-1.5 text-center text-lg font-bold tracking-[0.5em] text-white`}>견 적 서</div>

        <div className="mt-3 grid grid-cols-[1fr_1fr] gap-4">
          <table className="w-full">
            <tbody>
              {recv.map(([k, v, bold]) => (
                <tr key={k}>
                  <td className="w-24 py-1 text-center">{k}</td>
                  <td className={`py-1 text-center ${bold ? "font-bold" : ""}`}>{v || <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full self-end border-collapse">
            <tbody>
              <tr><td className={`${cell} font-bold`}>사 업 자</td><td className={cell} colSpan={3}>{SUPPLIER.bizNumber}</td></tr>
              <tr><td className={`${cell} font-bold`}>상 호</td><td className={cell}>{SUPPLIER.company}</td><td className={`${cell} font-bold`}>대 표</td><td className={cell}>{SUPPLIER.ceo}</td></tr>
              <tr><td className={`${cell} font-bold`}>주 소</td><td className={`${cell} text-[11px]`} colSpan={3}>{SUPPLIER.address}</td></tr>
              <tr><td className={`${cell} font-bold`}>WEB</td><td className={`${cell} text-[11px] text-blue-700 underline`} colSpan={3}>{SUPPLIER.web}</td></tr>
              <tr><td className={`${cell} font-bold`}>종 목</td><td className={cell}>{SUPPLIER.bizType}</td><td className={`${cell} font-bold`}>업 태</td><td className={cell}>{SUPPLIER.bizItem}</td></tr>
              <tr><td className={`${cell} font-bold`}>전 화</td><td className={cell}>{SUPPLIER.phone}</td><td className={`${cell} font-bold`}>팩 스</td><td className={cell}>{SUPPLIER.fax}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex gap-6 px-6 text-[13px]">
          <span>견 적 가</span>
          <span className="font-bold underline">하기 견적 참조</span>
        </div>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className={`${BRAND} text-white`}>
              {["품 목", "품 명", "수 량", "공급단가", "금 액", "비 고"].map((h) => (
                <th key={h} className="border border-slate-800 px-2 py-1.5 font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="border-x border-slate-800">
            {data.items.map((it, i) => (
              <tr key={i} className="border-b border-dotted border-slate-500">
                {!hidden.has(i) && (
                  <td className={`${dot} w-24`} rowSpan={rowSpan.get(i) ?? 1}>{it.group}</td>
                )}
                <td className={dot}>{it.name}</td>
                <td className={`${dot} w-20 tabular-nums`}>{formatAmount(it.quantity)}</td>
                <td className={`${dot} w-24 tabular-nums`}>{formatAmount(it.unitPrice)}</td>
                <td className={`${dot} w-24 tabular-nums`}>{formatAmount(lineAmount(it))}</td>
                <td className={`${dot} w-32`}>{it.note}</td>
              </tr>
            ))}
            <tr className="h-6"><td colSpan={6} /></tr>
          </tbody>
          <tbody>
            <tr className="bg-[#C0C0C0] font-bold">
              <td className={cell} colSpan={3}>합 계</td>
              <td className={`${cell} tabular-nums`} colSpan={3}>{formatAmount(totals.supply)}</td>
            </tr>
            <tr className="font-bold">
              <td className={cell} colSpan={3}>부 가 가 치 세</td>
              <td className={`${cell} tabular-nums text-[#DD0806]`} colSpan={3}>{formatAmount(totals.vat)}</td>
            </tr>
            <tr className="bg-[#C0C0C0] font-bold">
              <td className={cell} colSpan={3}>합 계 (VAT 포함)</td>
              <td className={`${cell} tabular-nums`} colSpan={3}>{formatAmount(totals.total)}</td>
            </tr>
          </tbody>
        </table>

        <table className="mt-6 w-full border-collapse border border-slate-800">
          <tbody>
            {ESTIMATE_NOTES.map((n, i) => (
              <tr key={n}>
                {i === 0 && <td className="w-24 border-r border-slate-800 text-center font-bold" rowSpan={3}>참고</td>}
                <td className="px-2 py-1 text-[11px]">{n}</td>
                {i === 0 && <td className="w-20 border-x border-slate-800 text-center font-bold" rowSpan={3}>담당자</td>}
                <td className="w-16 text-center">{["담 당 :", "전 화 :", "메 일 :"][i]}</td>
                <td className="w-44 text-center">{[SUPPLIER.managerName, SUPPLIER.managerPhone, SUPPLIER.managerEmail][i]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-8 pb-4 text-center text-base">{SUPPLIER.sealName} (인)</div>
      </div>
    </div>
  );
}
