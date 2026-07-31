import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getArtistSession } from "@/lib/session";
import { getArtistWork } from "@/lib/artist-portal";
import {
  ASSIGNMENT_STATUS_COLORS,
  ASSIGNMENT_STATUS_LABELS,
  FEE_TAX_LABELS,
  OFFER_STATUS_COLORS,
  OFFER_STATUS_LABELS,
  PAYOUT_STATUS_COLORS,
  PAYOUT_STATUS_LABELS,
  canArtistWorkOn,
  formatWon,
} from "@/lib/assignment-types";
import {
  CUSTOM_DESIGN_LABELS,
  PACKAGING_LABELS,
  PRODUCT_LABELS,
  STYLE_LABELS,
  label,
} from "@/lib/quote-labels";
import WorkProgressPanel from "@/components/artist/WorkProgressPanel";
import OfferDecision from "@/components/artist/OfferDecision";

export const dynamic = "force-dynamic";

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

function MoneyRow({
  label: name,
  amount,
  hint,
}: {
  label: string;
  amount: number | null;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-sm text-slate-500">{name}</span>
      <span className="text-right">
        <b className="text-sm font-bold text-slate-900">
          {amount == null ? "—" : `${formatWon(amount)}원`}
        </b>
        {hint && <span className="ml-2 text-[11px] text-slate-400">{hint}</span>}
      </span>
    </div>
  );
}

export default async function ArtistWorkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const artist = await getArtistSession();
  if (!artist) redirect("/artist/login");

  const { id } = await params;
  // getArtistWork 는 artistId 로 좁혀 조회한다 — 남의 업무 id 를 넣으면 null
  const work = await getArtistWork(artist.artistId, id);
  if (!work) notFound();

  const { brief, payout } = work;
  const editable = canArtistWorkOn(work);

  return (
    <div>
      <Link
        href="/artist"
        className="inline-block text-sm text-slate-400 transition-colors hover:text-slate-600"
      >
        ← 내 업무
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
            OFFER_STATUS_COLORS[work.offerStatus]
          }`}
        >
          {OFFER_STATUS_LABELS[work.offerStatus]}
        </span>
        {work.offerStatus === "accepted" && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              ASSIGNMENT_STATUS_COLORS[work.status]
            }`}
          >
            {ASSIGNMENT_STATUS_LABELS[work.status]}
          </span>
        )}
      </div>

      <h1 className="mt-2 text-2xl font-bold text-slate-900">
        {label(PRODUCT_LABELS, brief.product) || "제작 의뢰"}
      </h1>
      <p className="mt-0.5 text-sm text-slate-500">
        접수 {brief.createdAt ? brief.createdAt.slice(0, 10) : "—"}
        {work.dueDate && ` · 납기 ${work.dueDate}`}
      </p>

      {/* 제안 응답 — 아직 응답 전이면 화면 맨 위에 둔다 */}
      {work.offerStatus === "offered" && (
        <div className="mt-5">
          <OfferDecision assignmentId={work.id} />
        </div>
      )}

      {work.declineReason && (
        <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          거절 사유: {work.declineReason}
        </p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* ── 의뢰 내용 ── */}
        <div className="space-y-5">
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

          {work.memo && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
              <h2 className="mb-2 text-sm font-bold text-blue-800">관리자 전달 사항</h2>
              <p className="whitespace-pre-wrap text-sm text-blue-900">{work.memo}</p>
            </div>
          )}

          {editable && (
            <WorkProgressPanel
              assignmentId={work.id}
              progress={work.progress}
              status={work.status}
              deliverables={work.deliverables}
            />
          )}
        </div>

        {/* ── 내 작업비 ── */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700">내 작업비</h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  PAYOUT_STATUS_COLORS[payout.payoutStatus]
                }`}
              >
                {PAYOUT_STATUS_LABELS[payout.payoutStatus]}
              </span>
            </div>

            <dl>
              <MoneyRow label="작업비 (세전)" amount={payout.fee} />
              {payout.feeTaxMode !== "none" && (
                <MoneyRow
                  label={FEE_TAX_LABELS[payout.feeTaxMode]}
                  amount={payout.taxAmount}
                  hint={payout.taxAmount >= 0 ? "가산" : "공제"}
                />
              )}
              <MoneyRow label="실지급액" amount={payout.net} />
            </dl>

            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-1 text-[11px] font-semibold text-slate-400">지급 일정</p>
              <dl>
                <MoneyRow
                  label="선금"
                  amount={payout.deposit}
                  hint={payout.depositPaidAt ? `${payout.depositPaidAt} 지급` : "미지급"}
                />
                <MoneyRow
                  label="잔금"
                  amount={payout.balance}
                  hint={payout.balancePaidAt ? `${payout.balancePaidAt} 지급` : "미지급"}
                />
              </dl>
            </div>

            {payout.unpaid > 0 && (
              <p className="mt-4 rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-800">
                받을 금액 <b>{formatWon(payout.unpaid)}원</b> (세전)
              </p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
              모든 금액은 세전(공급가액) 기준입니다.
              {payout.feeTaxMode === "vat" && " 세금계산서 발행 후 부가세를 더해 지급합니다."}
              {payout.feeTaxMode === "withholding" &&
                " 원천징수 3.3%를 제하고 지급합니다."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
