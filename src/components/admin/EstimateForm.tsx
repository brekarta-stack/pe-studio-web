"use client";

/**
 * 견적서 작성·수정 폼.
 *
 * 구분을 고르면 기본 품목(페이퍼토이 700만 / 우드락 900만, 부가세 별도)이 채워지고,
 * 그대로 두거나 고쳐서 만든다. 금액은 입력하는 즉시 아래 미리보기에 반영된다.
 * 저장하면 서버가 DB 에 넣고 구글 시트를 그린다 — 폼은 결과 화면으로 넘어갈 뿐이다.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CATEGORY_FOLDERS,
  CATEGORY_LABELS,
  ESTIMATE_CATEGORIES,
  MAX_ITEMS,
  computeTotals,
  formatAmount,
  templateItems,
  type EstimateCategory,
  type EstimateItem,
} from "@/lib/estimate-types";
import { createEstimate, updateEstimate } from "@/app/admin/estimates/actions";
import EstimatePreview from "./EstimatePreview";

export interface QuoteOption {
  id: string;
  name: string;
  email: string;
  label: string;
}

export interface EstimateFormValues {
  category: EstimateCategory;
  clientCompany: string;
  clientContact: string;
  clientEmail: string;
  issuedOn: string;
  deliveryTerm: string;
  deliveryPlace: string;
  paymentTerm: string;
  items: EstimateItem[];
  quoteId: string | null;
}

interface Props {
  mode: "create" | "edit";
  initial: EstimateFormValues;
  /** 수정일 때 대상 id 와 문서 번호 */
  estimateId?: string;
  docNumber?: string;
  quotes?: QuoteOption[];
  googleConnected: boolean;
}

/** 입력 중인 행 — 숫자 칸은 문자열로 들고 있어야 "1,0" 같은 중간 상태를 칠 수 있다 */
interface RowDraft {
  key: number;
  group: string;
  name: string;
  quantity: string;
  unitPrice: string;
  note: string;
}

let seq = 0;
const toDraft = (i: EstimateItem): RowDraft => ({
  key: ++seq,
  group: i.group,
  name: i.name,
  quantity: String(i.quantity),
  unitPrice: formatAmount(i.unitPrice),
  note: i.note,
});

const num = (s: string) => {
  const n = Number(s.replace(/,/g, "").trim());
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
};

const input =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-slate-500";

export default function EstimateForm({ mode, initial, estimateId, docNumber, quotes = [], googleConnected }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<EstimateCategory>(initial.category);
  const [clientCompany, setClientCompany] = useState(initial.clientCompany);
  const [clientContact, setClientContact] = useState(initial.clientContact);
  const [clientEmail, setClientEmail] = useState(initial.clientEmail);
  const [issuedOn, setIssuedOn] = useState(initial.issuedOn);
  const [deliveryTerm, setDeliveryTerm] = useState(initial.deliveryTerm);
  const [deliveryPlace, setDeliveryPlace] = useState(initial.deliveryPlace);
  const [paymentTerm, setPaymentTerm] = useState(initial.paymentTerm);
  const [quoteId, setQuoteId] = useState<string | null>(initial.quoteId);
  const [rows, setRows] = useState<RowDraft[]>(() => initial.items.map(toDraft));
  // 품목을 손대기 전이면 구분을 바꿀 때 기본 품목을 갈아 끼운다
  const [itemsTouched, setItemsTouched] = useState(mode === "edit");

  const items: EstimateItem[] = useMemo(
    () =>
      rows.map((r) => ({
        group: r.group.trim(),
        name: r.name.trim(),
        quantity: num(r.quantity),
        unitPrice: num(r.unitPrice),
        note: r.note.trim(),
      })),
    [rows],
  );
  const totals = computeTotals(items);

  const onCategory = (c: EstimateCategory) => {
    if (mode === "edit") return;
    setCategory(c);
    if (!itemsTouched) setRows(templateItems(c).map(toDraft));
  };

  const loadTemplate = () => {
    setRows(templateItems(category).map(toDraft));
    setItemsTouched(false);
  };

  const edit = (key: number, patch: Partial<RowDraft>) => {
    setItemsTouched(true);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const move = (idx: number, dir: -1 | 1) => {
    setItemsTouched(true);
    setRows((rs) => {
      const j = idx + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };
  const remove = (key: number) => {
    setItemsTouched(true);
    setRows((rs) => rs.filter((r) => r.key !== key));
  };
  const add = () => {
    setItemsTouched(true);
    setRows((rs) => [...rs, { key: ++seq, group: "", name: "", quantity: "1", unitPrice: "0", note: "" }]);
  };

  const onQuote = (id: string) => {
    const q = quotes.find((x) => x.id === id);
    setQuoteId(q ? q.id : null);
    if (q) {
      if (!clientContact) setClientContact(q.name);
      if (!clientEmail) setClientEmail(q.email);
    }
  };

  const submit = () => {
    setError(null);
    const payload = {
      category,
      clientCompany,
      clientContact,
      clientEmail,
      issuedOn,
      deliveryTerm,
      deliveryPlace,
      paymentTerm,
      quoteId,
      items: rows.map((r) => ({
        group: r.group,
        name: r.name,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        note: r.note,
      })),
    };
    startTransition(async () => {
      const res = mode === "create" ? await createEstimate(payload) : await updateEstimate(estimateId!, payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // 시트 실패 같은 경고는 견적서의 last_error 로 남아 상세 화면 상단에 뜬다 — 주소에 싣지 않는다
      router.push(`/admin/estimates/${res.id ?? estimateId}`);
    });
  };

  return (
    <div className="space-y-6">
      {!googleConnected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          구글 드라이브가 연결되지 않았습니다. 지금 저장하면 시트 없이 견적서만 저장되고, 연결한 뒤 상세 화면에서
          시트를 만들 수 있습니다. <Link href="/admin/estimates" className="font-bold underline">연결하러 가기</Link>
        </div>
      )}

      {/* 기본 정보 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold text-slate-900">기본 정보</h2>

        <div className="mb-4">
          <div className="mb-1.5 text-xs font-bold text-slate-500">구분</div>
          <div className="flex flex-wrap gap-2">
            {ESTIMATE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onCategory(c)}
                disabled={mode === "edit" && c !== category}
                className={`rounded-lg border px-4 py-2 text-sm font-bold ${
                  c === category
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-400 disabled:opacity-40"
                }`}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            드라이브 <b>견적서/{CATEGORY_FOLDERS[category]}</b> 폴더에 저장됩니다.
            {mode === "edit" && " 구분은 만든 뒤에 바꿀 수 없습니다."}
          </p>
        </div>

        {mode === "create" && quotes.length > 0 && (
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-bold text-slate-500">제작 문의에서 불러오기 (선택)</span>
            <select
              value={quoteId ?? ""}
              onChange={(e) => onQuote(e.target.value)}
              className={input}
            >
              <option value="">연결하지 않음</option>
              {quotes.map((q) => (
                <option key={q.id} value={q.id}>{q.label}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              연결하면 담당자·이메일을 채우고, 발송할 때 그 문의를 &lsquo;견적발송&rsquo; 단계로 옮깁니다.
            </span>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">고객사명 *</span>
            <input className={input} value={clientCompany} onChange={(e) => setClientCompany(e.target.value)} placeholder="예: CREATIVE 13" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">담당자</span>
            <input className={input} value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="예: 김태형" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">고객 이메일 (발송 기본 주소)</span>
            <input className={input} type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="name@company.com" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">견적 일자</span>
            <input className={input} type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">납품 기일</span>
            <input className={input} value={deliveryTerm} onChange={(e) => setDeliveryTerm(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">납품 장소</span>
            <input className={input} value={deliveryPlace} onChange={(e) => setDeliveryPlace(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">결재 조건</span>
            <input className={input} value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)} />
          </label>
          {docNumber && (
            <div>
              <span className="mb-1 block text-xs font-bold text-slate-500">문서 번호</span>
              <div className="flex h-9 items-center text-sm font-bold text-slate-700">{docNumber}</div>
            </div>
          )}
        </div>
      </section>

      {/* 품목 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">품목 (공급단가는 부가세 별도)</h2>
          <button type="button" onClick={loadTemplate} className="text-xs font-bold text-slate-500 underline hover:text-slate-800">
            {CATEGORY_LABELS[category]} 기본 품목 다시 불러오기
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold text-slate-500">
                <th className="w-32 pb-2 pr-2">품목</th>
                <th className="pb-2 pr-2">품명 *</th>
                <th className="w-24 pb-2 pr-2">수량</th>
                <th className="w-32 pb-2 pr-2">공급단가</th>
                <th className="w-28 pb-2 pr-2 text-right">금액</th>
                <th className="w-40 pb-2 pr-2">비고</th>
                <th className="w-20 pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.key} className="align-top">
                  <td className="pb-2 pr-2">
                    <input className={input} value={r.group} onChange={(e) => edit(r.key, { group: e.target.value })} placeholder={idx === 0 ? "필수" : "(위와 묶음)"} />
                  </td>
                  <td className="pb-2 pr-2">
                    <input className={input} value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} />
                  </td>
                  <td className="pb-2 pr-2">
                    <input className={`${input} text-right tabular-nums`} inputMode="numeric" value={r.quantity} onChange={(e) => edit(r.key, { quantity: e.target.value })} />
                  </td>
                  <td className="pb-2 pr-2">
                    <input
                      className={`${input} text-right tabular-nums`}
                      inputMode="numeric"
                      value={r.unitPrice}
                      onChange={(e) => edit(r.key, { unitPrice: e.target.value })}
                      onBlur={(e) => edit(r.key, { unitPrice: formatAmount(num(e.target.value)) })}
                    />
                  </td>
                  <td className="pb-2 pr-2 pt-2 text-right tabular-nums text-slate-700">
                    {formatAmount(num(r.quantity) * num(r.unitPrice))}
                  </td>
                  <td className="pb-2 pr-2">
                    <input className={input} value={r.note} onChange={(e) => edit(r.key, { note: e.target.value })} />
                  </td>
                  <td className="whitespace-nowrap pb-2 pt-1.5 text-slate-400">
                    <button type="button" onClick={() => move(idx, -1)} className="px-1 hover:text-slate-800" aria-label="위로">↑</button>
                    <button type="button" onClick={() => move(idx, 1)} className="px-1 hover:text-slate-800" aria-label="아래로">↓</button>
                    <button type="button" onClick={() => remove(r.key)} className="px-1 hover:text-red-600" aria-label="행 삭제">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <button
            type="button"
            onClick={add}
            disabled={rows.length >= MAX_ITEMS}
            className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-500 disabled:opacity-40"
          >
            + 행 추가
          </button>
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
            <dt className="text-slate-500">공급가액</dt>
            <dd className="text-right font-bold tabular-nums">{formatAmount(totals.supply)}원</dd>
            <dt className="text-slate-500">부가세 (10%)</dt>
            <dd className="text-right tabular-nums">{formatAmount(totals.vat)}원</dd>
            <dt className="text-slate-500">합계 (VAT 포함)</dt>
            <dd className="text-right font-bold tabular-nums">{formatAmount(totals.total)}원</dd>
          </dl>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          품목 칸을 비우면 바로 위 행과 한 칸으로 묶입니다. 수량 0 인 행은 금액 0 으로 표에 남아 선택 옵션처럼 보입니다.
        </p>
      </section>

      {/* 미리보기 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-bold text-slate-900">미리보기</h2>
        <EstimatePreview
          data={{
            clientCompany,
            clientContact,
            issuedOn,
            docNumber: docNumber ?? "(저장할 때 발급)",
            deliveryTerm,
            deliveryPlace,
            paymentTerm,
            items,
          }}
        />
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "저장하고 시트 만드는 중…" : mode === "create" ? "견적서 생성" : "저장하고 시트 다시 그리기"}
        </button>
        <Link href={estimateId ? `/admin/estimates/${estimateId}` : "/admin/estimates"} className="text-sm text-slate-500 hover:text-slate-800">
          취소
        </Link>
        {mode === "edit" && (
          <span className="text-xs text-slate-500">
            저장하면 시트를 다시 그립니다. 시트에서 직접 고친 내용은 사라지고, 확인 완료도 다시 받아야 합니다.
            견적 일자를 바꾸면 문서 번호도 새 날짜로 다시 발급됩니다.
          </span>
        )}
      </div>
    </div>
  );
}
