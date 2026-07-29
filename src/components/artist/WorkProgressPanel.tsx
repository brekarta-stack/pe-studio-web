"use client";

/**
 * 진행률·상태 갱신 + 결과물 업로드 패널 (업무 상세).
 *
 * 진행률은 슬라이더로 놓고, 손을 뗀 순간(onPointerUp/onKeyUp)에만 저장한다 —
 * onChange 마다 서버로 보내면 드래그 한 번에 수십 번 저장된다.
 */

import { useRef, useState, useTransition } from "react";
import {
  ASSIGNMENT_STATUS_COLORS,
  ASSIGNMENT_STATUS_LABELS,
  type AssignmentStatus,
  type Deliverable,
} from "@/lib/assignment-types";
import {
  addWorkDeliverable,
  removeWorkDeliverable,
  updateWorkProgress,
} from "@/app/artist/actions";

/** 아티스트가 직접 고를 수 있는 상태 — 배정됨/취소는 관리자 영역 */
const ARTIST_STATUSES: AssignmentStatus[] = ["working", "review", "done"];

export default function WorkProgressPanel({
  assignmentId,
  progress,
  status,
  deliverables,
}: {
  assignmentId: string;
  progress: number;
  status: AssignmentStatus;
  deliverables: Deliverable[];
}) {
  const [value, setValue] = useState(progress);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function save(patch: { progress?: number; status?: AssignmentStatus }) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateWorkProgress(assignmentId, patch);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/artist/upload", { method: "POST", body: form });
      const data = (await res.json()) as { url?: string; name?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "업로드에 실패했습니다.");

      const result = await addWorkDeliverable(assignmentId, {
        name: data.name ?? file.name,
        url: data.url,
      });
      if (!result.ok) throw new Error(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function remove(url: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeWorkDeliverable(assignmentId, url);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-bold text-slate-700">작업 진행 상황</h2>

      {/* 상태 */}
      <div className="mt-4">
        <p className="mb-1.5 text-[11px] font-semibold text-slate-400">상태</p>
        <div className="flex flex-wrap gap-2">
          {ARTIST_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => save({ status: s })}
              disabled={pending}
              aria-pressed={status === s}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                status === s
                  ? ASSIGNMENT_STATUS_COLORS[s]
                  : "border-slate-200 text-slate-400 hover:bg-slate-50"
              }`}
            >
              {ASSIGNMENT_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* 진행률 */}
      <div className="mt-5">
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="progress" className="text-[11px] font-semibold text-slate-400">
            진행률
          </label>
          <span className="text-sm font-bold text-slate-900">{value}%</span>
        </div>
        <input
          id="progress"
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          disabled={pending}
          onChange={(e) => setValue(Number(e.target.value))}
          onPointerUp={() => save({ progress: value })}
          onKeyUp={() => save({ progress: value })}
          className="w-full accent-[#1E22B2]"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          손을 떼면 저장됩니다. 관리자 화면에도 바로 반영됩니다.
        </p>
      </div>

      {/* 결과물 */}
      <div className="mt-6 border-t border-slate-100 pt-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-slate-700">
            작업 결과물{" "}
            <span className="font-medium text-slate-400">{deliverables.length}</span>
          </p>
          <label
            className={`cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 ${
              uploading ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {uploading ? "업로드 중…" : "＋ 파일 올리기"}
            <input
              ref={fileRef}
              type="file"
              onChange={upload}
              disabled={uploading}
              className="hidden"
              accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.ai,.svg,.zip"
            />
          </label>
        </div>

        {deliverables.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-400">
            완성한 도면·이미지를 올리면 관리자가 검수합니다. (PNG·JPG·PDF·AI·SVG·ZIP, 4MB 이하)
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {deliverables.map((d) => (
              <li
                key={d.url}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
              >
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm text-slate-700 underline hover:text-slate-900"
                >
                  {d.name}
                </a>
                <button
                  onClick={() => remove(d.url)}
                  disabled={pending}
                  aria-label={`${d.name} 삭제`}
                  className="flex-shrink-0 text-xs text-slate-400 transition-colors hover:text-red-500 disabled:opacity-50"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {saved && !error && !pending && (
        <p className="mt-4 text-sm text-emerald-600">저장되었습니다.</p>
      )}
    </div>
  );
}
