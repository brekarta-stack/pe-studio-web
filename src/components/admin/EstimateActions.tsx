"use client";

/**
 * 견적서 상세의 조작 패널 — 지금 상태에서 할 수 있는 일만 보여 준다.
 *
 *   시트 미반영 → [시트에 반영] (시트가 없거나, 고친 내용을 아직 못 그렸다)
 *   확인 대기   → PDF 를 열어 보고 [확인 완료] — 이 화면을 열 때 본 시트 판본에 묶인다
 *   발송 대기   → 메일 작성 후 [발송] (한 번 더 눌러야 나간다) · [확인 취소]
 *   발송 중     → 잠금이 풀리지 않았을 때 사람이 결과를 골라 정리
 *
 * 되돌릴 수 없는 동작(발송·삭제·시트 다시 그리기·발송 결과 확정)은 누르면 확인 버튼으로 바뀌고,
 * 그걸 한 번 더 눌러야 실행된다.
 * window.confirm 은 쓰지 않는다 (브라우저 자동화·웹뷰에서 화면을 잠근다).
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  confirmEstimate,
  deleteEstimate,
  regenerateSheet,
  resolveStuckSending,
  sendEstimate,
  unconfirmEstimate,
  type EstimateActionResult,
} from "@/app/admin/estimates/actions";
import { formatAmount, formatKstDateTime, isEditable, type EstimateStatus } from "@/lib/estimate-types";

interface Props {
  id: string;
  status: EstimateStatus;
  docNumber: string;
  clientCompany: string;
  hasSheet: boolean;
  sheetUrl: string | null;
  supply: number;
  total: number;
  sentTo: string | null;
  sentAt: string | null;
  /** 발송 중 상태로 3분 넘게 멈춤 — 서버에서 판정해 넘긴다 */
  stuck: boolean;
  googleConnected: boolean;
  /** 확인 대기일 때 이 화면을 그리며 읽은 시트 판본(드라이브 modifiedTime). 못 읽었으면 null */
  sheetVersion: string | null;
  draft: { to: string; subject: string; body: string };
}

const btn = "rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50";
const primary = `${btn} bg-slate-900 text-white hover:bg-slate-800`;
const secondary = `${btn} border border-slate-300 bg-white text-slate-700 hover:border-slate-500`;
const field = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500";

/** 두 번 눌러야 실행되는 버튼. 5초 안에 두 번째를 누르지 않으면 원래대로 돌아간다 */
function TwoStepButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  tone = "danger",
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  tone?: "danger" | "primary";
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const base = tone === "primary" ? primary : `${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`;
  const armedCls = `${btn} bg-red-600 text-white hover:bg-red-700`;
  return armed ? (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={armedCls} disabled={disabled} onClick={() => { setArmed(false); onConfirm(); }}>
        {confirmLabel}
      </button>
      <button type="button" className="text-xs text-slate-500 underline" onClick={() => setArmed(false)}>
        그만두기
      </button>
    </span>
  ) : (
    <button type="button" className={base} disabled={disabled} onClick={() => setArmed(true)}>
      {label}
    </button>
  );
}

type Run = (fn: () => Promise<EstimateActionResult>, after?: (r: EstimateActionResult) => boolean) => void;

/**
 * 발송 입력 — 발송 대기 상태에서만 마운트된다. 확인을 마친 순간(또는 확인 취소 뒤 다시 확인한 순간)
 * 새로 마운트되므로, 메일 본문의 금액은 늘 확인으로 확정된 금액에서 시작한다. 메일 서버가 거절해
 * 발송 대기로 돌아온 경우에는 마운트가 유지돼 고쳐 둔 받는 사람·본문이 그대로 남는다.
 */
function SendForm({ p, run, isPending }: { p: Props; run: Run; isPending: boolean }) {
  const [to, setTo] = useState(p.draft.to);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(p.draft.subject);
  const [body, setBody] = useState(p.draft.body);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-slate-500">받는 사람 (여러 명은 쉼표로)</span>
        <input className={field} value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-slate-500">참조 (선택)</span>
        <input className={field} value={cc} onChange={(e) => setCc(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-slate-500">제목</span>
        <input className={field} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-slate-500">본문</span>
        <textarea className={`${field} min-h-56 leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <p className="text-xs text-slate-500">
        첨부: 견적서 PDF (시트에서 발송 순간에 뽑음) · 회신은 ask@papercraft.kr 로 받습니다 · 회사 보관용 사본이 숨은 참조로 함께 갑니다.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <b>{p.clientCompany}</b> · {p.docNumber} · 공급가액 {formatAmount(p.supply)}원 (VAT 포함 {formatAmount(p.total)}원)
        <br />
        <span className="text-slate-600">→ {to || "(받는 사람 없음)"}</span>
      </div>
      <TwoStepButton
        tone="primary"
        label="발송"
        confirmLabel={isPending ? "발송 중…" : "정말 발송 — 되돌릴 수 없습니다"}
        disabled={isPending || !to.trim()}
        onConfirm={() => run(() => sendEstimate(p.id, { to, cc, subject, body }))}
      />
    </div>
  );
}

export default function EstimateActions(p: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** after 가 true 를 돌려주면 다른 화면으로 옮겨 간 것이라 새로고침하지 않는다 */
  const run: Run = (fn, after) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else if (res.warning) setNotice(res.warning);
      if (after?.(res)) return;
      router.refresh();
    });
  };

  const pdfHref = `/api/admin/estimates/${p.id}/pdf`;
  const stuck = p.status === "sending" && p.stuck;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{notice}</div>}

      {/* 시트 링크 — 확인 전후 어디서나 */}
      {p.hasSheet && (
        <div className="flex flex-wrap gap-2">
          {p.sheetUrl && (
            <a href={p.sheetUrl} target="_blank" rel="noreferrer" className={secondary}>
              구글 시트 열기 ↗
            </a>
          )}
          <a href={pdfHref} target="_blank" rel="noreferrer" className={secondary}>
            발송될 PDF 보기 ↗
          </a>
        </div>
      )}

      {/* 1. 생성 */}
      {p.status === "draft" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm text-slate-600">
            {p.hasSheet
              ? "앱에서 고친 내용이 아직 구글 시트에 반영되지 않았습니다. 반영해야 확인할 수 있습니다."
              : "아직 구글 시트가 없습니다."}{" "}
            {!p.googleConnected && "먼저 견적서 목록 화면에서 구글 드라이브를 연결하세요."}
          </p>
          <button type="button" className={primary} disabled={isPending || !p.googleConnected} onClick={() => run(() => regenerateSheet(p.id))}>
            {isPending ? "시트 그리는 중…" : p.hasSheet ? "시트에 반영" : "구글 시트 만들기"}
          </button>
        </div>
      )}

      {/* 2. 확인 */}
      {p.status === "generated" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <p className="mb-1 text-sm font-bold text-slate-900">확인 단계</p>
          <p className="mb-3 text-sm text-slate-600">
            &lsquo;발송될 PDF 보기&rsquo;로 고객이 받을 문서를 직접 열어 보세요. 시트에서 직접 고쳐도 됩니다 —
            고쳤다면 이 화면을 새로고침한 뒤 PDF 를 다시 보고 확인하세요. 이 화면을 연 뒤 시트가 바뀌면 확인이 거부됩니다.
          </p>
          {!p.sheetVersion && (
            <p className="mb-3 text-xs font-bold text-red-600">시트 판본을 읽지 못했습니다. 새로고침하거나 구글 연결 상태를 확인하세요.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={primary}
              disabled={isPending || !p.sheetVersion}
              onClick={() => run(() => confirmEstimate(p.id, p.sheetVersion))}
            >
              {isPending ? "시트 합계 확인 중…" : "확인 완료"}
            </button>
            <TwoStepButton
              label="시트 다시 만들기"
              confirmLabel="다시 그리기 — 시트에서 직접 고친 내용이 사라집니다"
              disabled={isPending}
              onConfirm={() => run(() => regenerateSheet(p.id))}
            />
          </div>
        </div>
      )}

      {/* 3. 발송 */}
      {p.status === "confirmed" && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-900">발송</p>
            <button type="button" className="text-xs font-bold text-slate-500 underline" disabled={isPending} onClick={() => run(() => unconfirmEstimate(p.id))}>
              확인 취소
            </button>
          </div>
          <SendForm p={p} run={run} isPending={isPending} />
        </div>
      )}

      {p.status === "sending" && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-sm">
          <p className="font-bold text-slate-900">발송 중</p>
          {stuck ? (
            <>
              <p className="mt-1 text-slate-600">
                발송이 끝나지 않았거나 결과를 알 수 없습니다. 메일이 실제로 나갔는지 ask@papercraft.kr 보관 사본(숨은 참조)을 먼저 확인한 뒤 고르세요.
                되돌린 뒤 다시 보내도, 앞선 요청이 24시간 안에 메일 서버에 접수됐다면 새로 보내지 않고 다시 이 상태로 멈춥니다 — 두 번 나가지는 않습니다.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <TwoStepButton
                  tone="primary"
                  label="발송된 것으로 처리"
                  confirmLabel="발송 완료로 확정 (되돌릴 수 없음)"
                  disabled={isPending}
                  onConfirm={() => run(() => resolveStuckSending(p.id, "sent"))}
                />
                <TwoStepButton
                  label="안 나갔음 — 발송 대기로 되돌리기"
                  confirmLabel="되돌리기 — 다시 발송할 수 있게 됩니다"
                  disabled={isPending}
                  onConfirm={() => run(() => resolveStuckSending(p.id, "confirmed"))}
                />
              </div>
            </>
          ) : (
            <p className="mt-1 text-slate-600">잠시 후 새로고침하세요.</p>
          )}
        </div>
      )}

      {p.status === "sent" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-sm text-slate-700">
          <b className="text-slate-900">발송 완료</b>
          {p.sentAt && <> · {formatKstDateTime(p.sentAt)}</>}
          {p.sentTo && <div className="mt-1 break-all text-slate-600">받는 사람: {p.sentTo}</div>}
          <div className="mt-1 text-xs text-slate-500">발송한 견적서는 고칠 수 없습니다. 바뀐 조건으로 다시 보내려면 새 견적서를 만드세요.</div>
        </div>
      )}

      {/* 수정·삭제 */}
      {isEditable(p.status) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <Link href={`/admin/estimates/${p.id}/edit`} className={secondary}>
            내용 수정
          </Link>
          <TwoStepButton
            label="견적서 삭제"
            confirmLabel="정말 삭제 (시트는 드라이브 휴지통으로)"
            disabled={isPending}
            onConfirm={() =>
              run(
                () => deleteEstimate(p.id),
                (r) => {
                  if (!r.ok) return false;
                  router.push(`/admin/estimates${r.warning === "trash_failed" ? "?notice=trash_failed" : ""}`);
                  return true;
                },
              )
            }
          />
        </div>
      )}
    </div>
  );
}
