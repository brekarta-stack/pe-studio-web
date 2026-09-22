"use client";

/**
 * DB 셋업 화면 — 공개 이미지 원본 줄이기.
 *
 * 먼저 "미리 보기"로 대상 파일과 크기를 보고(내려받지 않는다), "줄이기 실행"을 두 번 눌러 적용한다.
 * 원본은 비공개 버킷(uploads-originals)에 보관되고 "원본으로 되돌리기"로 복구된다.
 * 서버는 한 번에 몇 개씩만 처리하므로 여기서 끝까지 이어서 부른다. 중간에 끊기면 그 자리부터 이어 한다.
 */

import { useEffect, useState } from "react";
import { MAX_EDGE, MIN_SAVING_RATIO } from "@/lib/image-shrink";

type Mode = "dry-run" | "apply" | "restore";
interface Row {
  name: string;
  before?: number;
  after?: number;
  action: "candidate" | "shrunk" | "restored" | "skip" | "error";
  reason?: string;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)}MB`;

function TwoStep({ label, confirm, disabled, onGo }: { label: string; confirm: string; disabled: boolean; onGo: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <button type="button" disabled={disabled} onClick={() => { setArmed(false); onGo(); }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
      {confirm}
    </button>
  ) : (
    <button type="button" disabled={disabled} onClick={() => setArmed(true)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">
      {label}
    </button>
  );
}

export default function ImageShrinkPanel() {
  const [running, setRunning] = useState<Mode | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastMode, setLastMode] = useState<Mode | null>(null);
  // 오류로 멈춘 자리 — "이어서 하기"가 여기서 다시 시작한다 (처음부터 다시 받으면 전송량을 또 쓴다).
  // 이어서 할 때는 첫 요청을 한 개만 보낸다 — 거기서 또 실패하면 그 파일이 원인이니 건너뛸 수 있게.
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [stuckOne, setStuckOne] = useState(false);

  const run = async (mode: Mode, from = 0, firstLimit?: number) => {
    setRunning(mode);
    setLastMode(mode);
    if (from === 0) setRows([]);
    setError(null);
    setResumeAt(null);
    setStuckOne(false);
    let offset: number | null = from;
    let limit = firstLimit;
    try {
      while (offset !== null) {
        const res: Response = await fetch("/api/admin/maintenance/shrink-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, offset, ...(limit ? { limit } : {}) }),
        });
        const json = (await res.json().catch(() => ({}))) as { results?: Row[]; nextOffset?: number | null; error?: string };
        if (!res.ok) throw new Error(json.error ?? `오류 ${res.status}`);
        setRows((r) => [...r, ...(json.results ?? [])]);
        offset = json.nextOffset ?? null;
        limit = undefined;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResumeAt(offset);
      setStuckOne(limit === 1);
    } finally {
      setRunning(null);
    }
  };

  const candidates = rows.filter((r) => r.action === "candidate");
  const candidateBytes = candidates.reduce((s, r) => s + (r.before ?? 0), 0);
  const shrunk = rows.filter((r) => r.action === "shrunk");
  const before = shrunk.reduce((s, r) => s + (r.before ?? 0), 0);
  const after = shrunk.reduce((s, r) => s + (r.after ?? 0), 0);
  const errors = rows.filter((r) => r.action === "error");
  const restored = rows.filter((r) => r.action === "restored");
  const skipped = rows.filter((r) => r.action === "skip");

  return (
    <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="mb-1 font-bold text-slate-900">공개 이미지 원본 줄이기</h2>
      <p className="mb-4 text-sm leading-relaxed text-slate-500">
        uploads 버킷 맨 위의 이미지(블로그·포트폴리오·카탈로그)를 폭 {MAX_EDGE}px 이하로 줄이고 같은 형식으로 다시 압축해
        같은 자리에 덮어씁니다. 주소가 그대로라 사이트는 바꿀 것이 없습니다. 고객 첨부(quote/)와 작가 납품물(deliverable/)은
        건드리지 않습니다. 덮어쓰기 전 원본은 비공개 버킷 uploads-originals 에 보관됩니다. 되돌리기는 이 도구가 줄인 파일만
        되돌리고, 그 뒤에 교체된 파일은 건드리지 않습니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!running}
          onClick={() => run("dry-run")}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {running === "dry-run" ? "살펴보는 중…" : "미리 보기"}
        </button>
        <TwoStep label="줄이기 실행" confirm="원본 보관 후 덮어쓰기" disabled={!!running} onGo={() => run("apply")} />
        <TwoStep label="원본으로 되돌리기" confirm="보관본으로 되돌리기" disabled={!!running} onGo={() => run("restore")} />
        {!running && resumeAt !== null && lastMode && (
          <button
            type="button"
            onClick={() => run(lastMode, resumeAt, lastMode === "dry-run" ? undefined : 1)}
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800"
          >
            멈춘 곳({resumeAt + 1}번째 파일)부터 이어서 하기
          </button>
        )}
        {!running && resumeAt !== null && lastMode && stuckOne && (
          <button
            type="button"
            onClick={() => run(lastMode, resumeAt + 1)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700"
          >
            {resumeAt + 1}번째 파일 건너뛰고 이어서 하기
          </button>
        )}
      </div>

      {running && <p className="mt-3 text-sm text-slate-500">처리 중… {rows.length}개 확인</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {!running && lastMode && rows.length > 0 && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          {lastMode === "dry-run" ? (
            <>
              대상 후보 {candidates.length}개 · 합계 {mb(candidateBytes)} · 확인한 파일 {rows.length}개
              <span className="block text-xs text-slate-500">
                크기·형식만 보고 고른 후보입니다(내려받지 않음). 실제로는 줄이기 전에 해상도를 확인하고, {Math.round(MIN_SAVING_RATIO * 100)}% 이상
                줄어들 때만 바꿉니다. 이미 줄인 파일도 후보로 보일 수 있지만 실행 때 건너뜁니다.
              </span>
            </>
          ) : lastMode === "restore" ? (
            <>
              되돌림 {restored.length}개 · 건너뜀 {skipped.length}개
              {errors.length > 0 && <span className="text-red-600"> · 오류 {errors.length}개</span>}
            </>
          ) : (
            <>
              줄인 파일 {shrunk.length}개 · {mb(before)} → {mb(after)}
              {before > 0 && <> ({Math.round((1 - after / before) * 100)}% 감소)</>} · 건너뜀 {skipped.length}개 · 확인한 파일 {rows.length}개
              {errors.length > 0 && <span className="text-red-600"> · 오류 {errors.length}개</span>}
            </>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-600">파일별 결과</summary>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs">
            {rows.map((r, i) => (
              <li key={`${r.name}-${i}`} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-slate-700">{r.name}</span>
                <span className="text-slate-500">
                  {r.action === "shrunk"
                    ? `${mb(r.before ?? 0)} → ${mb(r.after ?? 0)}`
                    : r.action === "candidate"
                      ? `${mb(r.before ?? 0)} · 후보`
                      : r.action === "restored"
                        ? "되돌림"
                        : r.reason}
                </span>
                {r.action === "error" && <span className="text-red-600">오류</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
